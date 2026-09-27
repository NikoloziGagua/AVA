import { useEffect, useState } from "react";
import { CalendarClock, ChevronRight, FileText, Lightbulb, MessageSquareText, Mic } from "lucide-react";
import { FaceStill } from "../design/face/FaceStill.js";
import { Atmosphere } from "../design/metal/Atmosphere.js";
import { MetalObject } from "../design/metal/MetalObject.js";
import { fetchSessionPage, lastHumanActivity, type SessionRow, type WatchRow } from "../api.js";
import { fetchNotes, type Note } from "../notes/api.js";
import { isDirectReminder, orderReminders, presentReminder } from "../reminders/presenter.js";
import { ReminderStatusChip } from "../reminders/ReminderStatusChip.js";
import { fetchedAtLabel, useReminderFeed } from "../reminders/useReminderFeed.js";

export interface TodayScreenProps {
  /** Open one of Nika's conversations exactly. */
  onOpenChat: (sessionId: string) => void;
  /** Start a new conversation that sends this text. */
  onStartChat: (text: string) => void;
  /** Talk to AVA by voice (I1 rules: resume the remembered chat, else continue). */
  onEnterVoice: () => void;
  onOpenTalk: () => void;
  /** Open exactly this note in Notes. */
  onOpenNote: (noteId: string) => void;
  onOpenIdeas: () => void;
  onOpenNotes: () => void;
}

type Section<T> = { status: "loading" } | { status: "error" } | { status: "ok"; value: T };

const LIST_SIZE = 3;

/**
 * First-run starters. Each is a complete request AVA can answer by asking
 * back, so nothing half-typed is ever sent on Nika's behalf.
 */
export const STARTERS = [
  {
    title: "My courses and timetable",
    detail: "Tell AVA what you study and when.",
    prompt: "Help me set up my courses and timetable. Ask me what you need to know.",
  },
  {
    title: "Deadlines and exams",
    detail: "Get your due dates out of your head.",
    prompt: "I want to keep track of my deadlines and exams. Ask me for them one by one.",
  },
  {
    title: "Ideas and thoughts",
    detail: "Keep what's on your mind as notes.",
    prompt: "I have some ideas I want to keep. Help me capture them as notes.",
  },
] as const;

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatWhen(value: number): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Ideas and other notes Nika can open, newest first. Archived notes are never shown. */
export function splitNotes(notes: Note[]): { ideas: Note[]; notes: Note[] } {
  const live = notes
    .filter((note) => note.status !== "archived")
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return {
    ideas: live.filter((note) => note.kind === "idea"),
    notes: live.filter((note) => note.kind !== "idea"),
  };
}

/**
 * Today (contract i3a-navigation): a derived view over existing data. Each
 * section loads on its own and fails on its own; the first-run welcome appears
 * only when every load SUCCEEDED and came back empty.
 */
export function TodayScreen(props: TodayScreenProps) {
  const [talks, setTalks] = useState<Section<SessionRow[]>>({ status: "loading" });
  const [notes, setNotes] = useState<Section<Note[]>>({ status: "loading" });
  const [ideas, setIdeas] = useState<Section<Note[]>>({ status: "loading" });
  // Reminder statuses change while Today is open, so this card keeps refreshing.
  const { feed } = useReminderFeed();
  const reminders: Section<{ upcoming: WatchRow[]; total: number }> = feed.status === "ok"
    ? { status: "ok", value: { upcoming: orderReminders(feed.watches, feed.fetchedAt).upcoming, total: feed.watches.filter(isDirectReminder).length } }
    : feed.status === "error" ? { status: "error" } : { status: "loading" };
  const [now] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;
    fetchSessionPage({ scope: "human", limit: LIST_SIZE })
      .then((page) => { if (!cancelled) setTalks({ status: "ok", value: page.sessions }); })
      .catch(() => { if (!cancelled) setTalks({ status: "error" }); });
    fetchNotes()
      .then((snapshot) => { if (!cancelled) setNotes({ status: "ok", value: splitNotes(snapshot.notes).notes }); })
      .catch(() => { if (!cancelled) setNotes({ status: "error" }); });
    fetchNotes({ kind: "idea" })
      .then((snapshot) => { if (!cancelled) setIdeas({ status: "ok", value: splitNotes(snapshot.notes).ideas }); })
      .catch(() => { if (!cancelled) setIdeas({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);

  const firstRun = talks.status === "ok" && notes.status === "ok" && ideas.status === "ok" && reminders.status === "ok"
    && talks.value.length === 0 && ideas.value.length === 0 && notes.value.length === 0
    && reminders.value.total === 0;

  const dateLine = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  if (firstRun) return <FirstRun {...props} dateLine={dateLine} />;

  return (
    <div className="ava-today ds-root ds-today-workspace h-full w-full overflow-y-auto bg-canvas font-ui text-ink">
      <Atmosphere kind="silk" />
      <div className="ds-today-content mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-4 pt-8 sm:px-8 lg:px-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-meta text-ink-2">{dateLine}</p>
            <h1 className="text-display tracking-tight text-ink">{greeting(now)}</h1>
          </div>
          <button
            type="button"
            onClick={props.onEnterVoice}
            className="ds-focus ds-metal-bar flex h-12 items-center gap-3 rounded-full pl-1.5 pr-4 text-body text-ink"
          >
            <FaceStill size={36} />
            <span>Talk to AVA</span>
            <Mic size={14} aria-hidden className="opacity-60" />
          </button>
        </header>


        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <TodayCard title="Continue talking" icon={<MessageSquareText size={15} aria-hidden />} action={{ label: "All conversations", onClick: props.onOpenTalk }}>
            <SectionBody
              section={talks}
              loadingText="Loading your conversations…"
              errorText="Your conversations could not be loaded."
              emptyText="Your conversations with AVA will appear here."
              render={(rows) => rows.map((row) => (
                <ItemButton
                  key={row.id}
                  title={row.title || "Untitled conversation"}
                  meta={formatWhen(lastHumanActivity(row))}
                  onClick={() => props.onOpenChat(row.id)}
                />
              ))}
            />
          </TodayCard>

          <div className="flex flex-col gap-4">
            <TodayCard title="Recent ideas" icon={<Lightbulb size={15} aria-hidden />} action={{ label: "All ideas", onClick: props.onOpenIdeas }}>
              <SectionBody
                section={ideas.status === "ok" ? { status: "ok", value: ideas.value.slice(0, LIST_SIZE) } : ideas}
                loadingText="Loading ideas…"
                errorText="Your ideas could not be loaded."
                emptyText="No ideas yet."
                render={(rows) => rows.map((note) => (
                  <ItemButton key={note.id} title={note.title || "Untitled idea"} meta={formatWhen(note.updatedAt)} onClick={() => props.onOpenNote(note.id)} />
                ))}
              />
            </TodayCard>

            <TodayCard title="Recent notes" icon={<FileText size={15} aria-hidden />} action={{ label: "All notes", onClick: props.onOpenNotes }}>
              <SectionBody
                section={notes.status === "ok" ? { status: "ok", value: notes.value.slice(0, LIST_SIZE) } : notes}
                loadingText="Loading notes…"
                errorText="Your notes could not be loaded."
                emptyText="No notes yet."
                render={(rows) => rows.map((note) => (
                  <ItemButton key={note.id} title={note.title || "Untitled note"} meta={formatWhen(note.updatedAt)} onClick={() => props.onOpenNote(note.id)} />
                ))}
              />
            </TodayCard>

            {/* Read-only: the status says only what the notification service confirmed. */}
            <TodayCard title="Schedule" icon={<CalendarClock size={15} aria-hidden />}>
              <SectionBody
                section={reminders.status === "ok" ? { status: "ok", value: reminders.value.upcoming.slice(0, LIST_SIZE) } : reminders}
                loadingText="Loading reminders…"
                errorText="Your reminders could not be loaded."
                emptyText="No reminders coming up."
                render={(rows) => rows.map((watch) => <ReminderLine key={watch.id} watch={watch} />)}
              />
              {feed.status === "ok" && feed.stale && (
                <p role="status" className="text-meta text-warning">
                  Couldn't refresh. Showing reminders as of {fetchedAtLabel(feed.fetchedAt)}; their status may have changed since.
                </p>
              )}
            </TodayCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function FirstRun(props: TodayScreenProps & { dateLine: string }) {
  return (
    <div className="ava-today ds-root ds-today-workspace h-full w-full overflow-y-auto bg-canvas font-ui text-ink">
      <Atmosphere kind="silk" />
      <div className="ds-today-content mx-auto flex w-full max-w-[820px] flex-col items-center gap-6 px-4 pt-10 text-center sm:px-8">
        <button type="button" onClick={props.onEnterVoice} aria-label="Talk to AVA" className="ds-focus rounded-full">
          <FaceStill size={104} />
        </button>
        <div className="flex flex-col gap-3">
          <p className="text-meta text-ink-2">{props.dateLine}</p>
          <h1 className="text-title tracking-tight text-ink">Let's set AVA up to run your week.</h1>
          <p className="mx-auto max-w-[600px] text-body leading-7 text-ink-2">
            Nothing is on Today yet. Tell AVA about your courses, deadlines and plans in your own words,
            typing or talking. Your conversations, ideas and notes appear here as you add them.
          </p>
        </div>
        <p className="text-body text-ink-2">Use the message bar below to tell AVA about your week.</p>
        <div className="grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-3">
          {STARTERS.map((starter) => (
            <MetalObject key={starter.title} variant="cut" title={starter.title} eyebrow="Start here"
              detail={starter.detail} onClick={() => props.onStartChat(starter.prompt)} />
          ))}
        </div>
        <section aria-labelledby="today-setup" className="w-full py-4 text-left">
          <h2 id="today-setup" className="mb-2 text-label text-ink-2">Getting set up</h2>
          <ol className="flex flex-col text-body">
            <li className="flex items-center justify-between gap-3 py-3">
              <span className="text-ink">Tell AVA about your courses and plans</span>
              <button type="button" className="ds-focus rounded-full px-4 py-3 text-meta" onClick={() => props.onStartChat(STARTERS[0].prompt)}>Start</button>
            </li>
            <li className="flex items-center justify-between gap-3 py-3">
              <span className="text-ink">Phone notifications for reminders</span>
              <span className="text-meta text-ink-2">Not available yet</span>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}

function TodayCard({ title, icon, action, children }: {
  title: string;
  icon: React.ReactNode;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="ds-today-section flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-meta text-ink-2">
          <span>{icon}</span>
          {title}
        </h2>
        {action && (
          <button type="button" onClick={action.onClick} className="ds-focus flex min-h-11 items-center gap-1 rounded-control text-meta text-ink-2 hover:text-ink">
            {action.label}
            <ChevronRight size={12} aria-hidden />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function SectionBody<T>({ section, loadingText, errorText, emptyText, render }: {
  section: Section<T[]>;
  loadingText: string;
  errorText: string;
  emptyText: string;
  render: (rows: T[]) => React.ReactNode;
}) {
  if (section.status === "loading") return <p role="status" className="py-2 text-meta text-ink-2">{loadingText}</p>;
  if (section.status === "error") return <p role="alert" className="py-2 text-meta text-danger">{errorText}</p>;
  if (section.value.length === 0) return <p className="py-2 text-body text-ink-2">{emptyText}</p>;
  return <ul className="flex flex-col">{render(section.value)}</ul>;
}

function ReminderLine({ watch }: { watch: WatchRow }) {
  const view = presentReminder(watch);
  if (!view) return null;
  return (
    <li className="grid gap-3">
      <MetalObject variant="cut" title={watch.prompt} eyebrow="Reminder" detail={view.due} />
      <ReminderStatusChip presentation={view} appearance="atelier" />
    </li>
  );
}

function ItemButton({ title, meta, onClick }: { title: string; meta: string; onClick: () => void }) {
  return (
    <li>
      <MetalObject variant="twin" title={title} eyebrow="Updated" value={meta} onClick={onClick} />
    </li>
  );
}
