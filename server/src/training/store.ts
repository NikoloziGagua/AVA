import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import {
  archiveCalendarEvent, createCalendarEvent, getCalendarEvent, getCalendarOccurrence, queryCalendar, updateCalendarEvent,
  upsertCalendarException,
} from "../calendar/service.js";
import { CalendarError, type CalendarOccurrence, type CalendarSource } from "../calendar/types.js";
import { addLocalDays, formatZonedDateTime, localDayWindow, resolveLocalDateTime } from "../calendar/time.js";
import {
  DISCIPLINES, DISCIPLINE_LABEL, FEELINGS, TIME_ZONE, bodyAreas, clock, disciplineFromTitle, isHard, minutesOf, readiness,
  type Busy, type Discipline, type Feeling, type PlanBlock, type SessionStatus,
} from "./rules.js";

/** Where a change came from: the Training tab, typed chat, voice, or AVA's planner. */
export type TrainingSource = "app" | "chat" | "voice" | "ava";

export type TrainingSession = {
  id: string;
  discipline: Discipline;
  title: string;
  status: SessionStatus;
  localDate: string;
  /** HH:MM:SS in Europe/Dublin; null for a session logged without a time. */
  startLocalTime: string | null;
  durationMin: number | null;
  plan: PlanBlock[];
  reason: string;
  calendarEventId: string | null;
  calendarEventVersion: number | null;
  minutes: number | null;
  effort: number | null;
  sore: string[];
  notes: string;
  distanceKm: number | null;
  durationS: number | null;
  loggedAt: number | null;
  source: TrainingSource;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type Checkin = { id: string; localDate: string; feeling: Feeling; sore: string[]; sleepHours: number | null; note: string; createdAt: number; updatedAt: number };

export class TrainingError extends Error {
  constructor(readonly code: "not_found" | "stale_version" | "invalid" | "conflict", message: string) {
    super(message);
  }
}

type Row = {
  id: string; discipline: string; title: string; status: string; local_date: string; start_local_time: string | null;
  duration_min: number | null; plan: string; reason: string; calendar_event_id: string | null; calendar_event_version: number | null;
  minutes: number | null; effort: number | null; sore: string; notes: string; distance_km: number | null; duration_s: number | null;
  logged_at: number | null; source: string; version: number; created_at: number; updated_at: number;
};
type CheckinRow = { id: string; local_date: string; feeling: string; sore: string; sleep_hours: number | null; note: string; created_at: number; updated_at: number };

function json<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

const toSession = (row: Row): TrainingSession => ({
  id: row.id, discipline: row.discipline as Discipline, title: row.title, status: row.status as SessionStatus, localDate: row.local_date,
  startLocalTime: row.start_local_time, durationMin: row.duration_min, plan: json<PlanBlock[]>(row.plan, []), reason: row.reason,
  calendarEventId: row.calendar_event_id, calendarEventVersion: row.calendar_event_version, minutes: row.minutes, effort: row.effort,
  sore: json<string[]>(row.sore, []), notes: row.notes, distanceKm: row.distance_km, durationS: row.duration_s, loggedAt: row.logged_at,
  source: row.source as TrainingSource, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
});
const toCheckin = (row: CheckinRow): Checkin => ({
  id: row.id, localDate: row.local_date, feeling: row.feeling as Feeling, sore: json<string[]>(row.sore, []), sleepHours: row.sleep_hours,
  note: row.note, createdAt: row.created_at, updatedAt: row.updated_at,
});

export const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
const cleanSore = (sore: readonly string[]) => [...new Set(sore.map((spot) => clean(spot, 40).toLowerCase()).filter(Boolean))].slice(0, 8);

// ---- Time -------------------------------------------------------------------

/** Today's date and the minute of the day, in Dublin. */
export function localNow(now: number): { localDate: string; minutes: number } {
  const stamp = formatZonedDateTime(now, TIME_ZONE);
  return { localDate: stamp.slice(0, 10), minutes: minutesOf(stamp.slice(11, 16)) };
}

/** The Monday of the week a date falls in (weeks run Monday to Sunday). */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addLocalDays(date, -((weekday + 6) % 7));
}

const LABEL = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
export const dayLabel = (date: string) => LABEL.format(new Date(`${date}T12:00:00Z`)).replace(",", "").replace("Sept", "Sep");

/** The week "plan my week" means: this one, or on a Sunday the one ahead. */
export function planningMonday(today: string): string {
  return new Date(`${today}T12:00:00Z`).getUTCDay() === 0 ? addLocalDays(today, 1) : mondayOf(today);
}

/** When a session starts. A time the clocks skip is Sir's to change, not a crash. */
function startsAt(session: Pick<TrainingSession, "localDate" | "startLocalTime">): number | null {
  if (!session.startLocalTime) return null;
  try { return resolveLocalDateTime(session.localDate, session.startLocalTime, TIME_ZONE, "earlier"); }
  catch (error) { calendarFailure(error); }
}

export function timeRange(session: Pick<TrainingSession, "startLocalTime" | "durationMin">): string | null {
  if (!session.startLocalTime) return null;
  const start = minutesOf(session.startLocalTime);
  return `${clock(start)}–${clock(start + (session.durationMin ?? 0))}`;
}

// ---- Sessions ---------------------------------------------------------------

export function getSession(db: Db, id: string): TrainingSession | null {
  const row = db.prepare("SELECT * FROM training_sessions WHERE id = ?").get(id) as Row | undefined;
  return row ? toSession(row) : null;
}

export function sessionsBetween(db: Db, from: string, to: string): TrainingSession[] {
  return (db.prepare(`SELECT * FROM training_sessions WHERE local_date BETWEEN ? AND ?
    ORDER BY local_date, start_local_time IS NULL, start_local_time, created_at`).all(from, to) as Row[]).map(toSession);
}

function guard(db: Db, id: string, expectedVersion?: number): TrainingSession {
  const session = getSession(db, id);
  if (!session) throw new TrainingError("not_found", "That session doesn't exist.");
  if (expectedVersion !== undefined && session.version !== expectedVersion) {
    throw new TrainingError("stale_version", "That session changed since you opened it. Refresh and try again.");
  }
  return session;
}

type Columns = Partial<Record<keyof Row, unknown>>;

/** One guarded write: the session must still be at the version just read. */
function write(db: Db, session: TrainingSession, columns: Columns, now: number): TrainingSession {
  const keys = Object.keys(columns) as Array<keyof Row>;
  const sets = keys.map((key) => `${key} = ?`).join(", ");
  const result = db.prepare(`UPDATE training_sessions SET ${sets}${sets ? ", " : ""}version = version + 1, updated_at = ?
    WHERE id = ? AND version = ?`).run(...keys.map((key) => columns[key]), now, session.id, session.version);
  if (result.changes !== 1) throw new TrainingError("stale_version", "That session changed since you opened it. Refresh and try again.");
  return getSession(db, session.id)!;
}

function calendarFailure(error: unknown): never {
  if (!(error instanceof CalendarError)) throw error;
  if (error.code === "stale_version") throw new TrainingError("stale_version", "It changed in your calendar since you opened it. Refresh and try again.");
  if (error.code === "series_started" || error.code === "occurrence_started") throw new TrainingError("invalid", "It has already started, so it stays in your calendar.");
  if (error.code === "nonexistent_local_time" || error.code === "ambiguous_local_time") throw new TrainingError("invalid", "The clocks change at that time. Pick another.");
  throw new TrainingError("invalid", error.message);
}

export function insertProposal(db: Db, input: {
  discipline: Discipline; localDate: string; startLocalTime: string; durationMin: number; title: string; plan: PlanBlock[]; reason: string;
}, now = Date.now()): TrainingSession {
  const id = `trs_${nanoid(12)}`;
  db.prepare(`INSERT INTO training_sessions (id, discipline, title, status, local_date, start_local_time, duration_min, plan, reason,
    source, version, created_at, updated_at) VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?, 'ava', 1, ?, ?)`).run(
    id, input.discipline, clean(input.title, 120) || DISCIPLINE_LABEL[input.discipline], input.localDate, input.startLocalTime, input.durationMin,
    JSON.stringify(input.plan.slice(0, 12)), clean(input.reason, 240), now, now,
  );
  return getSession(db, id)!;
}

/** Unapproved proposals are AVA's to replace; approved, done and skipped sessions are never touched. */
export function clearProposals(db: Db, from: string, to: string): number {
  return db.prepare("DELETE FROM training_sessions WHERE status = 'proposed' AND local_date BETWEEN ? AND ?").run(from, to).changes;
}

/** Calendar entries that overlap a slot (no buffer: this guards what Sir or AVA is about to write). */
function calendarClash(db: Db, date: string, startMin: number, endMin: number, now: number, ignoreEventId: string | null): CalendarItem | null {
  return weekCalendar(db, date, date, [], now)
    .find((item) => item.occurrence.eventId !== ignoreEventId && startMin < item.endMin && endMin > item.startMin) ?? null;
}

const clashText = (item: CalendarItem) => `That time now clashes with ${item.title} (${item.start}–${item.end}).`;

/** Approving adds exactly one calendar block. It is the only way a session reaches the calendar. */
export function approveSession(db: Db, id: string, opts: { expectedVersion?: number; source: CalendarSource; sessionId?: string | null }, now = Date.now()): TrainingSession {
  return db.transaction(() => {
    const session = guard(db, id, opts.expectedVersion);
    if (session.status === "approved") throw new TrainingError("invalid", "It's already in your calendar.");
    if (session.status !== "proposed") throw new TrainingError("invalid", `That session is ${session.status}.`);
    if (!session.startLocalTime || !session.durationMin) throw new TrainingError("invalid", "It needs a time first.");
    if (startsAt(session)! <= now) throw new TrainingError("invalid", "That time has passed. Plan again or pick a new time.");
    const start = minutesOf(session.startLocalTime);
    const clash = calendarClash(db, session.localDate, start, start + session.durationMin, now, null);
    if (clash) throw new TrainingError("conflict", clashText(clash));
    let eventId: string, eventVersion: number;
    try {
      const event = createCalendarEvent(db, {
        title: session.title, description: "Training, planned with AVA", kind: "block", timeZone: TIME_ZONE,
        anchorLocalDate: session.localDate, startLocalTime: session.startLocalTime, durationMinutes: session.durationMin,
        recurrenceKind: "none", source: opts.source, sourceSessionId: opts.sessionId ?? null,
      }, now);
      eventId = event.id; eventVersion = event.version;
    } catch (error) { calendarFailure(error); }
    return write(db, session, { status: "approved", calendar_event_id: eventId, calendar_event_version: eventVersion }, now);
  }).immediate();
}

/** Takes an approved session out of the calendar (archives its event) and makes it a proposal again. */
export function unscheduleSession(db: Db, id: string, opts: { expectedVersion?: number }, now = Date.now()): TrainingSession {
  return db.transaction(() => {
    const session = guard(db, id, opts.expectedVersion);
    if (session.status !== "approved" || !session.calendarEventId) throw new TrainingError("invalid", "It isn't in your calendar.");
    const event = getCalendarEvent(db, session.calendarEventId);
    if (event && event.archivedAt === null) {
      try { archiveCalendarEvent(db, session.calendarEventId, session.calendarEventVersion ?? event.version, now); }
      catch (error) { calendarFailure(error); }
    }
    return write(db, session, { status: "proposed", calendar_event_id: null, calendar_event_version: null }, now);
  }).immediate();
}

export function skipSession(db: Db, id: string, opts: { expectedVersion?: number }, now = Date.now()): TrainingSession {
  const session = guard(db, id, opts.expectedVersion);
  if (session.status === "skipped") return session;
  if (session.status === "done") throw new TrainingError("invalid", "It's already logged.");
  if (session.status === "approved" && (startsAt(session) ?? 0) > now) {
    throw new TrainingError("invalid", "It's in your calendar. Remove it from the calendar first.");
  }
  return write(db, session, { status: "skipped" }, now);
}

/** Undoes a skip. Only a session still ahead can come back, as a proposal. */
export function unskipSession(db: Db, id: string, opts: { expectedVersion?: number }, now = Date.now()): TrainingSession {
  const session = guard(db, id, opts.expectedVersion);
  if (session.status !== "skipped") throw new TrainingError("invalid", "It isn't skipped.");
  if ((startsAt(session) ?? 0) <= now) throw new TrainingError("invalid", "That time has passed.");
  return write(db, session, { status: "proposed" }, now);
}

/** When Sir tells AVA to skip one: a session still ahead in his calendar is taken out of it first. */
export function skipSaid(db: Db, id: string, now = Date.now(), expectedVersion?: number): { session: TrainingSession; removed: boolean } {
  return db.transaction(() => {
    const session = guard(db, id, expectedVersion);
    const removed = session.status === "approved" && (startsAt(session) ?? 0) > now;
    if (removed) unscheduleSession(db, id, {}, now);
    return { session: skipSession(db, id, {}, now), removed };
  })();
}

export type SessionPatch ={ localDate?: string; startLocalTime?: string; durationMin?: number; title?: string; plan?: PlanBlock[] };

/** Moves or reshapes a proposal, or an approved session together with its calendar event. */
export function updateSession(db: Db, id: string, patch: SessionPatch, opts: { expectedVersion: number }, now = Date.now()): TrainingSession {
  return db.transaction(() => {
    const session = guard(db, id, opts.expectedVersion);
    if (session.status === "done" || session.status === "skipped") throw new TrainingError("invalid", `That session is ${session.status}.`);
    const next = {
      localDate: patch.localDate ?? session.localDate,
      startLocalTime: patch.startLocalTime ?? session.startLocalTime,
      durationMin: patch.durationMin ?? session.durationMin,
      title: patch.title !== undefined ? clean(patch.title, 120) || session.title : session.title,
      plan: patch.plan ?? session.plan,
    };
    if (!next.startLocalTime || !next.durationMin) throw new TrainingError("invalid", "It needs a time and a length.");
    const moved = next.localDate !== session.localDate || next.startLocalTime !== session.startLocalTime || next.durationMin !== session.durationMin;
    if (moved) {
      if (startsAt(next)! <= now) throw new TrainingError("invalid", "That time has passed.");
      const start = minutesOf(next.startLocalTime);
      const clash = calendarClash(db, next.localDate, start, start + next.durationMin, now, session.calendarEventId);
      if (clash) throw new TrainingError("conflict", clashText(clash));
    }
    let eventVersion = session.calendarEventVersion;
    if (session.status === "approved" && session.calendarEventId && (moved || next.title !== session.title)) {
      try {
        eventVersion = updateCalendarEvent(db, session.calendarEventId, session.calendarEventVersion ?? 0, {
          anchorLocalDate: next.localDate, startLocalTime: next.startLocalTime, durationMinutes: next.durationMin, title: next.title,
        }, now).version;
      } catch (error) { calendarFailure(error); }
    }
    return write(db, session, {
      local_date: next.localDate, start_local_time: next.startLocalTime, duration_min: next.durationMin, title: next.title,
      plan: JSON.stringify(next.plan.slice(0, 12)), calendar_event_version: eventVersion,
    }, now);
  }).immediate();
}

export type LogInput = {
  minutes?: number | null; effort?: number | null; sore?: string[]; notes?: string; distanceKm?: number | null; durationS?: number | null;
};

function logColumns(session: TrainingSession, log: LogInput, now: number): Columns {
  const effort = log.effort ?? null;
  if (effort !== null && (!Number.isInteger(effort) || effort < 1 || effort > 10)) throw new TrainingError("invalid", "Effort is 1 to 10.");
  const minutes = log.minutes ?? session.minutes ?? session.durationMin ?? null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) throw new TrainingError("invalid", "Minutes must be 1 to 600.");
  return {
    status: "done", minutes, effort: effort ?? session.effort, sore: JSON.stringify(cleanSore(log.sore ?? session.sore)),
    notes: log.notes !== undefined ? clean(log.notes, 1_000) : session.notes,
    distance_km: log.distanceKm ?? session.distanceKm, duration_s: log.durationS ?? session.durationS, logged_at: now,
  };
}

/** Marks a session done with how it went. A later log of the same session corrects it. */
export function logSession(db: Db, id: string, log: LogInput, opts: { expectedVersion?: number }, now = Date.now()): TrainingSession {
  const session = guard(db, id, opts.expectedVersion);
  if (session.localDate > localNow(now).localDate) throw new TrainingError("invalid", "That session hasn't happened yet.");
  return write(db, session, logColumns(session, log, now), now);
}

const CORRECTION_MS = 3 * 60 * 60_000;

/**
 * Logs what Sir says he did. Today's planned session of that discipline is
 * marked done; otherwise a new done session is made, at the time of matching
 * training in his calendar if there is one.
 */
export function logTraining(db: Db, input: LogInput & { discipline: Discipline; localDate?: string; title?: string; source: TrainingSource }, now = Date.now()): { session: TrainingSession; matched: "planned" | "calendar" | "new" | "corrected" } {
  if (!(DISCIPLINES as readonly string[]).includes(input.discipline)) throw new TrainingError("invalid", "Unknown discipline.");
  const today = localNow(now).localDate;
  const date = input.localDate ?? today;
  if (date > today || date < addLocalDays(today, -14)) throw new TrainingError("invalid", "Log sessions from the last two weeks.");
  return db.transaction(() => {
    const sameDay = sessionsBetween(db, date, date);
    // Saying it again soon after ("actually 75 minutes") corrects that log rather than adding a second session.
    const recent = sameDay.find((session) => session.status === "done" && session.discipline === input.discipline
      && session.loggedAt !== null && now - session.loggedAt < CORRECTION_MS);
    if (recent) return { session: logSession(db, recent.id, input, {}, now), matched: "corrected" as const };
    const planned = sameDay
      .filter((session) => session.discipline === input.discipline && (session.status === "approved" || session.status === "proposed"))
      .sort((a, b) => (a.status === "approved" ? 0 : 1) - (b.status === "approved" ? 0 : 1))[0];
    if (planned) return { session: logSession(db, planned.id, input, {}, now), matched: "planned" as const };
    const booked = weekCalendar(db, date, date, sameDay, now).find((item) => item.kind === "booked" && item.discipline === input.discipline);
    const id = `trs_${nanoid(12)}`;
    db.prepare(`INSERT INTO training_sessions (id, discipline, title, status, local_date, start_local_time, duration_min, source, version, created_at, updated_at)
      VALUES (?, ?, ?, 'done', ?, ?, ?, ?, 1, ?, ?)`).run(
      id, input.discipline, clean(input.title ?? "", 120) || booked?.title || DISCIPLINE_LABEL[input.discipline], date,
      booked ? `${booked.start}:00` : null, booked ? booked.endMin - booked.startMin : null, input.source, now, now,
    );
    return { session: logSession(db, id, input, {}, now), matched: booked ? "calendar" as const : "new" as const };
  }).immediate();
}

// ---- Check-ins ----------------------------------------------------------------

export function getCheckin(db: Db, date: string): Checkin | null {
  const row = db.prepare("SELECT * FROM training_checkins WHERE local_date = ?").get(date) as CheckinRow | undefined;
  return row ? toCheckin(row) : null;
}

/** One check-in per day. Saying more later adds to it; anything not said stays as it was. */
export function saveCheckin(db: Db, date: string, input: { feeling?: Feeling; sore?: string[]; sleepHours?: number | null; note?: string }, now = Date.now()): Checkin {
  const today = localNow(now).localDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < addLocalDays(today, -30)) throw new TrainingError("invalid", "Check in for today or a recent day.");
  if (input.feeling !== undefined && !(FEELINGS as readonly string[]).includes(input.feeling)) throw new TrainingError("invalid", "Unknown feeling.");
  if (input.sleepHours !== undefined && input.sleepHours !== null && !(input.sleepHours >= 0 && input.sleepHours <= 16)) throw new TrainingError("invalid", "Hours slept must be 0 to 16.");
  const current = getCheckin(db, date);
  const feeling = input.feeling ?? current?.feeling;
  if (!feeling) throw new TrainingError("invalid", "How are you feeling?");
  const sore = cleanSore(input.sore ?? current?.sore ?? []);
  const sleep = input.sleepHours !== undefined ? input.sleepHours : current?.sleepHours ?? null;
  const note = input.note !== undefined ? clean(input.note, 500) : current?.note ?? "";
  if (current) {
    db.prepare("UPDATE training_checkins SET feeling = ?, sore = ?, sleep_hours = ?, note = ?, updated_at = ? WHERE id = ?")
      .run(feeling, JSON.stringify(sore), sleep, note, now, current.id);
  } else {
    db.prepare("INSERT INTO training_checkins (id, local_date, feeling, sore, sleep_hours, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(`trc_${nanoid(12)}`, date, feeling, JSON.stringify(sore), sleep, note, now, now);
  }
  return getCheckin(db, date)!;
}

// ---- The calendar, as training sees it ------------------------------------------

export type CalendarItem = {
  kind: "calendar" | "booked" | "session";
  key: string; occurrence: CalendarOccurrence; localDate: string; start: string; end: string; startMin: number; endMin: number;
  title: string; discipline: Discipline | null; sessionId: string | null;
};

/** Every calendar occurrence in the days, sorted: AVA's own training blocks, training Sir booked himself, and everything else. */
export function weekCalendar(db: Db, from: string, to: string, sessions: TrainingSession[], now: number): CalendarItem[] {
  const window = { from: localDayWindow(from, TIME_ZONE).from, to: localDayWindow(to, TIME_ZONE).to };
  const byEvent = new Map(sessions.filter((session) => session.calendarEventId).map((session) => [session.calendarEventId!, session]));
  const items: CalendarItem[] = [];
  for (const occurrence of queryCalendar(db, window.from, window.to, TIME_ZONE, now).occurrences) {
    if (occurrence.cancelled) continue;
    const own = byEvent.get(occurrence.eventId);
    const discipline = own ? own.discipline : occurrence.kind === "lecture" ? null : disciplineFromTitle(occurrence.title);
    const first = occurrence.localStart.slice(0, 10), last = occurrence.localEnd.slice(0, 10);
    // Something that runs past midnight fills each day it touches, clipped to that day.
    for (let date = first < from ? from : first; date <= last && date <= to; date = addLocalDays(date, 1)) {
      const startMin = date === first ? minutesOf(occurrence.localStart.slice(11, 16)) : 0;
      const endMin = date === last ? minutesOf(occurrence.localEnd.slice(11, 16)) : 24 * 60;
      if (endMin <= startMin) continue;
      items.push({
        kind: own ? "session" : discipline ? "booked" : "calendar", key: date === first ? occurrence.occurrenceKey : `${occurrence.occurrenceKey}@${date}`,
        occurrence, localDate: date, start: clock(startMin), end: endMin === 24 * 60 ? "24:00" : clock(endMin), startMin, endMin,
        title: occurrence.title, discipline, sessionId: own?.id ?? null,
      });
    }
  }
  return items.sort((a, b) => a.localDate.localeCompare(b.localDate) || a.startMin - b.startMin);
}

/**
 * The calendar is the truth for approved sessions: one Sir moved there takes
 * the new time, and one he deleted there counts as skipped (he can undo that).
 */
export function syncWithCalendar(db: Db, from: string, to: string, now: number): void {
  for (const session of sessionsBetween(db, addLocalDays(from, -1), addLocalDays(to, 1))) {
    if (session.status !== "approved" || !session.calendarEventId) continue;
    const event = getCalendarEvent(db, session.calendarEventId);
    const occurrence = event && event.archivedAt === null ? getCalendarOccurrence(db, `${event.id}:${event.anchorLocalDate}`) : null;
    try {
      if (!event || !occurrence || occurrence.cancelled) {
        write(db, session, { status: "skipped", calendar_event_id: null, calendar_event_version: null }, now);
        continue;
      }
      const localDate = occurrence.localStart.slice(0, 10), start = `${occurrence.localStart.slice(11, 16)}:00`;
      const duration = Math.round((occurrence.endsAt - occurrence.startsAt) / 60_000);
      if (localDate !== session.localDate || start !== session.startLocalTime || duration !== session.durationMin
        || event.version !== session.calendarEventVersion || clean(event.title, 120) !== session.title) {
        write(db, session, {
          local_date: localDate, start_local_time: start, duration_min: duration, calendar_event_version: event.version, title: clean(event.title, 120) || session.title,
        }, now);
      }
    } catch (error) {
      // Changed by someone else a moment ago; the next read catches up.
      if (!(error instanceof TrainingError && error.code === "stale_version")) throw error;
    }
  }
}

const sessionText = (session: TrainingSession) => `${session.title} ${session.plan.map((block) => block.text).join(" ")}`;
export const sessionHard = (session: TrainingSession) => isHard({ discipline: session.discipline, text: sessionText(session), durationMin: session.durationMin });

/** What is already on each day, for the planner's rules: every calendar entry, plus approved and done training. */
export function busyFor(items: CalendarItem[], sessions: TrainingSession[]): Busy[] {
  const busy: Busy[] = items.map((item) => {
    const session = item.sessionId ? sessions.find((entry) => entry.id === item.sessionId) : undefined;
    const training = session
      ? { discipline: session.discipline, hard: sessionHard(session), areas: bodyAreas(session.discipline, sessionText(session)) }
      : item.discipline
        ? { discipline: item.discipline, hard: isHard({ discipline: item.discipline, text: item.title, durationMin: item.endMin - item.startMin }), areas: bodyAreas(item.discipline, item.title) }
        : undefined;
    return { localDate: item.localDate, startMin: item.startMin, endMin: item.endMin, title: item.title, ...(training ? { training } : {}) };
  });
  for (const session of sessions) {
    if (session.status !== "done" || session.calendarEventId) continue;
    const start = session.startLocalTime ? minutesOf(session.startLocalTime) : -10_000;
    busy.push({
      localDate: session.localDate, startMin: start, endMin: start + (session.durationMin ?? session.minutes ?? 0), title: session.title,
      training: { discipline: session.discipline, hard: sessionHard(session), areas: bodyAreas(session.discipline, sessionText(session)) },
    });
  }
  return busy;
}

// ---- The week ---------------------------------------------------------------

export type WeekItem =
  | { kind: "calendar"; key: string; start: string; end: string; title: string; label: "Lecture" | "Event" | "Block" }
  | { kind: "booked"; key: string; start: string; end: string; title: string; discipline: Discipline; hard: boolean }
  | { kind: "session"; key: string; start: string | null; end: string | null; session: TrainingSession; hard: boolean; conflict: string | null };

export type WeekDay = { date: string; past: boolean; today: boolean; rest: boolean; items: WeekItem[] };
export type OccurrenceRef = { occurrenceKey: string; eventVersion: number; exceptionVersion: number | null };
export type WeekWarning = {
  key: string; date: string; discipline: Discipline; title: string; text: string; start: string; end: string;
  /** Present only when both entries are still ahead, so Sir can press Merge. */
  fix: { first: OccurrenceRef; second: OccurrenceRef } | null;
};

export type TrainingWeek = {
  from: string; to: string; today: string; nowMinutes: number;
  days: WeekDay[];
  warnings: WeekWarning[];
  checkin: Checkin | null;
  readiness: { score: number; word: string; detail: string } | null;
  /** Done and planned per discipline this week. There are no targets. */
  cycle: Array<{ discipline: Discipline; done: number; planned: number }>;
  /** Proposals still ahead, waiting for Sir's OK. */
  waiting: number;
  note: string;
  fetchedAt: number;
};

const KIND_LABEL = { lecture: "Lecture", event: "Event", block: "Block" } as const;

/** Two entries for the same training back to back (or overlapping) look like one entered twice. */
function duplicatePairs(items: CalendarItem[]): Array<[CalendarItem, CalendarItem]> {
  const booked = items.filter((item) => item.kind === "booked" && item.key === item.occurrence.occurrenceKey);
  const pairs: Array<[CalendarItem, CalendarItem]> = [];
  const used = new Set<string>();
  for (const first of booked) {
    if (used.has(first.key)) continue;
    const second = booked.find((other) => other !== first && !used.has(other.key) && other.localDate === first.localDate && other.discipline === first.discipline
      && (other.startMin > first.startMin || (other.startMin === first.startMin && other.key > first.key)) && other.startMin <= first.endMin + 15);
    if (!second) continue;
    used.add(first.key); used.add(second.key);
    pairs.push([first, second]);
  }
  return pairs;
}
const ref = (occurrence: CalendarOccurrence): OccurrenceRef => ({
  occurrenceKey: occurrence.occurrenceKey, eventVersion: occurrence.eventVersion, exceptionVersion: occurrence.exceptionVersion,
});

export function trainingWeek(db: Db, opts: { from?: string } = {}, now = Date.now()): TrainingWeek {
  const { localDate: today, minutes: nowMinutes } = localNow(now);
  const from = mondayOf(opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from) ? opts.from : today), to = addLocalDays(from, 6);
  syncWithCalendar(db, from, to, now);
  const sessions = sessionsBetween(db, from, to);
  const calendar = weekCalendar(db, from, to, sessions, now);
  const ahead = (date: string, start: string | null) => date > today || (date === today && (start === null || minutesOf(start) > nowMinutes));
  const shown = sessions.filter((session) => session.status !== "proposed" || (session.startLocalTime !== null && ahead(session.localDate, session.startLocalTime)));

  const days: WeekDay[] = [];
  for (let date = from; date <= to; date = addLocalDays(date, 1)) {
    const onDay = calendar.filter((item) => item.localDate === date);
    const items: WeekItem[] = [];
    for (const item of onDay) {
      if (item.kind === "calendar") items.push({ kind: "calendar", key: item.key, start: item.start, end: item.end, title: item.title, label: KIND_LABEL[item.occurrence.kind] });
      if (item.kind === "booked") {
        // Logged against this booking: the done session stands in for it.
        const logged = shown.some((session) => session.status === "done" && !session.calendarEventId && session.localDate === date
          && session.discipline === item.discipline && session.startLocalTime?.slice(0, 5) === item.start);
        if (!logged) items.push({ kind: "booked", key: item.key, start: item.start, end: item.end, title: item.title, discipline: item.discipline!, hard: isHard({ discipline: item.discipline!, text: item.title, durationMin: item.endMin - item.startMin }) });
      }
    }
    for (const session of shown.filter((entry) => entry.localDate === date)) {
      const range = timeRange(session);
      let conflict: string | null = null;
      if (session.startLocalTime && session.durationMin && (session.status === "proposed" || session.status === "approved") && ahead(date, session.startLocalTime)) {
        const start = minutesOf(session.startLocalTime), end = start + session.durationMin;
        const clash = onDay.find((item) => item.sessionId !== session.id && start < item.endMin && end > item.startMin);
        if (clash) conflict = `Clashes with ${clash.title} (${clash.start}–${clash.end})`;
      }
      items.push({ kind: "session", key: session.id, start: range ? range.slice(0, 5) : null, end: range ? range.slice(6) : null, session, hard: sessionHard(session), conflict });
    }
    items.sort((a, b) => (a.start ?? "99").localeCompare(b.start ?? "99"));
    const trains = items.some((item) => (item.kind === "booked" && item.discipline !== "mobility")
      || (item.kind === "session" && item.session.status !== "skipped" && item.session.discipline !== "mobility"));
    days.push({ date, past: date < today, today: date === today, rest: !trains, items });
  }

  const warnings: WeekWarning[] = [];
  for (const [first, second] of duplicatePairs(calendar)) {
    const label = DISCIPLINE_LABEL[first.discipline!].toLowerCase();
    warnings.push({
      key: `${first.key}|${second.key}`, date: first.localDate, discipline: first.discipline!, start: first.start, end: clock(Math.max(first.endMin, second.endMin)),
      title: `${first.title} (two entries, ${first.start} and ${second.start})`,
      text: `Looks like one ${label === "running" ? "run" : label + " session"} entered twice. Merge them?`,
      fix: ahead(first.localDate, first.start) ? { first: ref(first.occurrence), second: ref(second.occurrence) } : null,
    });
  }

  const cycle = DISCIPLINES.map((discipline) => {
    let done = 0, planned = 0;
    for (const day of days) for (const item of day.items) {
      if (item.kind === "booked" && item.discipline === discipline) planned += 1;
      if (item.kind === "session" && item.session.discipline === discipline && item.session.status !== "skipped") {
        planned += 1;
        if (item.session.status === "done") done += 1;
      }
    }
    return { discipline, done, planned };
  }).filter((entry) => entry.planned > 0);

  const checkin = getCheckin(db, today);
  const ready = readiness(checkin);
  const waiting = shown.filter((session) => session.status === "proposed").length;
  const note = ready && ready.score <= 50
    ? "Readiness is low today, so AVA keeps the next few days light."
    : "No targets. Sessions are planned with you as the week goes.";
  return { from, to, today, nowMinutes, days, warnings, checkin, readiness: ready, cycle, waiting, note, fetchedAt: now };
}

/** Merges two calendar entries Sir made for one session: the first grows to cover both, the second is cancelled. Only this week's entries change. */
export function mergeEntries(db: Db, first: OccurrenceRef, second: OccurrenceRef, now = Date.now()): void {
  db.transaction(() => {
    const a = getCalendarOccurrence(db, first.occurrenceKey), b = getCalendarOccurrence(db, second.occurrenceKey);
    if (!a || !b || a.cancelled || b.cancelled) throw new TrainingError("not_found", "Those calendar entries have changed. Refresh first.");
    if (a.eventVersion !== first.eventVersion || a.exceptionVersion !== first.exceptionVersion
      || b.eventVersion !== second.eventVersion || b.exceptionVersion !== second.exceptionVersion) {
      throw new TrainingError("stale_version", "Those calendar entries changed since you opened them. Refresh and try again.");
    }
    // Only a pair the week view itself flagged as one session entered twice can be merged.
    const date = a.localStart.slice(0, 10);
    const flagged = duplicatePairs(weekCalendar(db, date, date, sessionsBetween(db, date, date), now))
      .some(([x, y]) => x.key === first.occurrenceKey && y.key === second.occurrenceKey);
    if (!flagged || a.eventId === b.eventId) throw new TrainingError("invalid", "Those entries can't be merged.");
    const span = Math.round((Math.max(a.endsAt, b.endsAt) - a.startsAt) / 60_000);
    try {
      upsertCalendarException(db, a.eventId, a.originalLocalDate, a.eventVersion, a.exceptionVersion, { movedDurationMinutes: span }, now);
      upsertCalendarException(db, b.eventId, b.originalLocalDate, b.eventVersion, b.exceptionVersion, { cancelled: true }, now);
    } catch (error) { calendarFailure(error); }
  }).immediate();
}

// ---- In words, for AVA ----------------------------------------------------------

const STATUS_WORD: Record<SessionStatus, string> = { proposed: "waiting for an OK", approved: "in the calendar", done: "done", skipped: "skipped" };

function sessionLine(session: TrainingSession, withIds: boolean): string {
  const range = timeRange(session);
  const log = session.status === "done"
    ? [session.minutes ? `${session.minutes} min` : "", session.effort ? `effort ${session.effort}` : "", session.sore.length ? `sore: ${session.sore.join(", ")}` : ""].filter(Boolean).join(", ")
    : "";
  return `${range ?? "no time"} ${session.title} [${DISCIPLINE_LABEL[session.discipline]}, ${STATUS_WORD[session.status]}${log ? `; ${log}` : ""}]${withIds ? ` id ${session.id} v${session.version}` : ""}`;
}

/** Training for today or the rest of this week, read just now, in words that work spoken or shown. */
export function trainingBrief(db: Db, range: "today" | "week", opts: { withIds?: boolean; from?: string } = {}, now = Date.now()): string {
  const week = trainingWeek(db, { from: opts.from }, now);
  let days = week.days.filter((day) => range === "today" ? day.today : opts.from ? true : !day.past);
  let waiting = week.waiting, warnings = week.warnings;
  // On a Sunday "this week" is what's left today plus the week ahead.
  const ahead = planningMonday(week.today);
  if (range === "week" && !opts.from && ahead > week.to) {
    const next = trainingWeek(db, { from: ahead }, now);
    days = [...days, ...next.days];
    waiting += next.waiting; warnings = [...warnings, ...next.warnings];
  }
  const lines = days.map((day) => {
    const training = day.items.flatMap((item) => item.kind === "session" ? [sessionLine(item.session, !!opts.withIds)]
      : item.kind === "booked" ? [`${item.start}–${item.end} ${item.title} [${DISCIPLINE_LABEL[item.discipline]}, booked in the calendar]`] : []);
    const other = day.items.filter((item) => item.kind === "calendar").length;
    return `${dayLabel(day.date)}: ${training.length ? training.join("; ") : day.rest ? "rest" : "nothing"}${other ? ` (plus ${other} other calendar ${other === 1 ? "entry" : "entries"})` : ""}`;
  });
  const ready = week.readiness ? `Today's check-in: ${week.readiness.word} (readiness ${week.readiness.score}${week.readiness.detail ? `, ${week.readiness.detail}` : ""}).` : "No check-in today yet.";
  return [
    `Training, read just now (Europe/Dublin), ${dayLabel(days[0]?.date ?? week.from)} to ${dayLabel(days[days.length - 1]?.date ?? week.to)}:`,
    ...lines,
    ready,
    waiting ? `${waiting} proposed ${waiting === 1 ? "session is" : "sessions are"} waiting for an OK. Nothing goes in the calendar until approved.` : "",
    ...warnings.map((warning) => `Calendar check: ${warning.title} on ${dayLabel(warning.date)}. ${warning.text}`),
  ].filter(Boolean).join("\n");
}
