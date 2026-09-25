import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, BellRing, NotebookPen, RotateCw } from "lucide-react";
import { fetchWatches } from "../api.js";
import { DEFAULT_TIME_ZONE, fetchCalendarRange } from "../calendar/api.js";
import { fetchNotes } from "../notes/api.js";
import { orderReminders } from "../reminders/presenter.js";
import { Skeleton, StatusIsland, SuggestionChips } from "../design/index.js";
import { FaceStill } from "../design/face/FaceStill.js";
import { pickOneThing, suggestionsFor, type NoteInput, type OneThing, type ReminderInput, type Source } from "./oneThing.js";

// The animated face is its own lazy chunk (contract ui-remodel v2 §1); the still face shows meanwhile.
const FaceStage = lazy(async () => ({ default: (await import("../design/face/FaceStage.js")).FaceStage }));

type Load = { status: "loading" } | { status: "ready"; thing: OneThing } | { status: "error"; missing: Source[] };

function greeting(now: Date, timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, Niko.`;
}

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(at);
}

/**
 * Loads the three sources independently. A source that fails, or a calendar range
 * the server marks incomplete, is unknown; the ranking then refuses to show
 * anything that an unknown higher-priority source could outrank.
 */
async function loadOneThing(now: number, timeZone: string): Promise<OneThing> {
  const [calendar, watches, notes] = await Promise.allSettled([
    fetchCalendarRange(now - 60_000, now + 86_400_000, timeZone),
    fetchWatches(),
    fetchNotes(),
  ]);
  const reminders: ReminderInput[] | null = watches.status === "fulfilled"
    ? orderReminders(watches.value, now).upcoming.map((w) => ({ id: w.id, title: w.prompt, dueAt: Number(w.run_at) }))
    : null;
  const noteRows: NoteInput[] | null = notes.status === "fulfilled"
    ? notes.value.notes.map((n) => ({ id: n.id, title: n.title, pinned: n.pinned, archived: n.status === "archived", updatedAt: n.updatedAt }))
    : null;
  const thing = pickOneThing({
    now,
    timeZone,
    occurrences: calendar.status === "fulfilled" && calendar.value.complete ? calendar.value.occurrences : null,
    reminders,
    notes: noteRows,
  });
  if (thing.kind === "unknown") throw new UnknownDay(thing.missing);
  return thing;
}

const SOURCE_NAMES: Record<Source, string> = { calendar: "your calendar", reminders: "your reminders", notes: "your notes" };

class UnknownDay extends Error {
  constructor(readonly missing: Source[]) { super("A higher-priority source did not answer."); }
}

/** "your calendar", "your calendar and notes", "your calendar, reminders and notes". */
function listSources(missing: Source[]): string {
  const names = missing.map((source, at) => (at === 0 ? SOURCE_NAMES[source] : SOURCE_NAMES[source].replace("your ", "")));
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Home (contract ui-remodel v2 §6): nearly empty on purpose. AVA's face, a
 * greeting, the one thing for today, three next steps, and the bottom bar.
 */
export function HomeScreen({ onStartChat, onOpenNote, onOpenCalendar, onOpenReminders, timeZone = DEFAULT_TIME_ZONE }: {
  onStartChat: (text: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenCalendar: () => void;
  onOpenReminders: () => void;
  timeZone?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // Interval, focus and Try again can overlap; only the newest request may answer.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const at = Date.now();
    const request = ++latest.current;
    setNow(at);
    loadOneThing(at, timeZone).then(
      (thing) => { if (request === latest.current) setLoad({ status: "ready", thing }); },
      (error: unknown) => {
        if (request === latest.current) setLoad({ status: "error", missing: error instanceof UnknownDay ? error.missing : ["calendar", "reminders", "notes"] });
      },
    );
  }, [timeZone]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      latest.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const thing = load.status === "ready" ? load.thing : { kind: "none" as const };

  return (
    <div className="ds-root absolute inset-0 overflow-y-auto bg-canvas font-ui text-ink">
      <main
        className="mx-auto grid w-full max-w-xl grid-cols-[minmax(0,1fr)] justify-items-center gap-5 px-4 pt-4 text-center"
        style={{ paddingBottom: "calc(120px + env(safe-area-inset-bottom, 0px))", paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))" }}
      >
        <StatusIsland mode="idle" time={clock(now, timeZone)} />

        <div className="ds-backlight relative h-[min(46dvh,440px)] w-full">
          <Suspense fallback={<div className="grid h-full place-items-center"><FaceStill size={220} /></div>}>
            <FaceStage label="AVA" className="relative" />
          </Suspense>
        </div>

        <div className="grid gap-2">
          <h1 className="text-title md:text-display">{greeting(new Date(now), timeZone)}</h1>
          <p className="text-body text-ink-2">
            {load.status === "error" ? `I couldn't check ${listSources(load.missing)} just now, so I can't say what's next.` : "Here's the one thing for today."}
          </p>
        </div>

        {load.status === "loading" && <Skeleton className="h-12 w-72 rounded-full" />}
        {load.status === "error" && (
          <button type="button" onClick={refresh} className="ds-focus ds-glass inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-body shadow-e1">
            <RotateCw size={15} aria-hidden="true" /> Try again
          </button>
        )}
        {load.status === "ready" && <OneThingCard thing={thing} timeZone={timeZone} onOpenNote={onOpenNote} onOpenCalendar={onOpenCalendar} onOpenReminders={onOpenReminders} />}

        <SuggestionChips suggestions={suggestionsFor(thing)} onPick={onStartChat} label="Suggestions" className="w-full" />
      </main>
    </div>
  );
}

function OneThingCard({ thing, timeZone, onOpenNote, onOpenCalendar, onOpenReminders }: {
  thing: OneThing;
  timeZone: string;
  onOpenNote: (noteId: string) => void;
  onOpenCalendar: () => void;
  onOpenReminders: () => void;
}) {
  if (thing.kind === "unknown") return null;
  if (thing.kind === "none") {
    return <p className="rounded-full bg-surface px-5 py-3 text-body text-ink-2 shadow-e1">Nothing planned for today.</p>;
  }
  const time = thing.kind === "event" ? clock(thing.startsAt, timeZone) : thing.kind === "reminder" ? clock(thing.dueAt, timeZone) : null;
  const Icon = thing.kind === "event" ? CalendarDays : thing.kind === "reminder" ? BellRing : NotebookPen;
  const detail = thing.kind === "event"
    ? thing.attendanceIntent === "attend" ? " You planned to attend." : thing.attendanceIntent === "skip" ? " You planned to skip it." : ""
    : "";
  const open = thing.kind === "event" ? onOpenCalendar : thing.kind === "reminder" ? onOpenReminders : () => onOpenNote(thing.id);
  const action = thing.kind === "event" ? "Open calendar" : thing.kind === "reminder" ? "Open reminders" : "Open note";
  return (
    <button
      type="button"
      onClick={open}
      aria-label={`${thing.title}.${detail} ${action}.`}
      className="ds-focus flex max-w-full items-center gap-3 rounded-full bg-surface py-2 pl-2 pr-5 text-left shadow-e2 transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
    >
      <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-solid px-3 font-ui-mono text-meta text-on-solid tabular-nums">
        <Icon size={14} aria-hidden="true" />{time ?? "Pinned"}
      </span>
      <span className="min-w-0 truncate text-body text-ink">{thing.title}.<span className="text-ink-2">{detail}</span></span>
    </button>
  );
}
