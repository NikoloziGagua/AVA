import { useRef, useState } from "react";
import { ApiError } from "../api.js";
import type { CalendarOccurrence } from "./api.js";
import { endSeries, extendSeries, removeEvent, restoreEvent, type EventDefinition } from "./workspace-api.js";

export type Undo = { text: string; run: () => Promise<unknown> };

const day = (date: string) => new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
const errorText = (error: unknown) => error instanceof ApiError ? error.message : "This change could not be confirmed. Refresh before trying again.";

/**
 * calendar-events v3: end a weekly series from a future occurrence, or remove
 * a whole event. Nothing is deleted; each action returns a versioned Undo.
 */
export function SeriesActions({ occurrence, definition, started, disabled, onDone }: {
  occurrence: CalendarOccurrence;
  definition: EventDefinition;
  /** The first occurrence has already begun, so removing hides past ones too. */
  started: boolean;
  disabled: boolean;
  onDone: (undo: Undo) => void;
}) {
  const [panel, setPanel] = useState<"end" | "remove" | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const weekly = definition.recurrenceKind === "weekly";
  const canEnd = weekly && occurrence.startsAt > Date.now() && occurrence.originalLocalDate > definition.anchorLocalDate;
  const noun = weekly ? "series" : "event";
  if (definition.archivedAt) return null;

  const run = async (action: () => Promise<{ undo: Undo }>) => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const done = await action();
      setPanel(null); onDone(done.undo);
    } catch (failure) { setError(errorText(failure)); }
    finally { sending.current = false; setBusy(false); }
  };
  const end = () => run(async () => {
    const { event, previousRecurrenceUntilDate } = await endSeries(definition, occurrence.originalLocalDate);
    return {
      undo: { text: `${definition.title} ends after ${day(event.recurrenceUntilDate!)}.`, run: () => extendSeries(event, previousRecurrenceUntilDate) } };
  });
  const remove = () => run(async () => {
    const event = await removeEvent(definition, started);
    return { undo: { text: `Removed ${definition.title}.`, run: () => restoreEvent(event) } };
  });

  return <div className="ds-calendar-series" role="group" aria-label={`Whole ${noun}`}>
    <p className="ds-calendar-eyebrow">WHOLE {noun.toUpperCase()}</p>
    {panel === null ? <div className="flex flex-wrap gap-2">
      {canEnd && <button type="button" disabled={disabled} className="ds-focus ds-calendar-quiet" onClick={() => { setError(null); setPanel("end"); }}>End series from here</button>}
      <button type="button" disabled={disabled} className="ds-focus ds-calendar-quiet" onClick={() => { setError(null); setPanel("remove"); }}>{weekly ? "Remove series…" : "Remove event…"}</button>
    </div> : panel === "end" ? <div className="grid gap-3">
      <p><strong>End this series from {day(occurrence.originalLocalDate)}?</strong></p>
      <p className="text-meta text-ink-2">This one and every later one stop. Earlier ones, and anything you recorded, stay. You can undo this.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="ds-focus ds-calendar-quiet" onClick={() => setPanel(null)}>Keep it</button>
        <button type="button" disabled={busy} className="ds-focus ds-calendar-primary" onClick={() => void end()}>{busy ? "Ending…" : "End series"}</button></div>
    </div> : <div className="grid gap-3">
      <p><strong>Remove this {noun}?</strong></p>
      <p className="text-meta text-ink-2">{started ? "It has already started, so its past occurrences are hidden too. " : ""}Use this for a duplicate or a mistake{weekly ? "; to stop a real series, use End series instead" : ""}. Nothing is deleted, and you can undo.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="ds-focus ds-calendar-quiet" onClick={() => setPanel(null)}>Keep it</button>
        <button type="button" disabled={busy} className="ds-focus ds-calendar-primary" onClick={() => void remove()}>{busy ? "Removing…" : `Remove ${noun}`}</button></div>
    </div>}
  </div>;
}
