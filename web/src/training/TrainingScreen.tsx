import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Mic, Send, Sparkles, X } from "lucide-react";
import { ApiError } from "../api.js";
import { Button, Chip, ProgressRing, Receipt, Row, StatusIsland, Tag, TextArea, TextInput } from "../design/index.js";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { MetalObject } from "../design/metal/MetalObject.js";
import { useMedia } from "../memory/MemoryExtras.js";
import {
  approveAll, approveSession, askTraining, fetchWeek, logSession, logUnplanned, mergeEntries, planWeek, saveCheckin, skipSession,
  unscheduleSession, unskipSession, type Discipline, type Feeling, type PlanResult, type TrainingSession, type TrainingWeek, type WeekItem, type WeekWarning,
} from "./api.js";

type Tab = "plan" | "log";
const LABEL: Record<Discipline, string> = {
  mobility: "Mobility", bjj: "Jiu-jitsu", boxing: "Boxing", kickboxing: "Kickboxing", mma: "MMA", gym: "Gym", run: "Running",
};
const DISCIPLINES = Object.keys(LABEL) as Discipline[];
const FEELINGS: Array<{ id: Feeling; label: string }> = [
  { id: "fresh", label: "Fresh" }, { id: "ok", label: "OK" }, { id: "tired", label: "Tired" }, { id: "sore", label: "Sore" }, { id: "injured", label: "Injured" },
];
const AREAS = ["Shoulder", "Knee", "Back", "Hands"];

const dayOf = (date: string) => new Date(`${date}T12:00:00Z`);
const weekday = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(dayOf(date));
const dayMonth = (date: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(dayOf(date)).replace("Sept", "Sep");
const shift = (date: string, days: number) => { const d = dayOf(date); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const errorText = (error: unknown) => error instanceof ApiError ? error.message : "That didn’t work. Try again.";
const said = (text: string) => { const plain = text.replace(/^Done, and checked just now:\s*/, ""); return plain.charAt(0).toUpperCase() + plain.slice(1); };
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const minutesText = (session: TrainingSession) => [
  session.minutes ? `${session.minutes} min` : "", session.effort ? `effort ${session.effort}` : "",
  session.distanceKm ? `${session.distanceKm} km` : "", session.sore.length ? `${session.sore.join(", ")} sore` : "",
].filter(Boolean).join(" · ");

function Dot({ discipline }: { discipline: Discipline }) {
  return <span className="ds-training-dot" data-discipline={discipline} aria-hidden />;
}

/** Sir's training: a Monday-to-Sunday plan around his calendar, logging, and a daily check-in, with AVA beside it. */
export function TrainingScreen({ onVoice, onAsk }: { onVoice?: () => void; onAsk?: (text: string) => void }) {
  const narrow = useMedia("(max-width: 1180px)");
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [week, setWeek] = useState<TrainingWeek | null>(null), [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("plan"), [planning, setPlanning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastPlan, setLastPlan] = useState<PlanResult | null>(null), [reply, setReply] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    try { const next = await fetchWeek(from); if (mine === generation.current) { setWeek(next); setLoadError(null); } }
    catch (error) { if (mine === generation.current) setLoadError(errorText(error)); }
  }, [from]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const focus = () => { if (!document.hidden) void load(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [load]);

  const act: Act = async (work, undo) => {
    try { const text = await work(); if (text) setNotice({ text, undo }); }
    catch (error) { setNotice({ text: errorText(error), error: true }); }
    await load();
  };
  const plan = () => {
    if (!week) return;
    setPlanning(true); setNotice(null);
    void (async () => {
      try {
        const body = await planWeek(planTarget(week));
        generation.current += 1;
        setWeek(body.week); setLastPlan(body.result); setTab("plan"); setFrom(body.result.from);
      } catch (error) { setNotice({ text: errorText(error), error: true }); }
      finally { setPlanning(false); }
    })();
  };
  const ask = async (text: string) => {
    try {
      const answer = await askTraining(text);
      if (answer.handled && answer.text) { setReply(said(answer.text)); await load(); return; }
      if (onAsk) onAsk(text); else setNotice({ text: "AVA couldn’t do that here. Try Talk.", error: true });
    } catch (error) { setNotice({ text: errorText(error), error: true }); }
  };

  const range = week ? `${dayMonth(week.from)} – ${dayMonth(week.to)}`.toUpperCase() : "";
  return <section aria-label="Training" className="ds-root ds-calendar ds-training h-full overflow-y-auto bg-canvas text-ink">
    <Atmosphere kind="nocturne" />
    <div className="ds-calendar-content">
      <header className="ds-calendar-header">
        <div><p className="ds-calendar-eyebrow">TRAINING{range ? ` · WEEK ${range}` : ""}</p><h1>Train with intent.</h1></div>
        <div className="ds-calendar-actions">
          <span className="ds-calendar-feedback">Planned around your calendar{planning ? " · planning now…" : ""}</span>
          {onVoice && <button className="ds-focus ds-calendar-primary" onClick={onVoice}><Mic size={17} aria-hidden />Log by voice</button>}
        </div>
      </header>
      <p role={notice?.error ? "alert" : "status"} className="ds-training-notice" data-error={notice?.error ?? false}>
        {notice?.text}{notice?.undo && <Button size="sm" variant="quiet" onClick={() => { const undo = notice.undo!; setNotice(null); void act(async () => { await undo(); }); }}>Undo</Button>}
      </p>
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-3 py-3"><span>{loadError}</span><Button size="sm" onClick={() => void load()}>Try again</Button></div>}
      {week && <div className="ds-calendar-panel ds-training-panel">
        {!narrow && <div className="ds-calendar-rail"><Rail week={week} /></div>}
        <div className="ds-calendar-main">
          <div className="ds-calendar-toolbar">
            <h2>{tab === "plan" ? "The plan" : "Today’s session"}</h2>
            <div className="ds-calendar-modes" role="group" aria-label="Training view">
              {(["plan", "log"] as const).map((value) => <button key={value} className="ds-focus" aria-pressed={tab === value} onClick={() => setTab(value)}>{value === "plan" ? "Plan" : "Log"}</button>)}
            </div>
          </div>
          <div className="ds-training-body">
            {narrow && <div className="ds-training-rail-inline"><Rail week={week} /></div>}
            {tab === "plan"
              ? <Plan week={week} planning={planning} onPlan={plan} act={act} onWeek={(date) => { setFrom(date); setLastPlan(null); }} />
              : <Log key={`${week.today}:${todaySession(week)?.id ?? ""}`} week={week} act={act} />}
          </div>
        </div>
        <aside className="ds-calendar-agenda ds-training-ava" aria-label="AVA">
          <Ava week={week} lastPlan={lastPlan} reply={reply} planning={planning} onPlan={plan} onLog={() => setTab("log")} onAsk={ask} onVoice={onVoice} act={act} />
        </aside>
      </div>}
    </div>
  </section>;
}

function Rail({ week }: { week: TrainingWeek }) {
  const ready = week.readiness;
  return <>
    <p className="ds-calendar-rail-label">READINESS TODAY</p>
    <div className="flex items-center gap-4">
      <ProgressRing value={ready ? ready.score / 100 : 0} label="Readiness" size={64} />
      <div className="grid min-w-0">
        <span className="text-body-lg text-ink">{ready ? `${ready.score} · ${ready.word}` : "No check-in yet"}</span>
        <span className="text-meta text-ink-3">{ready ? ready.detail || "From today’s check-in" : "Tell AVA how you feel"}</span>
      </div>
    </div>
    <p className="ds-calendar-rail-label">THIS WEEK</p>
    {week.cycle.length ? <div className="grid gap-2.5">{week.cycle.map((entry) => <div key={entry.discipline} className="grid gap-1" data-discipline={entry.discipline}>
      <div className="flex items-center justify-between text-meta">
        <span className="flex items-center gap-2 text-ink"><Dot discipline={entry.discipline} />{LABEL[entry.discipline]}</span>
        <span className="text-ink-3" aria-label={`${entry.done} done of ${entry.planned} planned`}>{entry.done} / {entry.planned}</span>
      </div>
      <div className="ds-training-meter"><span style={{ width: `${Math.round((entry.done / entry.planned) * 100)}%` } as CSSProperties} /></div>
    </div>)}</div> : <p className="text-meta text-ink-3">Nothing planned yet this week.</p>}
    <p className="ds-calendar-rail-note">{week.note}</p>
  </>;
}

type Act = (work: () => Promise<string | void>, undo?: () => Promise<unknown>) => Promise<void>;
type Notice = { text: string; error?: boolean; undo?: () => Promise<unknown> };

const isSunday = (date: string) => dayOf(date).getUTCDay() === 0;
const isCurrent = (week: TrainingWeek) => week.from <= week.today && week.today <= week.to;
/** On a Sunday, planning the current week means the week ahead. */
const planTarget = (week: TrainingWeek) => isCurrent(week) && isSunday(week.today) ? shift(week.from, 7) : week.from;

function Plan({ week, planning, onPlan, act, onWeek }: { week: TrainingWeek; planning: boolean; onPlan: () => void; act: Act; onWeek: (date: string) => void }) {
  const waiting = week.days.flatMap((day) => day.items.flatMap((item) => item.kind === "session" && item.session.status === "proposed" ? [item.session] : []));
  const open = week.to >= week.today;
  const current = week.from <= week.today && week.today <= week.to;
  return <div className="grid gap-5">
    <div className="ds-training-intro">
      <p className="text-body text-ink-2">Monday to Sunday, planned around your lectures and what’s already booked. Nothing is added to your calendar until you approve it.</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1">
          <button aria-label="Previous week" className="ds-focus ds-calendar-icon" onClick={() => onWeek(shift(week.from, -7))}><ChevronLeft size={18} aria-hidden /></button>
          <button aria-label="Next week" className="ds-focus ds-calendar-icon" onClick={() => onWeek(shift(week.from, 7))}><ChevronRight size={18} aria-hidden /></button>
          {!current && <button className="ds-focus ds-calendar-link" onClick={() => onWeek(week.today)}>This week</button>}
        </span>
        {waiting.length > 0 && <Button variant="solid" leading={<Check size={16} />} onClick={() => void act(async () => {
          const body = await approveAll(waiting);
          const added = `Added ${body.approved.length} to your calendar.`;
          if (body.failed.length) throw new ApiError(409, `${added} Not added: ${body.failed.map((entry) => entry.message).join(" ")}`);
          return added;
        })}>Approve all {waiting.length}</Button>}
        {open && <Button variant={waiting.length ? "quiet" : "solid"} leading={<Sparkles size={16} />} disabled={planning} onClick={onPlan}>
          {planning ? "Planning…" : planTarget(week) !== week.from ? "Plan next week" : waiting.length ? "Plan again" : "Plan my week"}
        </Button>}
      </div>
    </div>
    {week.days.map((day) => {
      const warnings = week.warnings.filter((warning) => warning.date === day.date);
      // A warning stands in for the two entries it is about, as one row with its fix.
      const covered = new Set(warnings.flatMap((warning) => warning.key.split("|")));
      const rows: Array<{ start: string; node: ReactNode }> = [
        ...day.items.filter((item) => !covered.has(item.key)).map((item) => ({ start: item.start ?? "99", node: <Item key={item.key} item={item} act={act}
          ahead={!day.past && (!day.today || (item.start !== null && toMinutes(item.start) > week.nowMinutes))} /> })),
        ...warnings.map((warning) => ({ start: warning.start, node: <Warning key={warning.key} warning={warning} act={act} /> })),
      ].sort((a, b) => a.start.localeCompare(b.start));
      return <section key={day.date} className="ds-training-day" data-past={day.past} aria-label={`${weekday(day.date)} ${dayMonth(day.date)}`}>
        <div className="ds-training-day-label">
          <strong>{weekday(day.date)}</strong><span>{dayMonth(day.date)}</span>
          {day.today && <Tag tone="info">Today</Tag>}
          {day.rest && !day.past && <Tag>Rest</Tag>}
        </div>
        <div className="grid gap-2">
          {rows.length ? rows.map((row) => row.node) : <p className="ds-training-empty">Nothing on.</p>}
        </div>
      </section>;
    })}
  </div>;
}

function Item({ item, act, ahead }: { item: WeekItem; act: Act; ahead: boolean }) {
  if (item.kind === "calendar") return <div className="ds-training-item" data-state="commitment">
    <span className="ds-training-time">{item.start}–{item.end}</span>
    <span className="ds-training-title text-body text-ink">{item.title}</span>
    <span><Tag>{item.label}</Tag></span>
  </div>;
  if (item.kind === "booked") return <div className="ds-training-item" data-state="booked" data-discipline={item.discipline}>
    <span className="ds-training-time">{item.start}–{item.end}</span>
    <span className="grid min-w-0 gap-0.5"><span className="ds-training-title text-body text-ink">{item.title}</span><span className="text-meta text-ink-3">Already in your calendar. Planned around it.</span></span>
    <span><Tag tone="success">In calendar</Tag></span>
  </div>;
  const { session } = item;
  const time = item.start ? `${item.start}–${item.end}` : session.status === "done" ? "Logged" : "Any time";
  const state = session.status === "approved" ? "booked" : session.status;
  const note = item.conflict ?? (session.status === "done" ? minutesText(session) || "Logged" : session.reason);
  return <div className="ds-training-item" data-state={state} data-discipline={session.discipline}>
    <span className="ds-training-time">{time}</span>
    <span className="grid min-w-0 gap-0.5">
      <span className="ds-training-title text-body text-ink">{session.title}</span>
      {note && <span className={item.conflict ? "text-meta text-danger" : "text-meta text-ink-3"}>{note}</span>}
    </span>
    <span className="flex items-center gap-1.5">
      {session.status === "proposed" && <>
        <Button size="sm" variant="solid" onClick={() => void act(async () => { await approveSession(session); return `Added ${session.title} to your calendar.`; })}>Add</Button>
        <Button size="sm" variant="quiet" aria-label={`Skip ${session.title}`} onClick={() => void act(async () => {
          await skipSession(session);
          return `Skipped ${session.title}.`;
        }, () => unskipSession(session))}><X size={14} /></Button>
      </>}
      {session.status === "approved" && <>
        <Tag tone="success">In calendar</Tag>
        {item.start && <Button size="sm" variant="quiet" aria-label={`Remove ${session.title} from your calendar`}
          onClick={() => void act(async () => { await unscheduleSession(session); return `Took ${session.title} out of your calendar. It’s a proposal again.`; })}><X size={14} /></Button>}
      </>}
      {session.status === "done" && <Tag tone="success">Done</Tag>}
      {session.status === "skipped" && <>
        <Tag>Skipped</Tag>
        {ahead && item.start && <Button size="sm" variant="quiet" onClick={() => void act(async () => { await unskipSession(session); return `${session.title} is back as a proposal.`; })}>Bring back</Button>}
      </>}
    </span>
  </div>;
}

function Warning({ warning, act }: { warning: WeekWarning; act: Act }) {
  return <div className="ds-training-item" data-state="warning" data-discipline={warning.discipline}>
    <span className="ds-training-time">{warning.start}–{warning.end}</span>
    <span className="grid min-w-0 gap-0.5"><span className="ds-training-title text-body text-ink">{warning.title}</span><span className="text-meta text-ink-2">{warning.text}</span></span>
    <span>{warning.fix && <Button size="sm" variant="glass" onClick={() => void act(async () => { await mergeEntries(warning.fix!); return "Merged them into one entry for this week."; })}>Merge</Button>}</span>
  </div>;
}

/** Today's session to log: the next one planned for today, else a session he did anyway. */
function todaySession(week: TrainingWeek): TrainingSession | null {
  const today = week.days.find((day) => day.today);
  const sessions = today?.items.flatMap((item) => item.kind === "session" ? [item.session] : []) ?? [];
  return sessions.find((session) => session.status === "approved") ?? sessions.find((session) => session.status === "proposed") ?? null;
}

function Log({ week, act }: { week: TrainingWeek; act: Act }) {
  const [other, setOther] = useState(false);
  const planned = todaySession(week);
  const session = other ? null : planned;
  const today = week.days.find((day) => day.today)?.items ?? [];
  const doneToday = today.flatMap((item) => item.kind === "session" && item.session.status === "done" ? [item.session] : []);
  const booked = today.find((item): item is Extract<WeekItem, { kind: "booked" }> => item.kind === "booked");
  const [discipline, setDiscipline] = useState<Discipline>(planned?.discipline ?? booked?.discipline ?? "gym");
  const [minutes, setMinutes] = useState(String(session?.durationMin ?? ""));
  const [effort, setEffort] = useState<number | null>(null), [sore, setSore] = useState<string[]>([]), [notes, setNotes] = useState("");
  const [distance, setDistance] = useState(""), [time, setTime] = useState("");
  const kind = session?.discipline ?? discipline;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const [mm, ss] = time.split(":").map(Number);
    const log = {
      minutes: Number(minutes) > 0 ? Math.round(Number(minutes)) : null, effort, sore, notes,
      ...(kind === "run" ? { distanceKm: Number(distance) > 0 ? Number(distance) : null, durationS: Number.isFinite(mm) && time ? (mm ?? 0) * 60 + (ss || 0) : null } : {}),
    };
    void act(async () => {
      const done = session ? await logSession(session, log) : (await logUnplanned(discipline, log)).session;
      return `Logged ${done.title}${minutesText(done) ? `: ${minutesText(done)}` : ""}.`;
    });
  };
  return <form className="grid gap-5" onSubmit={submit}>
    {session ? <MetalObject variant="cut" eyebrow={`TODAY${session.startLocalTime ? ` · ${session.startLocalTime.slice(0, 5)}` : ""}`}
      value={session.durationMin ? `${session.durationMin} min` : undefined} title={session.title}
      detail={<span>{session.status === "approved" ? "In your calendar · planned with AVA" : "Proposed by AVA · not in your calendar yet"}</span>} />
      : <section className="grid gap-3">
        <p className="text-body text-ink-2">{doneToday.length ? `Logged today: ${doneToday.map((entry) => entry.title).join(", ")}. Did something else?`
          : booked ? `${booked.title} at ${booked.start} is in your calendar. Log it here when you’re done.` : "Nothing planned today. Did you train anyway?"}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Discipline">
          {DISCIPLINES.map((entry) => <Chip key={entry} selected={discipline === entry} leading={<Dot discipline={entry} />} onClick={() => setDiscipline(entry)}>{LABEL[entry]}</Chip>)}
        </div>
      </section>}
    {session && <div><Button size="sm" variant="quiet" onClick={() => setOther(true)}>Log a different session</Button></div>}
    {session && session.plan.length > 0 && <section className="grid gap-1"><p className="ds-calendar-eyebrow">PLAN</p>
      {session.plan.map((block, index) => <Row key={index} title={block.text} leading={<Dot discipline={session.discipline} />}
        trailing={block.minutes ? <span className="text-meta">{block.minutes} min</span> : undefined} />)}
    </section>}
    <section className="grid gap-3">
      <p className="ds-calendar-eyebrow">MINUTES</p>
      <div className="ds-training-short"><TextInput inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/[^\d]/g, ""))} aria-label="Minutes" placeholder="Minutes" /></div>
      {kind === "run" && <div className="flex flex-wrap gap-2">
        <div className="ds-training-short"><TextInput inputMode="decimal" value={distance} onChange={(event) => setDistance(event.target.value.replace(/[^\d.]/g, ""))} aria-label="Distance in km" placeholder="Distance (km)" /></div>
        <div className="ds-training-short"><TextInput value={time} onChange={(event) => setTime(event.target.value.replace(/[^\d:]/g, ""))} aria-label="Time (mm:ss)" placeholder="Time (mm:ss)" /></div>
      </div>}
      <p className="ds-calendar-eyebrow">HOW HARD WAS IT</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Effort">{Array.from({ length: 10 }, (_, i) => <Chip key={i} selected={effort === i + 1} onClick={() => setEffort(effort === i + 1 ? null : i + 1)}>{i + 1}</Chip>)}</div>
      <p className="ds-calendar-eyebrow">ANYTHING SORE</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Anything sore">
        <Chip selected={!sore.length} onClick={() => setSore([])}>Nothing</Chip>
        {AREAS.map((area) => <Chip key={area} selected={sore.includes(area.toLowerCase())}
          onClick={() => setSore((list) => list.includes(area.toLowerCase()) ? list.filter((entry) => entry !== area.toLowerCase()) : [...list, area.toLowerCase()])}>{area}</Chip>)}
      </div>
      <TextArea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" aria-label="Notes" maxLength={1_000} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="solid" leading={<Check size={16} />}>Log session</Button>
        <span className="text-meta text-ink-3">Or just tell AVA: “did boxing, 75 minutes, felt heavy.”</span>
      </div>
    </section>
  </form>;
}

function Ava({ week, lastPlan, reply, planning, onPlan, onLog, onAsk, onVoice, act }: {
  week: TrainingWeek; lastPlan: PlanResult | null; reply: string | null; planning: boolean;
  onPlan: () => void; onLog: () => void; onAsk: (text: string) => Promise<void>; onVoice?: () => void; act: Act;
}) {
  const [text, setText] = useState(""), [sending, setSending] = useState(false);
  const checkin = week.checkin;
  const feeling = checkin?.feeling ?? null;
  const today = week.days.find((day) => day.today);
  const missed = today?.items.find((item) => item.kind === "session" && item.session.status === "approved" && item.end !== null
    && Number(item.end.slice(0, 2)) * 60 + Number(item.end.slice(3, 5)) <= week.nowMinutes);
  const planned = week.days.some((day) => !day.past && day.items.some((item) => item.kind === "session" && item.session.status !== "skipped"));
  const current = week.from <= week.today && week.today <= week.to;
  const suggestion: { text: string; action?: ReactNode } = missed && missed.kind === "session"
    ? { text: `Did you do ${missed.session.title}? Log it, or just tell me how it went.`, action: <Button size="sm" onClick={onLog}>Log it</Button> }
    : current && !planned ? isSunday(week.today)
      ? { text: "Want me to plan next week around your calendar?", action: <Button size="sm" disabled={planning} onClick={onPlan}>Plan next week</Button> }
      : { text: "Want me to plan the rest of your week around your calendar?", action: <Button size="sm" disabled={planning} onClick={onPlan}>Plan my week</Button> }
      : week.readiness && week.readiness.score <= 50 ? { text: `You’re ${week.readiness.word.toLowerCase()} today, so I’d keep today light. Tell me if you want a session moved.` }
        : week.waiting ? { text: `Say “yes, add them” and all ${week.waiting} go in your calendar.` }
          : { text: "After each session, tell me how it went. That’s all I need." };
  const check = (change: { feeling?: Feeling; sore?: string[] }) => void act(async () => { await saveCheckin(week.today, change); });
  const send = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true); setText("");
    void onAsk(message).finally(() => setSending(false));
  };
  return <>
    <StatusIsland mode={week.waiting ? "attention" : "idle"} text="AVA" detail={week.waiting ? `${week.waiting} ${week.waiting === 1 ? "session" : "sessions"} waiting for your OK` : "Nothing waiting"} />
    {reply && <Receipt icon={<Check size={18} />} title="Done" detail={reply} status="Checked" statusTone="success" />}
    {lastPlan && <Receipt icon={<Sparkles size={18} />} title={lastPlan.proposed.length ? `Planned ${lastPlan.proposed.length} ${lastPlan.proposed.length === 1 ? "session" : "sessions"}` : "Nothing new fits this week"}
      detail={<span>Around your lectures and what’s booked.{lastPlan.replaced ? ` Replaced ${lastPlan.replaced} earlier ${lastPlan.replaced === 1 ? "proposal" : "proposals"}.` : ""}{lastPlan.dropped.length ? ` ${lastPlan.dropped.length} ${lastPlan.dropped.length === 1 ? "idea broke" : "ideas broke"} a rule and ${lastPlan.dropped.length === 1 ? "was" : "were"} dropped: ${lastPlan.dropped.map((entry) => `${entry.title} (${entry.why})`).join("; ")}.` : ""}</span>}
      status={lastPlan.proposed.length ? "Waiting" : "Checked"} statusTone="info" />}
    {week.warnings.length > 0 && <Receipt icon={<AlertTriangle size={18} />} title="Something looks off in your calendar" detail={week.warnings[0]!.text} status="Check" statusTone="warning" />}
    {current && <section className="grid gap-2" aria-label="Check in">
      <p className="ds-calendar-eyebrow">CHECK IN</p>
      <p className="text-body text-ink">How are you feeling today?</p>
      <div className="flex flex-wrap gap-2">{FEELINGS.map((entry) => <Chip key={entry.id} selected={feeling === entry.id} onClick={() => check({ feeling: entry.id })}>{entry.label}</Chip>)}</div>
      {(feeling === "sore" || feeling === "injured") && <>
        <p className="text-meta text-ink-2">Where?</p>
        <div className="flex flex-wrap gap-2">{AREAS.map((area) => {
          const on = checkin!.sore.includes(area.toLowerCase());
          return <Chip key={area} selected={on} onClick={() => check({ sore: on ? checkin!.sore.filter((entry) => entry !== area.toLowerCase()) : [...checkin!.sore, area.toLowerCase()] })}>{area}</Chip>;
        })}</div>
      </>}
      <p className="text-meta text-ink-3">Your answer shapes the next 3 days.</p>
    </section>}
    <div className="grid gap-2"><p className="text-body text-ink-2">{suggestion.text}</p>{suggestion.action && <div>{suggestion.action}</div>}</div>
    <form className="ds-glass mt-auto flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5 shadow-e2" onSubmit={send}>
      <input className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3" value={text} onChange={(event) => setText(event.target.value)}
        placeholder="Ask about your training…" aria-label="Ask about your training" maxLength={600} />
      {text.trim() || !onVoice
        ? <Button type="submit" size="icon" variant="solid" aria-label="Send" disabled={!text.trim() || sending}><Send size={18} /></Button>
        : <Button size="icon" variant="solid" aria-label="Talk to AVA" onClick={onVoice}><Mic size={18} /></Button>}
    </form>
  </>;
}
