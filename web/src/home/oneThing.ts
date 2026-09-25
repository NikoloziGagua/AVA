import type { CalendarOccurrence } from "../calendar/api.js";

/**
 * Home shows exactly one thing for today, chosen by a fixed, truthful rule over
 * data AVA already holds (contract ui-remodel v2 §6). No guessing:
 *   1. the next calendar event today that hasn't started;
 *   2. otherwise a reminder due in the next 24 hours;
 *   3. otherwise the most recently updated pinned note;
 *   4. otherwise nothing planned.
 */

export type OneThing =
  | { kind: "event"; title: string; startsAt: number; location: string; attendanceIntent: CalendarOccurrence["attendanceIntent"]; key: string }
  | { kind: "reminder"; title: string; dueAt: number; id: string }
  | { kind: "note"; title: string; id: string }
  | { kind: "none" };

export type ReminderInput = { id: string; title: string; dueAt: number };
export type NoteInput = { id: string; title: string; pinned: boolean; archived: boolean; updatedAt: number };

const DAY = 86_400_000;

/** The calendar date of an instant in a time zone, as YYYY-MM-DD. */
export function localDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function pickOneThing(input: {
  now: number;
  timeZone: string;
  occurrences: readonly CalendarOccurrence[];
  reminders: readonly ReminderInput[];
  notes: readonly NoteInput[];
}): OneThing {
  const today = localDate(input.now, input.timeZone);
  const event = input.occurrences
    .filter((o) => !o.cancelled && o.startsAt > input.now && localDate(o.startsAt, input.timeZone) === today)
    .sort((a, b) => a.startsAt - b.startsAt)[0];
  if (event) {
    return { kind: "event", title: event.title, startsAt: event.startsAt, location: event.location, attendanceIntent: event.attendanceIntent, key: event.occurrenceKey };
  }
  const reminder = input.reminders
    .filter((r) => Number.isFinite(r.dueAt) && r.dueAt > input.now && r.dueAt <= input.now + DAY)
    .sort((a, b) => a.dueAt - b.dueAt)[0];
  if (reminder) return { kind: "reminder", title: reminder.title, dueAt: reminder.dueAt, id: reminder.id };
  const note = input.notes
    .filter((n) => n.pinned && !n.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (note) return { kind: "note", title: note.title, id: note.id };
  return { kind: "none" };
}

/** Three fixed next steps tied to the one thing. Picking one starts a chat with it. */
export function suggestionsFor(thing: OneThing): string[] {
  const quote = (text: string) => (text.length > 40 ? `${text.slice(0, 39)}…` : text);
  switch (thing.kind) {
    case "event": return [`Get me ready for ${quote(thing.title)}`, "Plan my day", "What's due this week?"];
    case "reminder": return [`Help me with ${quote(thing.title)}`, "Plan my day", "What's due this week?"];
    case "note": return [`Continue ${quote(thing.title)}`, "Plan my day", "What's due this week?"];
    default: return ["Plan my day", "What's due this week?", "Start a study session"];
  }
}
