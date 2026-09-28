import { CalendarDays, ChevronLeft, ChevronRight, NotebookPen } from "lucide-react";
import { Button } from "../design/Button.js";
import { Chip } from "../design/Chip.js";
import type { InitiativeSourceView } from "./api.js";
import { IDEA_UNAVAILABLE } from "./copy.js";
import type { InvitationPosition, InvitationRef, InvitationState } from "./useInvitation.js";

const ZONE = "Europe/Dublin";

function when(at: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(at);
}

function SourceChip({ source, onOpenNote, onOpenCalendarAt }: {
  source: InitiativeSourceView;
  onOpenNote?: (noteId: string) => void;
  onOpenCalendarAt?: (at: number, occurrenceKey: string) => void;
}) {
  const note = source.type === "note";
  const icon = note ? <NotebookPen size={14} aria-hidden="true" /> : <CalendarDays size={14} aria-hidden="true" />;
  if (!source.available) {
    return <Chip leading={icon} disabled aria-disabled="true" className="opacity-60">No longer available</Chip>;
  }
  if (source.type === "note") {
    const title = source.title?.trim() || "Untitled note";
    return (
      <Chip leading={icon} onClick={() => onOpenNote?.(source.id)} aria-label={`Open note: ${title}`} className="max-w-full">
        <span className="truncate">{title}</span>
      </Chip>
    );
  }
  const title = source.title?.trim() || "Calendar entry";
  const at = source.startsAt;
  const label = at === null ? title : `${title} · ${when(at)}`;
  return (
    <Chip
      leading={icon}
      onClick={at === null ? undefined : () => onOpenCalendarAt?.(at, source.occurrenceKey)}
      disabled={at === null}
      aria-label={`Open in Calendar: ${label}`}
      className="max-w-full"
    >
      <span className="truncate">{label}</span>
    </Chip>
  );
}

/**
 * Under AVA's invitation: why now, where it came from, and three answers.
 * Let's talk puts the cursor in the message box; Later keeps it without a
 * second push; Not useful dismisses it. A reply is always the real answer.
 */
export function InvitationPanel({ state, notice, busy, onTalk, onLater, onNotUseful, onOpenNote, onOpenCalendarAt }: {
  state: Extract<InvitationState, { status: "open" | "closed" }>;
  notice: string | null;
  busy: boolean;
  onTalk: () => void;
  onLater: () => void;
  onNotUseful: () => void;
  onOpenNote?: (noteId: string) => void;
  onOpenCalendarAt?: (at: number, occurrenceKey: string) => void;
}) {
  const { view } = state;
  const later = view.disposition.state === "later";
  return (
    <section aria-label="AVA's idea" className="grid gap-2.5">
      {state.status === "open" && view.reasonNow.trim() && (
        <p className="text-meta text-ink-2"><span className="text-ink-3">Why now · </span>{view.reasonNow}</p>
      )}
      {view.sources.length > 0 && (
        <div role="group" aria-label="Where this idea came from" className="flex flex-wrap gap-2">
          {view.sources.map((source) => (
            <SourceChip
              key={source.type === "note" ? `note:${source.id}` : `calendar:${source.occurrenceKey}`}
              source={source}
              onOpenNote={onOpenNote}
              onOpenCalendarAt={onOpenCalendarAt}
            />
          ))}
        </div>
      )}
      {state.status === "open" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="solid" size="sm" onClick={onTalk}>Let's talk</Button>
          <Button variant="glass" size="sm" onClick={onLater} disabled={busy || later} aria-pressed={later}>
            {later ? "Saved for later" : "Later"}
          </Button>
          <Button variant="quiet" size="sm" onClick={onNotUseful} disabled={busy}>Not useful</Button>
        </div>
      ) : !notice && (
        <p className="text-meta text-ink-3">
          {state.reason === "expired" ? "This idea has expired. You can still reply to it." : "You marked this idea not useful."}
        </p>
      )}
      {notice && <p role="status" className="text-meta text-ink-2">{notice}</p>}
    </section>
  );
}

/** "Idea 2 of 3" with newer and older neighbours from AVA's inbox. */
export function InvitationNav({ position, onOpen }: {
  position: InvitationPosition;
  onOpen: (target: InvitationRef) => void;
}) {
  return (
    <nav aria-label="AVA's ideas" className="flex items-center gap-0.5 text-meta text-ink-2">
      <Button
        variant="quiet"
        size="icon"
        aria-label="Newer idea"
        disabled={!position.newer}
        onClick={() => position.newer && onOpen(position.newer)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </Button>
      <span aria-live="polite">Idea {position.index} of {position.total}</span>
      <Button
        variant="quiet"
        size="icon"
        aria-label="Older idea"
        disabled={!position.older}
        onClick={() => position.older && onOpen(position.older)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </Button>
    </nav>
  );
}

/** A link whose idea is gone or does not match: said in place, naming nothing. */
export function IdeaUnavailable({ onOpenList, onNewChat }: { onOpenList?: () => void; onNewChat?: () => void }) {
  return (
    <div role="alert" className="mx-auto grid max-w-md flex-1 content-center justify-items-center gap-4 px-6 text-center">
      <p className="text-body-lg text-ink">{IDEA_UNAVAILABLE}</p>
      <p className="text-body text-ink-2">It may have expired, or it was removed.</p>
      <div className="flex flex-wrap justify-center gap-2">
        {onOpenList && <Button variant="glass" onClick={onOpenList}>Your conversations</Button>}
        {onNewChat && <Button variant="quiet" onClick={onNewChat}>Start a new conversation</Button>}
      </div>
    </div>
  );
}
