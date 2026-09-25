(() => {
  const root = document.documentElement;
  const concepts = [...document.querySelectorAll('[data-concept]')];
  const tabs = [...document.querySelectorAll('.concept-tab')];
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let manualReduced = reduceQuery.matches;
  let activeConcept = 'presence';

  const setConcept = (name, updateHash = true) => {
    if (!concepts.some((node) => node.dataset.concept === name)) return;
    activeConcept = name;
    concepts.forEach((node) => {
      const active = node.dataset.concept === name;
      node.hidden = !active;
      node.classList.toggle('is-active', active);
    });
    tabs.forEach((tab) => {
      const active = tab.dataset.target === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    if (updateHash) history.replaceState(null, '', `#${name}`);
    document.title = `AVA — ${name[0].toUpperCase()}${name.slice(1)}`;
    if (name === 'presence') requestAnimationFrame(() => resizeCanvas());
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => setConcept(tab.dataset.target)));
  const initial = location.hash.slice(1);
  setConcept(initial || 'presence', false);

  const motionButton = document.querySelector('#motion-toggle');
  const syncMotion = () => {
    root.dataset.motion = manualReduced ? 'reduced' : 'full';
    motionButton.setAttribute('aria-pressed', String(manualReduced));
    motionButton.setAttribute('aria-label', manualReduced ? 'Use full motion' : 'Use reduced motion');
  };
  motionButton.addEventListener('click', () => { manualReduced = !manualReduced; syncMotion(); });
  reduceQuery.addEventListener?.('change', (event) => { manualReduced = event.matches; syncMotion(); });
  syncMotion();

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, textarea, summary')) return;
    if (event.key >= '1' && event.key <= '3') setConcept(['presence', 'constellation', 'continuum'][Number(event.key) - 1]);
    if (event.key.toLowerCase() === 'm') { manualReduced = !manualReduced; syncMotion(); }
  });

  const details = {
    ava: ['AVA', 'Four signals are in view: your next event, two open decisions, and one person to follow up with.', ['Open today', 'Ask what matters']],
    university: ['University', 'Agile Development begins at 11:00 in B2.14. Your lecture note already contains the sprint review questions from last week.', ['Open lecture note', 'Plan the hour before']],
    projects: ['Projects', 'The AVA interface direction and always-on hosting both need decisions. The interface review is ready first.', ['Open interface review', 'Compare hosting options']],
    people: ['People', 'You planned to follow up with Lasha on Friday. There is no message scheduled and nothing has been sent.', ['Open context', 'Draft a follow-up']],
    ideas: ['Ideas', 'Three threads are active: personal intelligence, spatial memory, and a quieter proactive daily brief.', ['Continue latest idea', 'See all idea threads']]
  };
  document.querySelectorAll('[data-detail]').forEach((button, index) => button.addEventListener('click', () => {
    const [title, body, actions] = details[button.dataset.detail];
    const sheet = document.querySelector('#life-detail');
    sheet.querySelector('.sheet-index').textContent = `${String(index + 1).padStart(2, '0')} / 05`;
    sheet.querySelector('h2').textContent = title;
    sheet.querySelector('p').textContent = body;
    sheet.querySelectorAll('.detail-actions button').forEach((action, actionIndex) => { action.textContent = actions[actionIndex]; });
  }));

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
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && notes.getAttribute('aria-hidden') === 'false') setNotes(false);
  });

  const toast = document.querySelector('#demo-toast');
  let toastTimer;
  const announceDemo = () => {
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  };
  document.querySelectorAll('[data-demo-form]').forEach((form) => form.addEventListener('submit', (event) => {
    event.preventDefault();
    announceDemo();
  }));
  document.querySelectorAll('button').forEach((button) => {
    if (button.closest('.concept-tabs, .lab-actions, .design-notes') || button.matches('[data-detail], [type="submit"]')) return;
    button.addEventListener('click', announceDemo);
  });

  const canvas = document.querySelector('#presence-canvas');
  const context = canvas.getContext('2d', { alpha: true });
  const points = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let pointer = { x: .5, y: .48 };
  let animationFrame = 0;

  const seeded = (seed) => {
    const value = Math.sin(seed * 129.9898) * 43758.5453;
    return value - Math.floor(value);
  };

  const buildPortrait = () => {
    points.length = 0;
    const cx = .69;
    const cy = .47;
    for (let index = 0; index < 1320; index += 1) {
      const theta = seeded(index + 2) * Math.PI * 2;
      const radius = Math.sqrt(seeded(index + 501));
      const edge = 1 - radius;
      let x = cx + Math.cos(theta) * radius * .145;
      let y = cy + Math.sin(theta) * radius * .31;
      const jaw = Math.max(0, (y - cy) / .31);
      x += Math.cos(theta) * jaw * .038;
      const eyeBand = Math.exp(-Math.pow((y - (cy - .065)) / .018, 2));
      const eyeGap = Math.exp(-Math.pow((Math.abs(x - cx) - .055) / .021, 2));
      const mouth = Math.exp(-Math.pow((y - (cy + .105)) / .014, 2)) * Math.exp(-Math.pow((x - cx) / .065, 2));
      const nose = Math.exp(-Math.pow((x - cx) / .012, 2)) * Math.exp(-Math.pow((y - (cy + .018)) / .085, 2));
      const feature = eyeBand * eyeGap + mouth + nose * .5;
      points.push({ x, y, alpha: .12 + edge * .46 + feature * .72, size: .45 + seeded(index + 830) * 1.15, phase: seeded(index + 1200) * Math.PI * 2 });
    }
    for (let index = 0; index < 360; index += 1) {
      points.push({ x: seeded(index + 3000), y: seeded(index + 3800), alpha: .035 + seeded(index + 4200) * .1, size: .3 + seeded(index + 4700), phase: seeded(index + 5000) * Math.PI * 2 });
    }
  };

  const resizeCanvas = () => {
    if (!canvas || activeConcept !== 'presence') return;
    const rect = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };

  const render = (time = 0) => {
    context.clearRect(0, 0, width, height);
    const reduced = root.dataset.motion === 'reduced';
    const drift = reduced ? 0 : Math.sin(time * .00025) * .0025;
    for (const point of points) {
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const response = reduced ? 0 : Math.max(0, .16 - distance) * .05;
      const x = (point.x + dx * response + drift * Math.sin(point.phase)) * width;
      const y = (point.y + dy * response + drift * Math.cos(point.phase)) * height;
      const shimmer = reduced ? 1 : .78 + .22 * Math.sin(time * .001 + point.phase);
      context.beginPath();
      context.fillStyle = `rgba(218,222,255,${point.alpha * shimmer})`;
      context.arc(x, y, point.size, 0, Math.PI * 2);
      context.fill();
    }
    if (!document.hidden) animationFrame = requestAnimationFrame(render);
  };

  window.addEventListener('pointermove', (event) => { pointer = { x: event.clientX / innerWidth, y: event.clientY / innerHeight }; }, { passive: true });
  window.addEventListener('resize', resizeCanvas, { passive: true });
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(animationFrame);
    if (!document.hidden) animationFrame = requestAnimationFrame(render);
  });
  buildPortrait();
  resizeCanvas();
  animationFrame = requestAnimationFrame(render);
})();
