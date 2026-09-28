import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { ApiError } from "../api.js";
import { AttendanceEditor, EventEditor } from "./EventEditor.js";
import { fetchCalendarWorkspace, type CalendarWorkspace, type EventDefinition } from "./workspace-api.js";
import { addDays, eventsOnDay, localDate, placeDay, queryWindow, visibleDates } from "./layout.js";
import { DEFAULT_TIME_ZONE, type CalendarOccurrence } from "./api.js";

const Reminders = lazy(async () => ({ default: (await import("../schedule/ScheduleScreen.js")).ScheduleScreen }));
const ZONE = DEFAULT_TIME_ZONE;
type Mode = "month" | "week" | "day";
const dayTitle = (date: string, long = false) => new Intl.DateTimeFormat("en-IE", {
  timeZone: "UTC", weekday: long ? "long" : "short", day: "numeric", month: long ? "long" : "short",
}).format(new Date(`${date}T12:00:00Z`));
const clock = (at: number) => new Intl.DateTimeFormat("en-IE", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
function canEditSeries(event: EventDefinition): boolean {
  const today = localDate(Date.now(), event.timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: event.timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(Date.now());
  return !event.archivedAt && `${event.anchorLocalDate}T${event.startLocalTime}` > `${today}T${time}`;
}
/** Pixel height of one hour in Week and Day; the time grid is 24 of these. */
const HOUR = 80;
const HEAD = 72;
const KINDS = [["lecture", "Lecture"], ["event", "Event"], ["block", "Time block"]] as const;
const weekday = (date: string) => new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
const monthYear = (date: string) => new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
const shortDay = (date: string) => new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
const minutesBetween = (row: CalendarOccurrence) => Math.round((row.endsAt - row.startsAt) / 60_000);
function planned(rows: CalendarOccurrence[]): string {
  const total = rows.filter(row => !row.cancelled).reduce((sum, row) => sum + minutesBetween(row), 0);
  const hours = Math.floor(total / 60), minutes = total % 60;
  return total ? `${hours ? `${hours}h ` : ""}${minutes ? `${minutes}m ` : ""}planned. The rest is yours.` : "Nothing planned. The day is yours.";
}
const planLabel = { undecided: "Plan undecided", attend: "Plan to attend", skip: "Plan to study independently / skip" };
const outcomeLabel = { unknown: "Attendance not recorded", attended: "Attended", skipped: "Intentionally skipped", missed: "Missed" };

/** Server-authoritative events. This screen never turns reminders into events or infers attendance. */
export function CalendarScreen({ onOpenTalk, focusAt, focusOccurrenceKey }: {
  onOpenTalk: () => void;
  /** Open on the week of this moment, e.g. a calendar entry an idea cites. */
  focusAt?: number;
  focusOccurrenceKey?: string;
}) {
  const [date, setDate] = useState(() => localDate(focusAt ?? Date.now(), ZONE));
  // The first view scrolls to the focused entry's hour; later ones to 07:00.
  const focusHour = useRef(focusAt === undefined ? 7 : Math.max(0, Number(clock(focusAt).slice(0, 2)) - 1));
  const [mode, setMode] = useState<Mode>("week"), [reminders, setReminders] = useState(false);
  const [data, setData] = useState<CalendarWorkspace | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string | null>(focusOccurrenceKey ?? null);
  const [editor, setEditor] = useState<{ date: string; base?: EventDefinition } | null>(null);
  const [attendance, setAttendance] = useState<CalendarOccurrence | null>(null);
  const generation = useRef(0), restoreFocus = useRef<HTMLElement | null>(null);
  const loadedRange = useRef<string | null>(null);
  const timeGrid = useRef<HTMLDivElement>(null);
  const dates = useMemo(() => visibleDates(date, mode), [date, mode]);
  const range = queryWindow(dates);
  useEffect(() => {
    if (mode !== "month" && timeGrid.current) {
      timeGrid.current.scrollTop = focusHour.current * HOUR - 20;
      focusHour.current = 7;
    }
  }, [mode, range.from, range.to]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const key = `${range.from}:${range.to}`;
    setLoading(true); setError(null); setNotice("");
    if (loadedRange.current !== key) setData(null);
    try {
      const result = await fetchCalendarWorkspace(range.from, range.to, ZONE);
      if (current === generation.current) { loadedRange.current = key; setData(result); }
    } catch (failure) {
      if (current === generation.current) { setData(null); loadedRange.current = null; setError(failure instanceof ApiError ? failure.message : "The calendar could not be loaded. Please refresh."); }
    } finally { if (current === generation.current) setLoading(false); }
  }, [range.from, range.to]);
  useEffect(() => { void refresh(); return () => { ++generation.current; }; }, [refresh]);
  useEffect(() => {
    const focus = () => { if (!document.hidden && !editor && !attendance && !reminders) void refresh(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refresh, editor, attendance, reminders]);
  const rows = data?.occurrences ?? [];
  const dayRows = eventsOnDay(rows, date, ZONE);
  const chosen = dayRows.find(row => row.occurrenceKey === selected);
  const definition = chosen && data?.events.find(event => event.id === chosen.eventId);
  const open = (action: () => void) => { restoreFocus.current = document.activeElement as HTMLElement; action(); };
  const close = () => {
    setEditor(null); setAttendance(null);
    // Also revalidate after stale or uncertain writes; Cancel never replays a write.
    const target = restoreFocus.current;
    void refresh().finally(() => requestAnimationFrame(() => target?.isConnected && target.focus()));
  };
  const saved = (nextDate?: string) => {
    close(); setNotice("Saved to your calendar.");
    if (nextDate && nextDate !== date) setDate(nextDate);
  };
  const move = (direction: number) => {
    if (mode === "month") {
      const next = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + direction); setDate(next.toISOString().slice(0, 10));
    } else setDate(addDays(date, direction * (mode === "week" ? 7 : 1)));
    setSelected(null);
  };
  if (reminders) return <div className="ds-root h-full overflow-y-auto bg-canvas text-ink">
    <button className="ds-focus ds-calendar-quiet m-4" onClick={() => { setReminders(false); void refresh(); }}><ArrowLeft size={16} aria-hidden />Back to Calendar</button>
    <Suspense fallback={<p role="status" className="p-6">Loading reminders…</p>}><Reminders onOpenTalk={onOpenTalk} /></Suspense>
  </div>;
  const today = localDate(Date.now(), ZONE);
  const title = mode === "month" ? monthYear(date) : mode === "week" ? `${shortDay(dates[0]!)} — ${shortDay(dates[dates.length - 1]!)}` : dayTitle(date, true);
  const monthDays = visibleDates(date, "month");
  const pick = (day: string) => { setDate(day); setSelected(null); };
  const arrows = (day: string, attribute: string) => (event: React.KeyboardEvent) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault(); const next = addDays(day, offset); pick(next);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[${attribute}="${next}"]`)?.focus());
  };
  const shiftMonth = (direction: number) => {
    const next = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + direction); pick(next.toISOString().slice(0, 10));
  };
  return <section aria-label="Calendar" className="ds-root ds-calendar h-full overflow-y-auto bg-canvas text-ink">
    <Atmosphere kind="nocturne" />
    <div className="ds-calendar-content">
      <header className="ds-calendar-header">
        <div><p className="ds-calendar-eyebrow">CALENDAR · {ZONE.toUpperCase()}</p><h1>Make space.</h1></div>
        <div className="ds-calendar-actions">
          <span className="ds-calendar-feedback" aria-live="polite">{loading ? data ? "Refreshing your calendar…" : "Loading your calendar…" : <>{notice && `${notice} `}{data && `Updated ${clock(data.fetchedAt)} · Dublin time`}</>}</span>
          <button className="ds-focus ds-calendar-quiet" onClick={() => setReminders(true)}>Reminders</button>
          <button className="ds-focus ds-calendar-primary" onClick={() => open(() => setEditor({ date }))}><Plus size={17} aria-hidden />New event</button>
        </div>
      </header>
      {error && <div role="alert" className="flex flex-wrap items-center gap-3 py-5"><p>{error}</p><button className="ds-focus ds-calendar-quiet" onClick={() => void refresh()}>Refresh calendar</button></div>}
      <div className="ds-calendar-panel" aria-busy={loading}>
        <div className="ds-calendar-rail">
          <div className="ds-calendar-rail-head">
            <span>{monthYear(date)}</span>
            <span><button aria-label="Previous month" className="ds-focus ds-calendar-icon" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} aria-hidden /></button>
              <button aria-label="Next month" className="ds-focus ds-calendar-icon" onClick={() => shiftMonth(1)}><ChevronRight size={16} aria-hidden /></button></span>
          </div>
          <div className="ds-calendar-mini" role="group" aria-label={`Dates in ${monthYear(date)}`}>
            {["M", "T", "W", "T", "F", "S", "S"].map((letter, at) => <span key={at} aria-hidden>{letter}</span>)}
            {monthDays.map(day => <button key={day} data-mini={day} tabIndex={date === day ? 0 : -1} aria-pressed={date === day} aria-label={dayTitle(day, true)}
              data-outside={day.slice(0, 7) !== date.slice(0, 7)} data-today={day === today} data-busy={eventsOnDay(rows, day, ZONE).length > 0}
              className="ds-focus" onClick={() => pick(day)} onKeyDown={arrows(day, "data-mini")}>{Number(day.slice(-2))}</button>)}
          </div>
          <p className="ds-calendar-rail-label">KINDS</p>
          <ul className="ds-calendar-kinds">{KINDS.map(([kind, label]) => <li key={kind} data-kind={kind}>{label}</li>)}</ul>
          <p className="ds-calendar-rail-note">Plan, don’t overfill. Reminders that notify you live under Reminders.</p>
        </div>
        <div className="ds-calendar-main">
          <div className="ds-calendar-toolbar">
            <div className="flex items-center gap-1"><button aria-label={`Previous ${mode}`} className="ds-focus ds-calendar-icon" onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden /></button>
              <button aria-label={`Next ${mode}`} className="ds-focus ds-calendar-icon" onClick={() => move(1)}><ChevronRight size={18} aria-hidden /></button>
              <h2 aria-live="polite">{title}</h2>
              <button className="ds-focus ds-calendar-link" onClick={() => pick(today)}>Today</button>
            </div>
            <div className="ds-calendar-modes" role="group" aria-label="Calendar view">{(["day", "week", "month"] as const).map(value => <button key={value} aria-pressed={mode === value} className="ds-focus" onClick={() => setMode(value)}>{value[0]!.toUpperCase() + value.slice(1)}</button>)}</div>
          </div>
          {mode === "month" ? <>
            <div className="ds-calendar-weekdays" aria-hidden>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div>
            <div className="ds-calendar-month" role="group" aria-label="Choose a date">
              {dates.map(day => {
                const entries = eventsOnDay(rows, day, ZONE);
                return <button key={day} data-date={day} data-outside={day.slice(0, 7) !== date.slice(0, 7)} data-today={day === today}
                  tabIndex={date === day ? 0 : -1} aria-pressed={date === day} aria-label={`${dayTitle(day, true)}${data ? `, ${entries.length} events` : ""}`}
                  className="ds-focus ds-calendar-cell" onClick={() => pick(day)} onKeyDown={arrows(day, "data-date")}>
                  <span className="ds-calendar-date">{Number(day.slice(-2))}</span>
                  <span className="ds-calendar-cell-events" aria-hidden>{entries.slice(0, 3).map(row => <span key={row.occurrenceKey} data-kind={row.kind} data-cancelled={row.cancelled}>{clock(row.startsAt)} {row.title}</span>)}{entries.length > 3 && <span>+{entries.length - 3} more</span>}</span>
                  <span className="ds-calendar-mobile-count" aria-hidden>{entries.length ? `${entries.length} event${entries.length > 1 ? "s" : ""}` : ""}</span>
                </button>;
              })}
            </div>
          </> : <>
            <div ref={timeGrid} className="ds-calendar-time-scroll" tabIndex={0} role="region" aria-label={`${mode === "week" ? "Week" : "Day"} time grid; also listed chronologically below`}>
              <div className="ds-calendar-time-grid" style={{ gridTemplateColumns: `56px repeat(${dates.length}, minmax(${mode === "week" ? "96px" : "200px"}, 1fr))` }}>
                <div className="ds-calendar-hours" aria-hidden><span className="ds-calendar-zone" style={{ height: HEAD }}>Dublin</span>{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: HEAD + hour * HOUR }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
                {dates.map(day => <div key={day} className="ds-calendar-time-day" data-today={day === today}>
                  <button className="ds-focus ds-calendar-day-heading" style={{ height: HEAD }} aria-pressed={date === day} aria-label={dayTitle(day, true)} onClick={() => pick(day)}>
                    <span>{weekday(day)}</span><strong>{Number(day.slice(-2))}</strong>
                  </button>
                  <div className="ds-calendar-time-track" style={{ height: 24 * HOUR }}>{placeDay(rows, day, ZONE).map(({ row, start, end, column, columns }) => <button key={row.occurrenceKey} className="ds-focus ds-calendar-time-event" data-kind={row.kind} data-cancelled={row.cancelled} aria-pressed={selected === row.occurrenceKey}
                    style={{ top: `${start / 1440 * 100}%`, height: `${(end - start) / 1440 * 100}%`, left: `calc(${column / columns * 100}% + 3px)`, width: `calc(${100 / columns}% - 6px)` }}
                    onClick={() => { pick(day); setSelected(row.occurrenceKey); }} aria-label={`${row.title}, ${clock(row.startsAt)} to ${clock(row.endsAt)}${row.cancelled ? ", cancelled" : ""}`}>
                    <span>{clock(row.startsAt)} · {minutesBetween(row)}m</span><strong>{row.title}</strong>{row.location && <span>{row.location}</span>}
                  </button>)}</div>
                </div>)}
              </div>
            </div>
            <details className="ds-calendar-week-list"><summary className="ds-focus">Chronological {mode} list</summary>
              {dates.map(day => <div key={day}><h3>{dayTitle(day, true)}</h3>{eventsOnDay(rows, day, ZONE).map(row => <button className="ds-focus ds-calendar-list-event" key={row.occurrenceKey} onClick={() => { pick(day); setSelected(row.occurrenceKey); }}>{clock(row.startsAt)} · {row.title}{row.cancelled ? " · Cancelled" : ""}</button>)}</div>)}
            </details>
          </>}
        </div>
        <aside className="ds-calendar-agenda" aria-label="Selected day">
          <div className="ds-calendar-agenda-head"><p>{new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T12:00:00Z`))}</p>
            <h2>{Number(date.slice(-2))}<span>{new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", month: "short" }).format(new Date(`${date}T12:00:00Z`))}</span></h2></div>
          {data && <div className="ds-calendar-summary">{dayRows.length ? <><strong>{dayRows.length} {dayRows.length === 1 ? "commitment" : "commitments"}</strong><span>{planned(dayRows)}</span></> : <><strong>A little open space.</strong><span>No events on this day.</span></>}</div>}
          <ul className="ds-calendar-day-events">{dayRows.map(row => <li key={row.occurrenceKey}>
            <button className="ds-focus ds-calendar-agenda-event" data-kind={row.kind} aria-pressed={selected === row.occurrenceKey} onClick={() => setSelected(row.occurrenceKey)}>
              <span className="ds-calendar-agenda-time">{clock(row.startsAt)}</span>
              <span><strong>{row.title}</strong><span>{row.cancelled ? "Cancelled" : row.location || KINDS.find(([kind]) => kind === row.kind)?.[1]}</span><small>{planLabel[row.attendanceIntent]}</small></span>
            </button>
          </li>)}</ul>
          {chosen && definition && <section className="ds-calendar-detail" aria-label="Event details">
            <p className="ds-calendar-eyebrow">{chosen.kind}{chosen.moved ? " · Rescheduled occurrence" : ""}</p><h3>{chosen.title}</h3>
            <p>{dayTitle(localDate(chosen.startsAt, ZONE), true)} · {clock(chosen.startsAt)}–{clock(chosen.endsAt)}{localDate(chosen.endsAt, ZONE) !== date ? ` · ends ${dayTitle(localDate(chosen.endsAt, ZONE))}` : ""}</p>
            {chosen.timeZone !== ZONE && <p className="text-meta text-ink-2">Displayed in {ZONE}. Event zone: {chosen.timeZone}.</p>}
            {chosen.description && <p className="whitespace-pre-wrap">{chosen.description}</p>}
            <p>{outcomeLabel[chosen.attendanceOutcome]}</p>
            {chosen.cancelled && <p className="text-danger">This occurrence is cancelled.</p>}
            <div className="flex flex-wrap gap-2"><button disabled={loading} className="ds-focus ds-calendar-quiet" onClick={() => open(() => setAttendance(chosen))}>Attendance / this occurrence</button>
              {canEditSeries(definition) && <button disabled={loading} className="ds-focus ds-calendar-quiet" onClick={() => open(() => setEditor({ date, base: definition }))}>Edit event series</button>}
            </div>
            {!canEditSeries(definition) && <p className="text-meta text-ink-2">This series has started. Whole-series editing is unavailable here to preserve past history; attendance remains editable.</p>}
          </section>}
          {selected && !chosen && data && <p role="status" className="text-meta text-ink-2">Select an event from the current day to see its latest details.</p>}
          <button className="ds-focus ds-calendar-link ds-calendar-make" onClick={() => open(() => setEditor({ date }))}>Make room for something <Plus size={15} aria-hidden /></button>
        </aside>
      </div>
    </div>
    {editor && <EventEditor date={editor.date} base={editor.base} onClose={close} onSaved={saved} />}
    {attendance && <AttendanceEditor occurrence={attendance} onClose={close} onSaved={() => saved()} />}
  </section>;
}
