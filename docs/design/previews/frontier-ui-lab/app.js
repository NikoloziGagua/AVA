(() => {
  const root = document.documentElement;
  const scenes = [...document.querySelectorAll('[data-scene]')];
  const tabs = [...document.querySelectorAll('[data-target]')];
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sceneMeta = {
    signal: ['01', 'Living signal'],
    choreography: ['02', 'State choreography'],
    atlas: ['03', 'Life atlas'],
    time: ['04', 'Temporal ribbon'],
    material: ['05', 'Tactile materials']
  };
  const sceneOrder = Object.keys(sceneMeta);
  let activeScene = 'signal';
  let manualReduced = reduceQuery.matches;
  let frame = 0;
  let pointer = { x: .66, y: .46 };
  let flowTimers = [];

  const isReduced = () => root.dataset.motion === 'reduced';
  const durationScale = () => root.dataset.tempo === 'quick' ? .55 : 1;

  const stopFlow = () => {
    flowTimers.forEach(clearTimeout);
    flowTimers = [];
  };

  const setScene = (name, updateHash = true) => {
    if (!sceneMeta[name]) return;
    stopFlow();
    activeScene = name;
    scenes.forEach((scene) => {
      const active = scene.dataset.scene === name;
      scene.hidden = !active;
      scene.classList.toggle('is-active', active);
    });
    tabs.forEach((tab) => {
      const active = tab.dataset.target === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    const [number, label] = sceneMeta[name];
    document.querySelector('#current-number').textContent = number;
    document.querySelector('#current-name').textContent = label;
    document.title = `AVA - ${label}`;
    if (updateHash) history.replaceState(null, '', `#${name}`);
    requestAnimationFrame(() => {
      resizeCanvases();
      replay(name, true);
    });
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => setScene(tab.dataset.target)));

  const syncMotion = () => {
    root.dataset.motion = manualReduced ? 'reduced' : 'full';
    const button = document.querySelector('#motion-toggle');
    button.setAttribute('aria-pressed', String(manualReduced));
    button.setAttribute('aria-label', manualReduced ? 'Use full motion' : 'Use reduced motion');
    document.querySelector('#motion-label').textContent = manualReduced ? 'Reduced motion' : 'Full motion';
    if (manualReduced) cancelAnimationFrame(frame);
    renderFrame(performance.now(), true);
  };

  document.querySelector('#motion-toggle').addEventListener('click', () => {
    manualReduced = !manualReduced;
    syncMotion();
    replay(activeScene);
  });
  reduceQuery.addEventListener?.('change', (event) => {
    manualReduced = event.matches;
    syncMotion();
  });

  document.querySelector('#tempo-toggle').addEventListener('click', () => {
    const quick = root.dataset.tempo !== 'quick';
    root.dataset.tempo = quick ? 'quick' : 'calm';
    document.querySelector('#tempo-label').textContent = quick ? 'Quick' : 'Calm';
    document.querySelector('#tempo-toggle').setAttribute('aria-label', quick ? 'Switch to calm motion' : 'Switch to quick motion');
    replay(activeScene);
  });

  // Motion scene 01: a deterministic point portrait and surrounding signal field.
  const signalCanvas = document.querySelector('#signal-canvas');
  const signalContext = signalCanvas.getContext('2d', { alpha: true });
  const signalPoints = [];
  let signalListening = false;

  const seeded = (seed) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return value - Math.floor(value);
  };

  const buildSignalPoints = () => {
    signalPoints.length = 0;
    for (let index = 0; index < 1500; index += 1) {
      const theta = seeded(index + 1) * Math.PI * 2;
      const radius = Math.sqrt(seeded(index + 821));
      let x = .68 + Math.cos(theta) * radius * .145;
      let y = .48 + Math.sin(theta) * radius * .305;
      const jaw = Math.max(0, (y - .48) / .305);
      x += Math.cos(theta) * jaw * .038;
      const eyeBand = Math.exp(-Math.pow((y - .415) / .016, 2));
      const eyes = Math.exp(-Math.pow((Math.abs(x - .68) - .052) / .017, 2));
      const mouth = Math.exp(-Math.pow((y - .59) / .013, 2)) * Math.exp(-Math.pow((x - .68) / .065, 2));
      const nose = Math.exp(-Math.pow((x - .68) / .011, 2)) * Math.exp(-Math.pow((y - .5) / .085, 2));
      const feature = eyeBand * eyes + mouth + nose * .45;
      signalPoints.push({ x, y, a: .09 + (1 - radius) * .4 + feature * .72, s: .35 + seeded(index + 1600) * 1.2, p: seeded(index + 3200) * Math.PI * 2 });
    }
    for (let index = 0; index < 500; index += 1) {
      signalPoints.push({ x: seeded(index + 5000), y: seeded(index + 5700), a: .02 + seeded(index + 6300) * .08, s: .3 + seeded(index + 6900), p: seeded(index + 7500) * Math.PI * 2 });
    }
  };

  const fitCanvas = (canvas, context) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  };

  let signalSize = { width: 1, height: 1 };
  let atlasSize = { width: 1, height: 1 };
  let materialSize = { width: 1, height: 1 };

  const drawSignal = (time) => {
    const { width, height } = signalSize;
    signalContext.clearRect(0, 0, width, height);
    const reduced = isReduced();
    const energy = signalListening && !reduced ? .0045 + Math.sin(time * .006) * .002 : .0015;
    signalPoints.forEach((point) => {
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const distance = Math.hypot(dx, dy);
      const response = reduced ? 0 : Math.max(0, .18 - distance) * (signalListening ? .12 : .045);
      const driftX = reduced ? 0 : Math.sin(time * .00045 + point.p) * energy;
      const driftY = reduced ? 0 : Math.cos(time * .00039 + point.p) * energy;
      const x = (point.x + dx * response + driftX) * width;
      const y = (point.y + dy * response + driftY) * height;
      const shimmer = reduced ? 1 : .72 + .28 * Math.sin(time * .0011 + point.p);
      signalContext.beginPath();
      signalContext.fillStyle = `rgba(220,222,255,${point.a * shimmer})`;
      signalContext.arc(x, y, point.s * (signalListening ? 1.12 : 1), 0, Math.PI * 2);
      signalContext.fill();
    });
  };

  const voiceButton = document.querySelector('#signal-voice');
  voiceButton.addEventListener('click', () => {
    signalListening = !signalListening;
    voiceButton.setAttribute('aria-pressed', String(signalListening));
    voiceButton.setAttribute('aria-label', signalListening ? 'Stop simulated voice listening' : 'Simulate voice listening');
    document.querySelector('#signal-state').textContent = signalListening ? 'Listening to you' : 'Present and listening';
  });

  // Motion scene 02: discrete, truthful request lifecycle.
  const flowStage = document.querySelector('#flow-stage');
  const flowStatus = document.querySelector('#flow-status');
  const flowMessages = [
    'Ready: request understood',
    'Relevant context is being verified',
    'Proposal prepared; nothing changed yet',
    'Approval received; calendar update running',
    'Verified by calendar read-back'
  ];

  const setFlowStep = (step) => {
    flowStage.dataset.flowStep = String(step);
    flowStatus.textContent = flowMessages[step];
  };

  const runFlow = () => {
    stopFlow();
    setFlowStep(0);
    if (isReduced()) {
      setFlowStep(4);
      return;
    }
    const scale = durationScale();
    [1, 2, 3, 4].forEach((step, index) => {
      flowTimers.push(setTimeout(() => setFlowStep(step), (900 + index * 1050) * scale));
    });
  };
  document.querySelector('[data-replay="choreography"]').addEventListener('click', runFlow);
  document.querySelector('.approve-demo').addEventListener('click', () => {
    stopFlow();
    setFlowStep(3);
    flowTimers.push(setTimeout(() => setFlowStep(4), 850 * durationScale()));
  });

  // Motion scene 03: spatial focus with DOM controls over a lightweight field.
  const atlasCanvas = document.querySelector('#atlas-canvas');
  const atlasContext = atlasCanvas.getContext('2d', { alpha: true });
  const atlasStars = Array.from({ length: 130 }, (_, index) => ({
    x: seeded(index + 9100), y: seeded(index + 9600), a: .03 + seeded(index + 10200) * .14, s: .3 + seeded(index + 10800) * 1.1, p: seeded(index + 11400) * Math.PI * 2
  }));
  const atlasViewport = document.querySelector('#atlas-viewport');
  const atlasNodes = [...document.querySelectorAll('[data-atlas]')];
  const atlasDetails = {
    ava: ['00 / 05', 'AVA', 'Five areas are current. Nothing urgent is hidden, and one schedule conflict deserves attention.', '5', '1'],
    university: ['01 / 05', 'University', "Agile Development starts at 11:00. AVA connected the room change, last week's weak areas, and today's preparation block.", '3', '1'],
    projects: ['02 / 05', 'Projects', 'The interface remodel is live. Hosting and mobile reachability remain the two decisions that change what AVA can do next.', '4', '2'],
    people: ['03 / 05', 'People', 'Lasha has one open follow-up for Friday. No message is scheduled and nothing has been sent.', '2', '1'],
    ideas: ['04 / 05', 'Ideas', 'Personal intelligence, spatial memory, and a quieter daily brief are connected as one product direction.', '3', '1'],
    health: ['05 / 05', 'Health', 'No urgent health commitment is recorded. This area stays quiet instead of inventing pressure.', '0', '0']
  };

  const selectAtlas = (name, focus = false) => {
    const detail = atlasDetails[name];
    if (!detail) return;
    atlasViewport.dataset.focus = name === 'ava' ? '' : name;
    atlasNodes.forEach((node) => node.classList.toggle('is-focus', node.dataset.atlas === name));
    const panel = document.querySelector('#atlas-detail');
    panel.querySelector('.card-kicker').textContent = `Area ${detail[0]}`;
    panel.querySelector('h2').textContent = detail[1];
    panel.querySelector('p').textContent = detail[2];
    const facts = panel.querySelectorAll('.detail-facts b');
    facts[0].textContent = detail[3];
    facts[1].textContent = detail[4];
    if (focus) panel.querySelector('h2').focus?.();
  };
  atlasNodes.forEach((node, index) => {
    node.addEventListener('click', () => selectAtlas(node.dataset.atlas));
    node.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      atlasNodes[(index + direction + atlasNodes.length) % atlasNodes.length].focus();
    });
  });

  const drawAtlas = (time) => {
    const { width, height } = atlasSize;
    atlasContext.clearRect(0, 0, width, height);
    atlasStars.forEach((star) => {
      const drift = isReduced() ? 0 : Math.sin(time * .00025 + star.p) * .008;
      const x = (star.x + drift) * width;
      const y = (star.y + drift * .7) * height;
      atlasContext.beginPath();
      atlasContext.fillStyle = `rgba(170,190,255,${star.a})`;
      atlasContext.arc(x, y, star.s, 0, Math.PI * 2);
      atlasContext.fill();
    });
  };

  // Motion scene 04: a reversible visual proposal, never a real write.
  const dayRibbon = document.querySelector('#day-ribbon');
  const resolveButton = document.querySelector('#resolve-day');
  const toggleDay = (force) => {
    const resolved = typeof force === 'boolean' ? force : !dayRibbon.classList.contains('is-resolved');
    dayRibbon.classList.toggle('is-resolved', resolved);
    resolveButton.textContent = resolved ? 'Reset preview' : 'Resolve the clash';
    const time = document.querySelector('.review-time');
    const note = document.querySelector('.review-note');
    time.textContent = resolved ? '17:30' : '15:00';
    note.textContent = resolved ? 'proposed new time' : 'conflict';
    document.querySelector('#time-status').textContent = resolved ? 'Preview only. Waiting for explicit approval.' : 'No change has been made.';
  };
  resolveButton.addEventListener('click', () => toggleDay());

  // Motion scene 05: pointer-responsive Canvas 2D material and tactile DOM studies.
  const materialCanvas = document.querySelector('#material-canvas');
  const materialContext = materialCanvas.getContext('2d', { alpha: true });
  const materialBlobs = Array.from({ length: 7 }, (_, index) => ({
    x: seeded(index + 12100), y: seeded(index + 12700), r: .12 + seeded(index + 13300) * .2, p: seeded(index + 13900) * Math.PI * 2
  }));

  const drawMaterial = (time) => {
    const { width, height } = materialSize;
    materialContext.clearRect(0, 0, width, height);
    materialContext.globalCompositeOperation = 'lighter';
    materialBlobs.forEach((blob, index) => {
      const motion = isReduced() ? 0 : .04;
      const x = (blob.x + Math.sin(time * .00015 + blob.p) * motion + (pointer.x - .5) * .025) * width;
      const y = (blob.y + Math.cos(time * .00013 + blob.p) * motion + (pointer.y - .5) * .025) * height;
      const radius = blob.r * Math.min(width, height);
      const gradient = materialContext.createRadialGradient(x, y, 0, x, y, radius);
      const color = index % 3 === 0 ? '112,185,255' : index % 3 === 1 ? '169,169,255' : '117,228,184';
      gradient.addColorStop(0, `rgba(${color},.10)`);
      gradient.addColorStop(1, `rgba(${color},0)`);
      materialContext.fillStyle = gradient;
      materialContext.beginPath();
      materialContext.arc(x, y, radius, 0, Math.PI * 2);
      materialContext.fill();
    });
    materialContext.globalCompositeOperation = 'source-over';
  };

  const prism = document.querySelector('[data-tilt]');
  prism.addEventListener('pointermove', (event) => {
    if (isReduced()) return;
    const rect = prism.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    prism.style.setProperty('--mx', `${x * 100}%`);
    prism.style.setProperty('--my', `${y * 100}%`);
    prism.style.transform = `perspective(700px) rotateX(${(y - .5) * -5}deg) rotateY(${(x - .5) * 6}deg)`;
  });
  prism.addEventListener('pointerleave', () => { prism.style.transform = ''; });

  const elasticCard = document.querySelector('#elastic-card');
  const elasticButton = document.querySelector('#elastic-button');
  const setElastic = (pressed) => elasticCard.classList.toggle('is-pressed', pressed);
  ['pointerdown', 'keydown'].forEach((name) => elasticButton.addEventListener(name, (event) => {
    if (name === 'keydown' && ![' ', 'Enter'].includes(event.key)) return;
    setElastic(true);
  }));
  ['pointerup', 'pointercancel', 'pointerleave', 'keyup'].forEach((name) => elasticButton.addEventListener(name, () => setElastic(false)));

  document.querySelector('#kinetic-button').addEventListener('click', () => {
    const card = document.querySelector('.kinetic-card');
    card.classList.toggle('is-ready');
    card.querySelector('h2').setAttribute('aria-label', card.classList.contains('is-ready') ? 'AVA is ready' : 'AVA is thinking');
    card.querySelector('h2 small').textContent = card.classList.contains('is-ready') ? 'is ready' : 'is thinking';
  });

  const resizeCanvases = () => {
    signalSize = fitCanvas(signalCanvas, signalContext);
    atlasSize = fitCanvas(atlasCanvas, atlasContext);
    materialSize = fitCanvas(materialCanvas, materialContext);
    renderFrame(performance.now(), true);
  };

  const renderFrame = (time = 0, single = false) => {
    if (activeScene === 'signal') drawSignal(time);
    if (activeScene === 'atlas') drawAtlas(time);
    if (activeScene === 'material') drawMaterial(time);
    if (!single && !document.hidden && !isReduced()) frame = requestAnimationFrame(renderFrame);
  };

  window.addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX / innerWidth, y: event.clientY / innerHeight };
  }, { passive: true });
  window.addEventListener('resize', resizeCanvases, { passive: true });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame);
    if (!document.hidden && !isReduced()) frame = requestAnimationFrame(renderFrame);
  });

  const replay = (name = activeScene, automatic = false) => {
    const scene = document.querySelector(`[data-scene="${name}"]`);
    scene.classList.remove('is-active');
    void scene.offsetWidth;
    scene.classList.add('is-active');
    if (name === 'signal') {
      signalListening = false;
      voiceButton.setAttribute('aria-pressed', 'false');
      document.querySelector('#signal-state').textContent = 'Present and listening';
    }
    if (name === 'choreography') {
      if (automatic) flowTimers.push(setTimeout(runFlow, 450 * durationScale()));
      else runFlow();
    }
    if (name === 'atlas') selectAtlas('university');
    if (name === 'time') {
      toggleDay(false);
      if (!automatic && !isReduced()) flowTimers.push(setTimeout(() => toggleDay(true), 650 * durationScale()));
    }
    if (name === 'material') {
      document.querySelector('.kinetic-card').classList.remove('is-ready');
      setElastic(false);
    }
  };

  document.querySelector('#replay-active').addEventListener('click', () => replay());

  // Research drawer and prototype-only feedback.
  const notes = document.querySelector('#design-notes');
  const notesToggle = document.querySelector('#notes-toggle');
  const notesClose = document.querySelector('#notes-close');
  const notesScrim = document.querySelector('#notes-scrim');
  let previousFocus = null;
  const setNotes = (open) => {
    notes.setAttribute('aria-hidden', String(!open));
    notesToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      previousFocus = document.activeElement;
      notesClose.focus();
    } else {
      previousFocus?.focus?.();
    }
  };
  notesToggle.addEventListener('click', () => setNotes(notes.getAttribute('aria-hidden') === 'true'));
  notesClose.addEventListener('click', () => setNotes(false));
  notesScrim.addEventListener('click', () => setNotes(false));

  const toast = document.querySelector('#prototype-toast');
  let toastTimer;
  const announcePrototype = () => {
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
  };
  document.querySelectorAll('[data-prototype-form]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    announcePrototype();
  }));
  document.querySelectorAll('.brief-card button, .atlas-detail > button, .material-card .magnetic-button, .temporal-cards button').forEach((button) => button.addEventListener('click', announcePrototype));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && notes.getAttribute('aria-hidden') === 'false') {
      setNotes(false);
      return;
    }
    if (event.target.matches('input, textarea, select, summary')) return;
    if (event.key >= '1' && event.key <= '5') setScene(sceneOrder[Number(event.key) - 1]);
    if (event.key.toLowerCase() === 'm') {
      manualReduced = !manualReduced;
      syncMotion();
      replay(activeScene);
    }
    if (event.key.toLowerCase() === 'r') replay(activeScene);
  });

  buildSignalPoints();
  syncMotion();
  resizeCanvases();
  const initial = location.hash.slice(1);
  setScene(sceneMeta[initial] ? initial : 'signal', false);
  cancelAnimationFrame(frame);
  if (!isReduced()) frame = requestAnimationFrame(renderFrame);
})();
