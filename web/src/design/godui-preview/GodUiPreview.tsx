import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Focus,
  Home,
  Lightbulb,
  Mic,
  NotebookPen,
  Orbit,
  Plus,
  Sparkles,
  Star,
  Target,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import "./godui-preview.css";

type AssistantState = "listening" | "thinking" | "ready";

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function AmbientField({ warp }: { warp: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let frame = 0;
    let width = 1;
    let height = 1;
    let previous = performance.now();
    let elapsed = 0;
    const stars = Array.from({ length: 86 }, (_, index) => ({
      angle: (index / 86) * Math.PI * 2 + ((index * 17) % 13) * 0.04,
      radius: 0.04 + ((index * 29) % 100) / 115,
      depth: 0.3 + ((index * 43) % 70) / 100,
    }));

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const paint = (now: number) => {
      const delta = Math.min(now - previous, 48);
      previous = now;
      elapsed += reduced ? 0 : delta * (warp ? 0.0022 : 0.00045);
      context.clearRect(0, 0, width, height);

      const wash = context.createRadialGradient(width * 0.52, height * 0.35, 10, width * 0.52, height * 0.45, width * 0.72);
      wash.addColorStop(0, "rgba(112, 96, 255, .23)");
      wash.addColorStop(0.42, "rgba(39, 188, 255, .10)");
      wash.addColorStop(1, "rgba(2, 5, 13, 0)");
      context.fillStyle = wash;
      context.fillRect(0, 0, width, height);

      const centerX = width * 0.54;
      const centerY = height * 0.42;
      for (const star of stars) {
        const pulse = ((star.radius + elapsed * star.depth) % 1) ** 1.65;
        const x = centerX + Math.cos(star.angle) * pulse * width * 0.78;
        const y = centerY + Math.sin(star.angle) * pulse * height * 0.88;
        const length = warp ? 2 + pulse * 32 : 1 + pulse * 3;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.cos(star.angle) * length, y + Math.sin(star.angle) * length);
        context.strokeStyle = `rgba(${160 + Math.round(star.depth * 80)}, ${190 + Math.round(star.depth * 50)}, 255, ${0.18 + pulse * 0.62})`;
        context.lineWidth = 0.6 + pulse * 1.1;
        context.stroke();
      }

      for (let layer = 0; layer < 4; layer += 1) {
        context.beginPath();
        for (let x = -20; x <= width + 20; x += 12) {
          const baseline = height * (0.62 + layer * 0.055);
          const wave = Math.sin(x * (0.008 + layer * 0.0018) + elapsed * (2.1 + layer * 0.34)) * (34 - layer * 5);
          const secondary = Math.cos(x * 0.0035 - elapsed * 1.6) * 18;
          const y = baseline + wave + secondary;
          if (x === -20) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.lineTo(width + 20, height + 20);
        context.lineTo(-20, height + 20);
        const gradient = context.createLinearGradient(0, height * 0.45, width, height);
        gradient.addColorStop(0, `rgba(42, 126, 255, ${0.12 - layer * 0.018})`);
        gradient.addColorStop(0.5, `rgba(130, 94, 255, ${0.2 - layer * 0.025})`);
        gradient.addColorStop(1, `rgba(49, 219, 255, ${0.08 - layer * 0.012})`);
        context.fillStyle = gradient;
        context.fill();
      }

      if (!reduced) frame = requestAnimationFrame(paint);
    };

    resize();
    paint(performance.now());
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [reduced, warp]);

  return <canvas ref={canvasRef} className="gdu-ambient" aria-hidden="true" />;
}

function MetalButton({ children, icon, onClick, label }: { children?: ReactNode; icon?: ReactNode; onClick?: () => void; label?: string }) {
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const id = useRef(0);
  const press = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX - bounds.left : bounds.width / 2;
    const pointerY = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY - bounds.top : bounds.height / 2;
    const ripple = { id: id.current++, x: pointerX, y: pointerY };
    setRipples((current) => [...current, ripple]);
    window.setTimeout(() => setRipples((current) => current.filter((item) => item.id !== ripple.id)), 650);
    onClick?.();
  };
  return (
    <button type="button" className={`gdu-metal ${icon && !children ? "gdu-metal-icon" : ""}`} onClick={press} aria-label={label}>
      <span className="gdu-metal-chrome" aria-hidden="true" />
      <span className="gdu-metal-core"><span className="gdu-metal-label">{icon}{children}</span></span>
      {ripples.map((ripple) => <span key={ripple.id} className="gdu-ripple" style={{ left: ripple.x, top: ripple.y }} aria-hidden="true" />)}
    </button>
  );
}

function SplitClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Dublin",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="gdu-flap" aria-label={`Dublin time ${time}`}>{time.split("").map((character, index) => <span key={`${index}-${character}`} className={character === ":" ? "gdu-flap-colon" : "gdu-flap-cell"}>{character}</span>)}</span>;
}

function DynamicIsland({ state, onChange }: { state: AssistantState; onChange: (state: AssistantState) => void }) {
  const stateLabel = state === "listening" ? "Listening" : state === "thinking" ? "Thinking through your day" : "Ready when you are";
  return (
    <div className={`gdu-island gdu-island-${state}`} role="status" aria-live="polite">
      <button type="button" className="gdu-island-core" onClick={() => onChange(state === "ready" ? "listening" : state === "listening" ? "thinking" : "ready")} aria-label={`${stateLabel}. Change preview state.`}>
        <span className="gdu-orb"><span /></span>
        <span className="gdu-island-copy"><strong>AVA</strong><small>{stateLabel}</small></span>
        <span className="gdu-wave-bars" aria-hidden="true">{[0, 1, 2, 3, 4].map((bar) => <i key={bar} style={{ animationDelay: `${bar * -0.11}s` }} />)}</span>
      </button>
    </div>
  );
}

const flowNodes = [
  { id: "you", label: "You", detail: "Plan my week", x: 3, y: 42 },
  { id: "ava", label: "AVA", detail: "Understands", x: 23, y: 42 },
  { id: "memory", label: "Memory", detail: "Priorities", x: 45, y: 10 },
  { id: "calendar", label: "Calendar", detail: "Commitments", x: 45, y: 70 },
  { id: "synth", label: "Plan", detail: "Balances both", x: 69, y: 42 },
  { id: "done", label: "Your week", detail: "Clear next step", x: 88, y: 42 },
];

const flowEdges = [
  ["you", "ava"], ["ava", "memory"], ["ava", "calendar"], ["memory", "synth"], ["calendar", "synth"], ["synth", "done"],
] as const;

function AgentFlow() {
  const [active, setActive] = useState(0);
  const node = (id: string) => flowNodes.find((item) => item.id === id)!;
  return (
    <section className="gdu-section gdu-flow-section" aria-labelledby="flow-heading">
      <div className="gdu-section-copy">
        <span className="gdu-kicker">Agent flow · animated beam</span>
        <h2 id="flow-heading">See AVA think without watching a terminal.</h2>
        <p>A concise, truthful route from your request to evidence—each beam is a real stage, not decoration.</p>
      </div>
      <div className="gdu-flow-shell">
        <div className="gdu-flow" role="group" aria-label="Your request moves through AVA, memory and calendar into a balanced weekly plan">
          <svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="gdu-beam-gradient"><stop stopColor="#8a76ff"/><stop offset=".5" stopColor="#41d9ff"/><stop offset="1" stopColor="#d7fbff"/></linearGradient></defs>
            {flowEdges.map(([from, to], index) => {
              const start = node(from); const end = node(to);
              const x1 = start.x * 10 + 60; const y1 = start.y * 3 + 28; const x2 = end.x * 10; const y2 = end.y * 3 + 28;
              const middle = (x1 + x2) / 2;
              return <path key={`${from}-${to}`} className={index <= active ? "gdu-beam gdu-beam-active" : "gdu-beam"} d={`M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`} pathLength="1" />;
            })}
          </svg>
          {flowNodes.map((item, index) => <button key={item.id} type="button" className={`gdu-flow-node ${index <= active + 1 ? "is-active" : ""}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} onClick={() => setActive(Math.max(0, index - 1))}><strong>{item.label}</strong><span>{item.detail}</span></button>)}
        </div>
        <div className="gdu-step-controls">
          <button type="button" onClick={() => setActive((value) => Math.max(0, value - 1))} aria-label="Previous workflow stage"><ChevronLeft size={16} /></button>
          <span>Stage {active + 1} of {flowEdges.length}</span>
          <button type="button" onClick={() => setActive((value) => Math.min(flowEdges.length - 1, value + 1))} aria-label="Next workflow stage"><ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}

function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [style, setStyle] = useState<CSSProperties>({});
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    setStyle({ "--gdu-rx": `${-y * 7}deg`, "--gdu-ry": `${x * 9}deg`, "--gdu-gx": `${(x + 0.5) * 100}%`, "--gdu-gy": `${(y + 0.5) * 100}%` } as CSSProperties);
  };
  return <div className={`gdu-tilt ${className}`} style={style} onPointerMove={move} onPointerLeave={() => setStyle({})}>{children}<span className="gdu-tilt-glare" aria-hidden="true" /></div>;
}

const priorities = [
  { icon: CalendarDays, eyebrow: "10:00", title: "Agile Development", detail: "Lecture · attend", tone: "violet" },
  { icon: Target, eyebrow: "ONE THING", title: "Finish the reflection", detail: "40 minutes of focus", tone: "cyan" },
  { icon: NotebookPen, eyebrow: "NOTES", title: "Two ideas waiting", detail: "AVA connected them for you", tone: "rose" },
];

function LifeBento() {
  return (
    <section className="gdu-section" aria-labelledby="bento-heading">
      <div className="gdu-section-copy">
        <span className="gdu-kicker">Bento · tilt · progressive reveal</span>
        <h2 id="bento-heading">Your life, not a control panel.</h2>
        <p>The important parts are visible first. Everything else waits until you ask for it.</p>
      </div>
      <div className="gdu-bento">
        <TiltCard className="gdu-bento-primary">
          <span className="gdu-card-icon"><Sparkles size={19} /></span>
          <div><span className="gdu-card-eyebrow">AVA'S READ</span><h3>Today is lighter than it looks.</h3><p>Your lecture and reflection fit comfortably. Protect 14:00–14:40 and the rest of the day stays open.</p></div>
          <MetalButton><Focus size={15} /> Start focus</MetalButton>
        </TiltCard>
        {priorities.map(({ icon: Icon, eyebrow, title, detail, tone }) => <TiltCard key={title} className={`gdu-bento-small gdu-tone-${tone}`}><span className="gdu-card-icon"><Icon size={18} /></span><div><span className="gdu-card-eyebrow">{eyebrow}</span><h3>{title}</h3><p>{detail}</p></div><ArrowRight className="gdu-card-arrow" size={18} /></TiltCard>)}
        <div className="gdu-bento-wide">
          <div><span className="gdu-card-eyebrow">DUBLIN · LIVE</span><h3>Everything important is in reach.</h3></div>
          <SplitClock />
        </div>
      </div>
    </section>
  );
}

const timeline = [
  { time: "08:30", title: "Morning brief", body: "Three priorities, one conflict resolved before it reaches you.", icon: Sparkles },
  { time: "10:00", title: "Agile lecture", body: "AVA already surfaced the weak areas from your last notes.", icon: BookOpen },
  { time: "14:00", title: "Reflection focus", body: "A protected 40-minute block with the right sources attached.", icon: Focus },
  { time: "19:30", title: "Quiet close", body: "What moved, what did not, and tomorrow's first sensible step.", icon: Check },
];

function DayTimeline() {
  const [active, setActive] = useState(1);
  return (
    <section className="gdu-section gdu-timeline-section" aria-labelledby="timeline-heading">
      <div className="gdu-section-copy">
        <span className="gdu-kicker">Scroll timeline · stepper</span>
        <h2 id="timeline-heading">A day that explains itself.</h2>
        <p>Chronology becomes a calm story, with detail only where it is useful.</p>
      </div>
      <div className="gdu-timeline">
        <div className="gdu-timeline-rail" aria-hidden="true"><span style={{ height: `${(active / (timeline.length - 1)) * 100}%` }} /></div>
        {timeline.map(({ time, title, body, icon: Icon }, index) => <button type="button" key={time} className={`gdu-timeline-item ${index <= active ? "is-active" : ""}`} onClick={() => setActive(index)} aria-pressed={index === active}><span className="gdu-timeline-dot"><Icon size={16} /></span><span className="gdu-timeline-time">{time}</span><span className="gdu-timeline-copy"><strong>{title}</strong><small>{body}</small></span></button>)}
      </div>
    </section>
  );
}

const noteStacks = [
  { label: "University", meta: "12 living notes", icon: "U", detail: "Lectures, weak areas, explanations and the decisions you reached with AVA." },
  { label: "AVA", meta: "8 active ideas", icon: "A", detail: "Product thinking, research, decisions and the next experiments worth running." },
  { label: "Life", meta: "5 open threads", icon: "L", detail: "Plans, people, practical loose ends and anything you do not want to carry alone." },
  { label: "Archive", meta: "31 resolved", icon: "✓", detail: "Finished decisions remain searchable without competing for your attention." },
];

function ProgressiveNotes() {
  const [active, setActive] = useState(0);
  return (
    <section className="gdu-section" aria-labelledby="notes-heading">
      <div className="gdu-section-copy">
        <span className="gdu-kicker">Progressive cards · cover flow</span>
        <h2 id="notes-heading">Memory with shape.</h2>
        <p>Folders feel physical enough to understand, but stay light enough to move through quickly.</p>
      </div>
      <div className="gdu-notes-grid">
        <div className="gdu-progressive">
          {noteStacks.map((item, index) => <button type="button" key={item.label} className={`gdu-progressive-card ${index === active ? "is-active" : ""}`} onClick={() => setActive(index)} aria-expanded={index === active}><span className="gdu-progressive-icon">{item.icon}</span><span className="gdu-progressive-main"><strong>{item.label}</strong><small>{item.meta}</small>{index === active && <p>{item.detail}</p>}</span><ChevronRight size={17} /></button>)}
        </div>
        <CoverFlow active={active} onChange={setActive} />
      </div>
    </section>
  );
}

function CoverFlow({ active, onChange }: { active: number; onChange: (value: number) => void }) {
  return (
    <div className="gdu-cover-wrap">
      <div className="gdu-coverflow" aria-label="Life area covers">
        {noteStacks.map((item, index) => {
          const delta = index - active;
          return <button type="button" key={item.label} className={`gdu-cover ${delta === 0 ? "is-active" : ""}`} style={{ "--gdu-cover-x": delta, zIndex: 10 - Math.abs(delta) } as CSSProperties} onClick={() => onChange(index)} aria-label={`Open ${item.label}`}><span>{item.icon}</span><strong>{item.label}</strong><small>{item.meta}</small></button>;
        })}
      </div>
      <div className="gdu-cover-controls"><button type="button" onClick={() => onChange((active - 1 + noteStacks.length) % noteStacks.length)} aria-label="Previous life area"><ChevronLeft size={17} /></button><span>{active + 1} / {noteStacks.length}</span><button type="button" onClick={() => onChange((active + 1) % noteStacks.length)} aria-label="Next life area"><ChevronRight size={17} /></button></div>
    </div>
  );
}

const panels = [
  { title: "Learn", detail: "Coursework, reading, explanations", icon: BookOpen, className: "learn" },
  { title: "Build", detail: "AVA, projects, experiments", icon: WandSparkles, className: "build" },
  { title: "Think", detail: "Ideas, decisions, open questions", icon: Brain, className: "think" },
  { title: "Live", detail: "People, plans, everyday life", icon: Star, className: "live" },
];

function LifeAccordion() {
  const [active, setActive] = useState(1);
  return (
    <section className="gdu-section" aria-labelledby="areas-heading">
      <div className="gdu-section-copy"><span className="gdu-kicker">Image accordion · card swap</span><h2 id="areas-heading">AVA should feel different in every part of your life.</h2><p>Not separate apps—different lenses over one continuous assistant.</p></div>
      <div className="gdu-accordion">
        {panels.map(({ title, detail, icon: Icon, className }, index) => <button type="button" key={title} className={`gdu-accordion-panel gdu-panel-${className} ${index === active ? "is-active" : ""}`} onClick={() => setActive(index)} aria-expanded={index === active}><span className="gdu-accordion-glow" aria-hidden="true" /><Icon size={22} /><span><strong>{title}</strong><small>{detail}</small></span></button>)}
      </div>
      <CardSwap />
    </section>
  );
}

const suggestions = [
  { title: "Continue where we stopped", body: "Your Agile reflection has one unresolved point: whether the evidence supports the conclusion." },
  { title: "Protect tomorrow morning", body: "Moving one flexible task gives you a clean two-hour study block before the lecture." },
  { title: "Connect these two ideas", body: "Your note about proactive context solves the same problem as yesterday's reminder discussion." },
];

function CardSwap() {
  const [active, setActive] = useState(0);
  return (
    <div className="gdu-swap-shell">
      <div className="gdu-swap-copy"><span className="gdu-card-eyebrow">AVA'S NEXT MOVE</span><h3>Suggestions should arrive with judgment.</h3><div className="gdu-swap-dots">{suggestions.map((item, index) => <button key={item.title} type="button" className={index === active ? "is-active" : ""} onClick={() => setActive(index)} aria-label={`Show suggestion ${index + 1}`} />)}</div></div>
      <div className="gdu-swap-stack">
        {suggestions.map((item, index) => { const delta = (index - active + suggestions.length) % suggestions.length; return <button type="button" key={item.title} className={`gdu-swap-card ${delta === 0 ? "is-active" : ""}`} style={{ "--gdu-swap": delta, zIndex: suggestions.length - delta } as CSSProperties} onClick={() => setActive(index)}><Sparkles size={18} /><strong>{item.title}</strong><span>{item.body}</span></button>; })}
      </div>
    </div>
  );
}

function TactileLab() {
  const [fabOpen, setFabOpen] = useState(false);
  const [toast, setToast] = useState("No action taken — this is a preview.");
  return (
    <section className="gdu-section" aria-labelledby="tactile-heading">
      <div className="gdu-section-copy"><span className="gdu-kicker">Liquid metal · jelly · gooey FAB · elastic text</span><h2 id="tactile-heading" className="gdu-elastic" data-text="Small actions should feel excellent.">Small actions should feel excellent.</h2><p>The motion rewards intent, never delays it. Try everything below.</p></div>
      <div className="gdu-tactile-stage">
        <div className="gdu-tactile-buttons">
          <MetalButton onClick={() => setToast("AVA would start listening here.")}><Mic size={15} /> Talk to AVA</MetalButton>
          <MetalButton icon={<Sparkles size={17} />} label="Ask AVA" onClick={() => setToast("A clean new request would open here.")} />
          <button type="button" className="gdu-jelly" onClick={() => setToast("Your day would open here.")}><span>Open today</span><ArrowRight size={16} /></button>
        </div>
        <div className={`gdu-fab ${fabOpen ? "is-open" : ""}`}>
          <div className="gdu-fab-actions" aria-hidden={!fabOpen}>
            <button type="button" tabIndex={fabOpen ? 0 : -1} onClick={() => setToast("Quick note selected.")}><NotebookPen size={17} /><span>Note</span></button>
            <button type="button" tabIndex={fabOpen ? 0 : -1} onClick={() => setToast("New idea selected.")}><Lightbulb size={17} /><span>Idea</span></button>
            <button type="button" tabIndex={fabOpen ? 0 : -1} onClick={() => setToast("Reminder selected.")}><Clock3 size={17} /><span>Remind</span></button>
          </div>
          <button type="button" className="gdu-fab-main" onClick={() => setFabOpen((value) => !value)} aria-expanded={fabOpen} aria-label={fabOpen ? "Close quick actions" : "Open quick actions"}>{fabOpen ? <X size={20} /> : <Plus size={20} />}</button>
        </div>
        <p className="gdu-preview-toast" role="status">{toast}</p>
      </div>
    </section>
  );
}

function PreviewHeader() {
  return <header className="gdu-nav"><a href="#top" className="gdu-brand"><span className="gdu-brand-mark">A</span><span>AVA concept lab</span></a><nav aria-label="Preview sections"><a href="#assistant">Assistant</a><a href="#flow">Flow</a><a href="#memory">Memory</a><a href="#controls">Controls</a></nav><span className="gdu-preview-chip">Preview · no real actions</span></header>;
}

export function GodUiPreview() {
  const [assistantState, setAssistantState] = useState<AssistantState>("ready");
  const [warp, setWarp] = useState(false);
  const reduced = useReducedMotion();
  const greeting = useMemo(() => {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hour12: false }).format(new Date()));
    return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  }, []);

  return (
    <div className="gdu-root" data-testid="godui-preview" id="top">
      <PreviewHeader />
      <main>
        <section className={`gdu-hero ${warp ? "is-warping" : ""}`} id="assistant">
          <AmbientField warp={warp && !reduced} />
          <div className="gdu-hero-noise" aria-hidden="true" />
          <DynamicIsland state={assistantState} onChange={setAssistantState} />
          <div className="gdu-hero-copy">
            <span className="gdu-breadcrumb"><Home size={13} /> Home <ChevronRight size={12} /> Thursday</span>
            <p className="gdu-hero-kicker">PERSONAL INTELLIGENCE · ALWAYS IN CONTEXT</p>
            <h1>{greeting}, Niko.<br /><em>Everything important is under control.</em></h1>
            <p className="gdu-hero-lede">One conversation across your schedule, notes, ideas and life. AVA understands what matters, then makes the next move obvious.</p>
            <div className="gdu-hero-actions">
              <MetalButton onClick={() => setAssistantState("listening")}><Mic size={15} /> Talk to AVA</MetalButton>
              <button type="button" className="gdu-warp-toggle" onClick={() => setWarp((value) => !value)} aria-pressed={warp}><Orbit size={17} />{warp ? "Leave focus" : "Enter focus"}</button>
            </div>
          </div>
          <div className="gdu-hero-brief">
            <span className="gdu-card-eyebrow">THE ONE THING</span>
            <div className="gdu-brief-ring"><span>72%</span></div>
            <h2>Finish your Agile reflection</h2>
            <p>One argument remains. AVA has the relevant lecture notes ready.</p>
            <button type="button">Continue <ArrowRight size={15} /></button>
          </div>
          <button type="button" className="gdu-scroll-cue" onClick={() => document.querySelector("#overview")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" })}>Explore the system <span aria-hidden="true">↓</span></button>
        </section>

        <div className="gdu-content" id="overview">
          <LifeBento />
          <div id="flow"><AgentFlow /></div>
          <DayTimeline />
          <div id="memory"><ProgressiveNotes /></div>
          <LifeAccordion />
          <div id="controls"><TactileLab /></div>
        </div>
      </main>
      <footer><span>AVA × GodUI study</span><span>Interactive prototype · nothing here changes your data</span></footer>
    </div>
  );
}
