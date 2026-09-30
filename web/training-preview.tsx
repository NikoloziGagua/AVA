// Scratch mockup of a Training tab (not part of the app; do not commit).
// Calendar commitments are Niko's real ones for 1-10 Oct; sessions, methods and numbers are examples.
import { StrictMode, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Check, Link2, Mic, PlayCircle, Plus, Sparkles, X } from "lucide-react";
import "./src/theme.css";
import { startDesignRuntime } from "./src/design/look.js";
import { Button, Chip, ProgressRing, Receipt, Row, StatusIsland, Surface, Tag, TextArea, Tile, TileGrid } from "./src/design/index.js";
import { Atmosphere } from "./src/design/metal/Atmosphere.js";
import { MetalObject } from "./src/design/metal/MetalObject.js";

startDesignRuntime();

type D = "bjj" | "boxing" | "kick" | "mma" | "strength" | "run";
const DISC: Record<D, { label: string; colour: string }> = {
  bjj: { label: "Jiu-jitsu", colour: "var(--ds-kind-lecture)" }, boxing: { label: "Boxing", colour: "var(--ds-danger)" },
  kick: { label: "Kickboxing", colour: "var(--ds-warning)" }, mma: { label: "MMA", colour: "var(--ds-info)" },
  strength: { label: "Strength", colour: "var(--ds-kind-event)" }, run: { label: "Running", colour: "var(--ds-trace)" },
};
type Item = { time: string; title: string; d?: D; state: "commitment" | "booked" | "proposed" | "warning"; note?: string };
const DAYS: Array<{ label: string; items: Item[]; rest?: boolean }> = [
  { label: "Thu 1 Oct", items: [
    { time: "09:00–10:00", title: "Data Science", state: "commitment" }, { time: "11:00–12:00", title: "Concurrent Development", state: "commitment" },
    { time: "18:00–19:15", title: "Boxing: jab–cross, slip-roll counter, 6 bag rounds", d: "boxing", state: "proposed", note: "Free after lectures. Tests the slip-roll method." }] },
  { label: "Fri 2 Oct", items: [{ time: "07:30–08:10", title: "Easy run, 5 km", d: "run", state: "proposed", note: "Low load after boxing." }] },
  { label: "Sat 3 Oct", items: [{ time: "11:00–12:15", title: "Strength A: squat, hinge, carries", d: "strength", state: "proposed" }] },
  { label: "Sun 4 Oct", rest: true, items: [{ time: "Any time", title: "Mobility 20 min", d: "bjj", state: "proposed", note: "Rest day. Readiness has dipped." }] },
  { label: "Mon 5 Oct", items: [
    { time: "09:00–11:00", title: "Agile Software Development", state: "commitment" }, { time: "11:00–13:00", title: "Concurrent Development Practical", state: "commitment" },
    { time: "18:30–19:45", title: "Kickboxing: pads, low-kick defence", d: "kick", state: "proposed" }] },
  { label: "Tue 6 Oct", items: [
    { time: "09:00–11:00", title: "Data Science", state: "commitment" }, { time: "13:00–15:00", title: "Data Science", state: "commitment" },
    { time: "19:00–21:00", title: "Gym / Jujitsu", d: "bjj", state: "booked", note: "Already in your calendar. I planned around it." }] },
  { label: "Wed 7 Oct", items: [
    { time: "13:20–14:30", title: "Run (two entries, 13:20 and 14:00)", d: "run", state: "warning", note: "Looks like one run entered twice. Merge them?" },
    { time: "20:00–22:00", title: "Gym", d: "strength", state: "booked" }] },
  { label: "Thu 8 Oct", items: [
    { time: "09:00–10:00", title: "Data Science", state: "commitment" }, { time: "11:00–12:00", title: "Concurrent Development", state: "commitment" },
    { time: "18:00–19:30", title: "MMA: light sparring, cage wrestling", d: "mma", state: "proposed" }] },
  { label: "Fri 9 Oct", items: [{ time: "17:00–18:00", title: "Strength B: press, pull, neck", d: "strength", state: "proposed" }] },
  { label: "Sat 10 Oct", items: [{ time: "10:00–11:10", title: "Long run, 10 km easy", d: "run", state: "proposed" }] },
];
const BALANCE: Array<[D, number, number]> = [["bjj", 1, 2], ["boxing", 1, 2], ["kick", 1, 1], ["mma", 1, 1], ["strength", 3, 2], ["run", 3, 3]];

const dot = (d: D) => <span className="block h-2.5 w-2.5 rounded-sm" style={{ background: DISC[d].colour }} />;

function Plan() {
  const [approved, setApproved] = useState<Set<string>>(new Set());
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-body text-ink-2">A 10-day cycle planned around your lectures and what's already booked. Nothing is added to your calendar until you approve it.</p>
      <Button variant="solid" leading={<Check size={16} />} onClick={() => setApproved(new Set(DAYS.flatMap((day) => day.items.filter((i) => i.state === "proposed").map((i) => day.label + i.time))))}>Approve all 8</Button>
    </div>
    {DAYS.map((day) => <section key={day.label} className="tr-day">
      <div className="tr-day-label"><strong>{day.label.split(" ")[0]}</strong><span>{day.label.split(" ").slice(1).join(" ")}</span>{day.rest && <Tag>Rest</Tag>}</div>
      <div className="grid gap-2">
        {day.items.map((item) => {
          const key = day.label + item.time, done = approved.has(key);
          return <div key={key} className="tr-item" data-state={done ? "booked" : item.state} style={{ "--d": item.d ? DISC[item.d].colour : "var(--ds-ink-3)" } as CSSProperties}>
            <span className="tr-time">{item.time}</span>
            <span className="grid gap-0.5 min-w-0">
              <span className="text-body text-ink">{item.title}</span>
              {item.note && <span className="text-meta text-ink-3">{item.note}</span>}
            </span>
            <span className="flex items-center gap-1.5">
              {item.state === "commitment" && <Tag>Lecture</Tag>}
              {item.state === "booked" || done ? <Tag tone="success">In calendar</Tag> : null}
              {item.state === "proposed" && !done && <><Button size="sm" variant="solid" onClick={() => setApproved(new Set([...approved, key]))}>Add</Button><Button size="sm" variant="quiet" aria-label="Skip"><X size={14} /></Button></>}
              {item.state === "warning" && <Button size="sm" variant="glass">Merge</Button>}
            </span>
          </div>;
        })}
      </div>
    </section>)}
  </div>;
}

const METHODS = [
  { name: "Slip-roll counter off the jab", d: "boxing" as D, status: "Testing", source: "YouTube · coach breakdown", tried: "2 sessions · landed 4 of 11 in sparring" },
  { name: "Knee-cut pass: head position first", d: "bjj" as D, status: "Testing", source: "Instagram reel", tried: "1 session · 2 of 6 in rolls" },
  { name: "Low-kick check, then counter cross", d: "kick" as D, status: "New", source: "Told AVA after class", tried: "Not tried yet" },
  { name: "Tempo squats 3-1-1", d: "strength" as D, status: "Proven", source: "Article", tried: "6 sessions · e1RM +7 kg" },
  { name: "Cadence 170+ on easy runs", d: "run" as D, status: "Proven", source: "YouTube", tried: "5 runs · same pace, HR −6" },
  { name: "Single-leg to trip from the cage", d: "mma" as D, status: "Dropped", source: "YouTube", tried: "3 sessions · didn't suit your stance" },
];

function Methods() {
  const [picked, setPicked] = useState(0);
  const m = METHODS[picked]!;
  return <div className="grid gap-5">
    <Surface tone="sunken" elevation={0} className="grid gap-3 p-4">
      <p className="text-body text-ink">Learned something new?</p>
      <div className="flex gap-2"><div className="flex-1"><TextArea rows={2} placeholder="Paste a video link, or describe the technique…" aria-label="New method" /></div>
        <div className="grid gap-2"><Button size="icon" variant="solid" aria-label="Say it"><Mic size={18} /></Button><Button size="icon" aria-label="Add"><Plus size={18} /></Button></div></div>
      <p className="text-meta text-ink-3">AVA watches or reads it, writes the key points, and suggests how to test it.</p>
    </Surface>
    <div className="flex flex-wrap gap-2"><Chip selected>All</Chip>{(Object.keys(DISC) as D[]).map((d) => <Chip key={d} leading={dot(d)}>{DISC[d].label}</Chip>)}</div>
    <div className="tr-two">
      <div className="grid gap-1">{METHODS.map((method, i) => <Row key={method.name} onClick={() => setPicked(i)} className={i === picked ? "bg-glass-strong" : ""}
        leading={dot(method.d)} title={method.name} meta={`${method.status} · ${method.tried}`}
        trailing={<Tag tone={method.status === "Proven" ? "success" : method.status === "Testing" ? "info" : method.status === "Dropped" ? "danger" : "neutral"}>{method.status}</Tag>} />)}</div>
      <Surface tone="raised" className="grid content-start gap-4 p-5">
        <p className="ds-calendar-eyebrow">{DISC[m.d].label.toUpperCase()} · {m.status.toUpperCase()}</p>
        <h3 className="text-body-lg text-ink">{m.name}</h3>
        <Row leading={<PlayCircle size={18} />} title={m.source} meta="Source · AVA's key points below" />
        <ul className="grid gap-1.5 text-body text-ink-2 list-disc pl-5"><li>Slip outside the jab, roll under the follow-up cross.</li><li>Counter with a lead hook as you come up, weight on the lead leg.</li><li>Only after they double up: it's bait for the second jab.</li></ul>
        <p className="ds-calendar-eyebrow">TEST PLAN</p>
        <p className="text-body text-ink-2">Drill 3 rounds in each boxing session for 2 weeks, then try it 5+ times in sparring. Proven if it lands in 1 of 3 attempts without you getting countered.</p>
        <p className="ds-calendar-eyebrow">SO FAR</p>
        <p className="text-body text-ink">{m.tried}</p>
        <div className="flex flex-wrap gap-2"><Button variant="solid" leading={<Plus size={16} />}>Add to Thursday's boxing</Button><Button>Mark proven</Button><Button variant="danger">Drop it</Button></div>
      </Surface>
    </div>
  </div>;
}

function Bars({ values, max }: { values: number[]; max: number }) {
  return <div className="tr-bars">{values.map((v, i) => <span key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} data-high={v > max * 0.8} />)}</div>;
}

function Progress() {
  const load = [320, 0, 450, 380, 0, 600, 240, 0, 520, 410, 300, 0, 680, 360];
  const readiness = [82, 78, 74, 70, 76, 80, 72, 66, 70, 74, 71, 68, 62, 70];
  const pts = readiness.map((v, i) => `${(i / 13) * 100},${(90 - v) * 1.4}`).join(" ");
  return <div className="grid gap-6">
    <TileGrid className="lg:grid-cols-4">
      <Tile title="25:20" meta="5 km · was 26:10" /><Tile title="118 kg" meta="Squat e1RM · +7" />
      <Tile title="18" meta="Sparring rounds · 14 days" /><Tile title="3 of 8" meta="Subs landed in rolls" />
    </TileGrid>
    <Surface tone="raised" className="grid gap-3 p-5">
      <div className="flex items-baseline justify-between"><p className="ds-calendar-eyebrow">TRAINING LOAD · LAST 14 DAYS</p><span className="text-meta text-ink-3">minutes × effort</span></div>
      <Bars values={load} max={700} />
      <p className="text-meta text-ink-2">Load is up 22% on the previous fortnight. Fine for this cycle, but Sunday stays a rest day.</p>
    </Surface>
    <Surface tone="raised" className="grid gap-3 p-5">
      <p className="ds-calendar-eyebrow">READINESS · SLEEP, SORENESS, ENERGY</p>
      <svg viewBox="0 0 100 42" preserveAspectRatio="none" style={{ width: "100%", height: 120 }} aria-label="Readiness trend">
        <polyline points={pts} fill="none" stroke="var(--ds-trace)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="text-meta text-ink-2">Trending down since Tuesday's hard rolls. I moved MMA sparring to light and added a mobility day.</p>
    </Surface>
    <section className="grid gap-3"><p className="ds-calendar-eyebrow">WHAT'S WORKING</p>
      <Receipt icon={<Sparkles size={18} />} title="Tempo squats are proven" detail="+7 kg estimated max over 6 sessions. Kept in Strength A." status="Proven" statusTone="success" proof="Methods" />
      <Receipt icon={<AlertTriangle size={18} />} title="Left shoulder sore after 2 of the last 3 BJJ sessions" detail="I'll keep pressing light on Strength B and ask after Tuesday's class." status="Watching" statusTone="warning" proof="From your check-ins" />
    </section>
  </div>;
}

function Log() {
  const [rpe, setRpe] = useState(7);
  return <div className="grid gap-5">
    <MetalObject variant="cut" eyebrow="TODAY · 18:00" value="75 min" title="Boxing: jab–cross, slip-roll counter, 6 bag rounds" detail={<span>Planned by AVA · tests one method</span>} />
    <section className="grid gap-1"><p className="ds-calendar-eyebrow">PLAN</p>
      {[["Warm-up, skipping, shadowboxing", "12 min"], ["Slip-roll counter drill (testing)", "3 × 3 min"], ["Heavy bag", "6 × 3 min"], ["Core and neck", "10 min"]].map(([t, m]) => <Row key={t} title={t} trailing={<span className="text-meta">{m}</span>} leading={dot("boxing")} />)}
    </section>
    <section className="grid gap-3"><p className="ds-calendar-eyebrow">HOW HARD WAS IT</p>
      <div className="flex flex-wrap gap-1.5">{Array.from({ length: 10 }, (_, i) => <Chip key={i} selected={rpe === i + 1} onClick={() => setRpe(i + 1)}>{i + 1}</Chip>)}</div>
      <p className="ds-calendar-eyebrow">DID THE NEW METHOD WORK</p>
      <div className="flex flex-wrap gap-2"><Chip>Yes, landed it</Chip><Chip selected>Sometimes</Chip><Chip>Not yet</Chip></div>
      <p className="ds-calendar-eyebrow">ANYTHING SORE</p>
      <div className="flex flex-wrap gap-2"><Chip>Nothing</Chip><Chip selected>Shoulder</Chip><Chip>Knee</Chip><Chip>Back</Chip><Chip>Hands</Chip></div>
      <TextArea rows={2} placeholder="Notes (optional)" aria-label="Notes" />
      <div className="flex flex-wrap items-center gap-3"><Button variant="solid" leading={<Check size={16} />}>Log session</Button><span className="text-meta text-ink-3">Or just tell AVA: “did boxing, 75 minutes, felt heavy, shoulder's a bit sore.”</span></div>
    </section>
  </div>;
}

function Training() {
  const [tab, setTab] = useState<"plan" | "methods" | "progress" | "log">("plan");
  const views: Record<typeof tab, ReactNode> = { plan: <Plan />, methods: <Methods />, progress: <Progress />, log: <Log /> };
  return <section className="ds-root ds-calendar h-full min-h-screen overflow-y-auto bg-canvas text-ink">
    <Atmosphere kind="nocturne" />
    <div className="ds-calendar-content">
      <header className="ds-calendar-header">
        <div><p className="ds-calendar-eyebrow">TRAINING · CYCLE 1–10 OCT</p><h1>Train with intent.</h1></div>
        <div className="ds-calendar-actions"><span className="ds-calendar-feedback">Planned around your calendar · updated just now</span><button className="ds-focus ds-calendar-primary"><Mic size={17} aria-hidden />Log by voice</button></div>
      </header>
      <div className="ds-calendar-panel tr-panel">
        <div className="ds-calendar-rail">
          <p className="ds-calendar-rail-label">READINESS TODAY</p>
          <div className="flex items-center gap-4"><ProgressRing value={0.7} label="Readiness" size={64} /><div className="grid"><span className="text-body-lg text-ink">70 · OK</span><span className="text-meta text-ink-3">Slept 6.5 h · shoulder sore</span></div></div>
          <p className="ds-calendar-rail-label">THIS CYCLE VS TARGET</p>
          <div className="grid gap-2.5">{BALANCE.map(([d, done, target]) => <div key={d} className="grid gap-1">
            <div className="flex items-center justify-between text-meta"><span className="flex items-center gap-2 text-ink">{dot(d)}{DISC[d].label}</span><span className="text-ink-3">{done} / {target}</span></div>
            <div className="tr-meter"><span style={{ width: `${Math.min(100, (done / target) * 100)}%`, background: DISC[d].colour }} /></div>
          </div>)}</div>
          <p className="ds-calendar-rail-note">Targets change with your goal. Right now: fight fitness, strength kept, running for base.</p>
        </div>
        <div className="ds-calendar-main">
          <div className="ds-calendar-toolbar"><h2>{{ plan: "The plan", methods: "Methods", progress: "Progress", log: "Today's session" }[tab]}</h2>
            <div className="ds-calendar-modes" role="group" aria-label="Training view">{(["plan", "methods", "progress", "log"] as const).map((v) => <button key={v} className="ds-focus" aria-pressed={tab === v} onClick={() => setTab(v)}>{{ plan: "Plan", methods: "Methods", progress: "Progress", log: "Log" }[v]}</button>)}</div></div>
          <div className="p-6">{views[tab]}</div>
        </div>
        <aside className="ds-calendar-agenda">
          <StatusIsland mode="attention" text="AVA" detail="8 sessions waiting for your OK" />
          <Receipt icon={<AlertTriangle size={18} />} title="Your calendar changed" detail="A Data Science lecture was added on Mon 5 Oct, 17:00–18:00. I moved Kickboxing to 18:30." status="Replanned" statusTone="info" action={<Button size="sm" variant="quiet">Undo</Button>} />
          <Receipt icon={<Link2 size={18} />} title="New method from a video" detail="Slip-roll counter: added to Thursday's boxing to test." status="Testing" statusTone="info" />
          <section className="grid gap-2"><p className="ds-calendar-eyebrow">CHECK IN</p>
            <p className="text-body text-ink">How are you feeling today?</p>
            <div className="flex flex-wrap gap-2"><Chip>Fresh</Chip><Chip selected>OK</Chip><Chip>Tired</Chip><Chip>Sore</Chip><Chip>Injured</Chip></div>
            <p className="text-meta text-ink-3">Your answer adjusts the next 3 days.</p>
          </section>
          <p className="text-body text-ink-2">Tomorrow's easy run can move to the evening if you'd rather sleep in. Want me to?</p>
          <div className="ds-glass mt-auto flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 shadow-e2"><span className="flex-1 text-body text-ink-3">Ask about your training…</span><Button size="icon" variant="solid" aria-label="Voice"><Mic size={18} /></Button></div>
        </aside>
      </div>
      <p className="mt-4 text-meta text-ink-3">Mockup. Lectures and your booked gym, jiu-jitsu and runs are from your real calendar; proposed sessions, methods and numbers are examples.</p>
    </div>
    <style>{`
      .tr-panel { grid-template-columns: 250px minmax(0,1fr) 340px; }
      @media (max-width: 1180px) { .tr-panel { grid-template-columns: minmax(0,1fr) 320px; } }
      @media (max-width: 860px) { .tr-panel { grid-template-columns: minmax(0,1fr); } }
      .tr-day { display:grid; grid-template-columns: 110px minmax(0,1fr); gap: 14px; padding-bottom: 14px; box-shadow: inset 0 -1px var(--ds-panel-line); }
      .tr-day-label { display:grid; align-content:start; gap:2px; padding-top: 10px; } .tr-day-label strong { font-size: 18px; font-weight: 500; } .tr-day-label span { font-size: 13px; color: var(--ds-ink-3); }
      .tr-item { display:grid; grid-template-columns: 96px minmax(0,1fr) auto; gap: 12px; align-items:center; padding: 10px 12px; border-radius: 12px; border-left: 3px solid var(--d); background: var(--ds-glass); }
      .tr-item[data-state="commitment"] { background: none; border-left-color: var(--ds-panel-line); opacity: .75; }
      .tr-item[data-state="proposed"] { background: none; box-shadow: inset 0 0 0 1px var(--ds-glass-edge); border-left-style: dashed; }
      .tr-item[data-state="warning"] { background: var(--ds-warning-soft); }
      .tr-time { font-size: 13px; color: var(--ds-ink-2); font-variant-numeric: tabular-nums; }
      .tr-meter { height: 5px; border-radius: 3px; background: var(--ds-glass); overflow: hidden; } .tr-meter span { display:block; height:100%; border-radius:3px; }
      .tr-two { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1.1fr); gap: 16px; }
      .tr-bars { display:flex; align-items:flex-end; gap:6px; height: 120px; } .tr-bars span { flex:1; border-radius: 4px 4px 0 0; background: var(--ds-trace); opacity:.55; } .tr-bars span[data-high="true"] { background: var(--ds-warning); opacity: .9; }
      @media (max-width: 860px) { .tr-day { grid-template-columns: 1fr; } .tr-item { grid-template-columns: 1fr; } .tr-two { grid-template-columns: 1fr; } }
    `}</style>
  </section>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Training /></StrictMode>);
