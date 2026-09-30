import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import {
  CALENDAR_ATTENDANCE_INTENTS,
  CALENDAR_ATTENDANCE_OUTCOMES,
  CALENDAR_DST_POLICIES,
  CALENDAR_EVENT_KINDS,
  CALENDAR_RECURRENCE_KINDS,
  CalendarError,
  type CalendarAttendanceIntent,
  type CalendarAttendanceOutcome,
  type CalendarDstPolicy,
  type CalendarEvent,
  type CalendarEventException,
  type CalendarEventKind,
  type CalendarOccurrence,
  type CalendarQueryResult,
  type CalendarRecurrenceKind,
  type CalendarSource,
} from "./types.js";
import {
  DAY_MS,
  addLocalDays,
  formatZonedDateTime,
  localDateDistance,
  normalizeTimeZone,
  parseLocalDate,
  parseLocalTime,
  resolveLocalDateTime,
} from "./time.js";

const MAX_WINDOW_MS = 90 * DAY_MS;
const MAX_OCCURRENCES = 500;
const MAX_RECURRENCE_DAYS = 366;

type EventRow = {
  id: string; title: string; description: string; location: string; kind: CalendarEventKind;
  time_zone: string; anchor_local_date: string; start_local_time: string; duration_minutes: number;
  recurrence_kind: CalendarRecurrenceKind; recurrence_until_date: string | null; dst_policy: CalendarDstPolicy;
  attendance_intent: CalendarAttendanceIntent; notes_folder_id: string | null;
  reminder_minutes_before: number | null; split_from_event_id: string | null; source: CalendarSource;
  source_session_id: string | null; version: number; created_at: number; updated_at: number; archived_at: number | null;
};

type ExceptionRow = {
  event_id: string; occurrence_local_date: string; moved_local_date: string | null; moved_local_time: string | null;
  moved_duration_minutes: number | null; cancelled: number; attendance_intent_override: CalendarAttendanceIntent | null;
  attendance_outcome: CalendarAttendanceOutcome; version: number; created_at: number; updated_at: number;
};

export type CreateCalendarEventInput = {
  title: string;
  description?: string;
  location?: string;
  kind: CalendarEventKind;
  timeZone?: string;
  anchorLocalDate: string;
  startLocalTime: string;
  durationMinutes: number;
  recurrenceKind?: CalendarRecurrenceKind;
  recurrenceUntilDate?: string | null;
  dstPolicy?: CalendarDstPolicy;
  attendanceIntent?: CalendarAttendanceIntent;
  notesFolderId?: string | null;
  reminderMinutesBefore?: number | null;
  splitFromEventId?: string | null;
  source: CalendarSource;
  sourceSessionId?: string | null;
};

export type CalendarEventPatch = Partial<Omit<CreateCalendarEventInput, "source" | "sourceSessionId" | "splitFromEventId">>;

export type CalendarExceptionPatch = {
  movedLocalDate?: string | null;
  movedLocalTime?: string | null;
  movedDurationMinutes?: number | null;
  cancelled?: boolean;
  attendanceIntentOverride?: CalendarAttendanceIntent | null;
  attendanceOutcome?: CalendarAttendanceOutcome;
};

function eventFromRow(row: EventRow): CalendarEvent {
  return {
    id: row.id, title: row.title, description: row.description, location: row.location, kind: row.kind,
    timeZone: row.time_zone, anchorLocalDate: row.anchor_local_date, startLocalTime: row.start_local_time,
    durationMinutes: row.duration_minutes, recurrenceKind: row.recurrence_kind,
    recurrenceUntilDate: row.recurrence_until_date, dstPolicy: row.dst_policy,
    attendanceIntent: row.attendance_intent, notesFolderId: row.notes_folder_id,
    reminderMinutesBefore: row.reminder_minutes_before, splitFromEventId: row.split_from_event_id,
    source: row.source, sourceSessionId: row.source_session_id, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, archivedAt: row.archived_at,
  };
}

function exceptionFromRow(row: ExceptionRow): CalendarEventException {
  return {
    eventId: row.event_id, occurrenceLocalDate: row.occurrence_local_date,
    movedLocalDate: row.moved_local_date, movedLocalTime: row.moved_local_time,
    movedDurationMinutes: row.moved_duration_minutes, cancelled: row.cancelled === 1,
    attendanceIntentOverride: row.attendance_intent_override, attendanceOutcome: row.attendance_outcome,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string") throw new CalendarError("bad_request");
  const clean = value.trim();
  if (clean.length < min || clean.length > max) throw new CalendarError("bad_request");
  return clean;
}

function optionalText(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) throw new CalendarError("bad_request");
  return value.trim();
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new CalendarError("bad_request");
  return value as T;
}

function validateFolder(db: Db, id: string | null): void {
  if (id === null) return;
  if (id.length > 120 || !db.prepare("SELECT 1 FROM note_folders WHERE id=?").get(id)) {
    throw new CalendarError("bad_request");
  }
}

function validateDefinition(db: Db, input: CreateCalendarEventInput): Omit<CreateCalendarEventInput, "timeZone" | "recurrenceKind" | "recurrenceUntilDate" | "dstPolicy" | "attendanceIntent" | "description" | "location" | "notesFolderId" | "reminderMinutesBefore" | "sourceSessionId" | "splitFromEventId"> & {
  description: string; location: string; timeZone: string; recurrenceKind: CalendarRecurrenceKind;
  recurrenceUntilDate: string | null; dstPolicy: CalendarDstPolicy; attendanceIntent: CalendarAttendanceIntent;
  notesFolderId: string | null; reminderMinutesBefore: number | null; sourceSessionId: string | null; splitFromEventId: string | null;
} {
  const title = text(input.title, 1, 160);
  const description = optionalText(input.description, 5_000);
  const location = optionalText(input.location, 500);
  const kind = oneOf(input.kind, CALENDAR_EVENT_KINDS);
  const timeZone = normalizeTimeZone(input.timeZone ?? "Europe/Dublin");
  parseLocalDate(input.anchorLocalDate);
  parseLocalTime(input.startLocalTime);
  if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 10_080) {
    throw new CalendarError("bad_request");
  }
  const recurrenceKind = oneOf(input.recurrenceKind ?? "none", CALENDAR_RECURRENCE_KINDS);
  let recurrenceUntilDate: string | null = input.recurrenceUntilDate ?? null;
  if (recurrenceKind === "weekly") {
    if (!recurrenceUntilDate) throw new CalendarError("bad_request");
    parseLocalDate(recurrenceUntilDate);
    const span = localDateDistance(input.anchorLocalDate, recurrenceUntilDate);
    if (span < 0) throw new CalendarError("bad_request");
    if (span > MAX_RECURRENCE_DAYS) throw new CalendarError("recurrence_too_long");
  } else {
    if (recurrenceUntilDate !== null) throw new CalendarError("bad_request");
    recurrenceUntilDate = null;
  }
  const dstPolicy = oneOf(input.dstPolicy ?? "reject", CALENDAR_DST_POLICIES);
  const attendanceIntent = oneOf(input.attendanceIntent ?? "undecided", CALENDAR_ATTENDANCE_INTENTS);
  const notesFolderId = input.notesFolderId ?? null;
  validateFolder(db, notesFolderId);
  const reminderMinutesBefore = input.reminderMinutesBefore ?? null;
  if (reminderMinutesBefore !== null &&
      (!Number.isSafeInteger(reminderMinutesBefore) || reminderMinutesBefore < 0 || reminderMinutesBefore > 10_080)) {
    throw new CalendarError("bad_request");
  }
  if (!(["manual", "ava_chat", "ava_voice"] as const).includes(input.source)) throw new CalendarError("bad_request");
  const sourceSessionId = input.sourceSessionId ?? null;
  if (sourceSessionId !== null && (typeof sourceSessionId !== "string" || sourceSessionId.length > 160)) {
    throw new CalendarError("bad_request");
  }
  const splitFromEventId = input.splitFromEventId ?? null;
  if (splitFromEventId !== null && (typeof splitFromEventId !== "string" || splitFromEventId.length > 120)) {
    throw new CalendarError("bad_request");
  }
  // Validate every wall-clock occurrence at write time, so a weekly series
  // cannot become invalid only when a later DST boundary is queried.
  const last = recurrenceUntilDate ?? input.anchorLocalDate;
  for (let date = input.anchorLocalDate; date <= last; date = addLocalDays(date, 7)) {
    resolveLocalDateTime(date, input.startLocalTime, timeZone, dstPolicy);
    if (recurrenceKind === "none") break;
  }
  return {
    ...input, title, description, location, kind, timeZone, recurrenceKind, recurrenceUntilDate, dstPolicy,
    attendanceIntent, notesFolderId, reminderMinutesBefore, sourceSessionId, splitFromEventId,
  };
}

export function getCalendarEvent(db: Db, id: string): CalendarEvent | null {
  const row = db.prepare("SELECT * FROM calendar_events WHERE id=?").get(id) as EventRow | undefined;
  return row ? eventFromRow(row) : null;
}

export function getCalendarException(db: Db, eventId: string, originalDate: string): CalendarEventException | null {
  const row = db.prepare("SELECT * FROM calendar_event_exceptions WHERE event_id=? AND occurrence_local_date=?")
    .get(eventId, originalDate) as ExceptionRow | undefined;
  return row ? exceptionFromRow(row) : null;
}

export function listCalendarEvents(db: Db): CalendarEvent[] {
  return (db.prepare("SELECT * FROM calendar_events ORDER BY anchor_local_date,start_local_time,id").all() as EventRow[])
    .map(eventFromRow);
}

export function createCalendarEvent(db: Db, input: CreateCalendarEventInput, now = Date.now()): CalendarEvent {
  const value = validateDefinition(db, input);
  const id = `cal_${nanoid(14)}`;
  db.prepare(`INSERT INTO calendar_events (
    id,title,description,location,kind,time_zone,anchor_local_date,start_local_time,duration_minutes,
    recurrence_kind,recurrence_until_date,dst_policy,attendance_intent,notes_folder_id,reminder_minutes_before,
    split_from_event_id,source,source_session_id,version,created_at,updated_at,archived_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)`).run(
    id, value.title, value.description, value.location, value.kind, value.timeZone, value.anchorLocalDate,
    value.startLocalTime, value.durationMinutes, value.recurrenceKind, value.recurrenceUntilDate, value.dstPolicy,
    value.attendanceIntent, value.notesFolderId, value.reminderMinutesBefore, value.splitFromEventId,
    value.source, value.sourceSessionId, now, now,
  );
  return getCalendarEvent(db, id)!;
}

function definitionInput(event: CalendarEvent, patch: CalendarEventPatch): CreateCalendarEventInput {
  return {
    title: patch.title ?? event.title,
    description: patch.description ?? event.description,
    location: patch.location ?? event.location,
    kind: patch.kind ?? event.kind,
    timeZone: patch.timeZone ?? event.timeZone,
    anchorLocalDate: patch.anchorLocalDate ?? event.anchorLocalDate,
    startLocalTime: patch.startLocalTime ?? event.startLocalTime,
    durationMinutes: patch.durationMinutes ?? event.durationMinutes,
    recurrenceKind: patch.recurrenceKind ?? event.recurrenceKind,
    recurrenceUntilDate: patch.recurrenceUntilDate === undefined ? event.recurrenceUntilDate : patch.recurrenceUntilDate,
    dstPolicy: patch.dstPolicy ?? event.dstPolicy,
    attendanceIntent: patch.attendanceIntent ?? event.attendanceIntent,
    notesFolderId: patch.notesFolderId === undefined ? event.notesFolderId : patch.notesFolderId,
    reminderMinutesBefore: patch.reminderMinutesBefore === undefined ? event.reminderMinutesBefore : patch.reminderMinutesBefore,
    splitFromEventId: event.splitFromEventId,
    source: event.source,
    sourceSessionId: event.sourceSessionId,
  };
}

const HISTORICAL_PATCH_KEYS = new Set<keyof CalendarEventPatch>([
  "title", "description", "location", "kind", "timeZone", "anchorLocalDate", "startLocalTime",
  "durationMinutes", "recurrenceKind", "recurrenceUntilDate", "dstPolicy", "attendanceIntent", "notesFolderId",
]);

function guardedEvent(db: Db, id: string, expectedVersion: number, allowArchived = false): CalendarEvent {
  const event = getCalendarEvent(db, id);
  if (!event) throw new CalendarError("not_found");
  if (event.version !== expectedVersion) throw new CalendarError("stale_version");
  if (!allowArchived && event.archivedAt !== null) throw new CalendarError("archived");
  return event;
}

function originalDates(event: CalendarEvent, until = event.recurrenceUntilDate ?? event.anchorLocalDate): string[] {
  const dates: string[] = [];
  for (let date = event.anchorLocalDate; date <= until; date = addLocalDays(date, 7)) {
    dates.push(date);
    if (event.recurrenceKind === "none") break;
  }
  return dates;
}

function historyEvidence(event: CalendarEvent, date: string, exception: CalendarEventException | null, now: number): boolean {
  if (exception && exception.attendanceOutcome !== "unknown") return true;
  if (exception?.cancelled) return false;
  const original = resolveLocalDateTime(date, event.startLocalTime, event.timeZone, event.dstPolicy);
  return original <= now || projectOccurrence(event, date, exception).startsAt <= now;
}

function hasHistory(db: Db, event: CalendarEvent, now: number, dates = originalDates(event)): boolean {
  return dates.some((date) => historyEvidence(event, date, getCalendarException(db, event.id, date), now));
}

function normalizedDefinitionPatch(db: Db, current: CalendarEvent, patch: CalendarEventPatch): CalendarEventPatch {
  const value = validateDefinition(db, definitionInput(current, patch));
  return Object.fromEntries(Object.keys(patch)
    .filter((key) => value[key as keyof CalendarEventPatch] !== current[key as keyof CalendarEventPatch])
    .map((key) => [key, value[key as keyof CalendarEventPatch]])) as CalendarEventPatch;
}

export function updateCalendarEvent(
  db: Db, id: string, expectedVersion: number, patch: CalendarEventPatch, now = Date.now(),
): CalendarEvent {
  return db.transaction(() => {
    const current = guardedEvent(db, id, expectedVersion);
    const changes = normalizedDefinitionPatch(db, current, patch);
    if (!Object.keys(changes).length) return current;
    if (Object.keys(changes).some((key) => HISTORICAL_PATCH_KEYS.has(key as keyof CalendarEventPatch)) && hasHistory(db, current, now)) {
      // Once history exists, semantic edits must use an occurrence exception or
      // this-and-following split; otherwise earlier projections would be rewritten.
      throw new CalendarError("series_started");
    }
    const value = validateDefinition(db, definitionInput(current, changes));
    const result = db.prepare(`UPDATE calendar_events SET
      title=?,description=?,location=?,kind=?,time_zone=?,anchor_local_date=?,start_local_time=?,duration_minutes=?,
      recurrence_kind=?,recurrence_until_date=?,dst_policy=?,attendance_intent=?,notes_folder_id=?,reminder_minutes_before=?,
      version=version+1,updated_at=? WHERE id=? AND version=?`).run(
      value.title, value.description, value.location, value.kind, value.timeZone, value.anchorLocalDate,
      value.startLocalTime, value.durationMinutes, value.recurrenceKind, value.recurrenceUntilDate, value.dstPolicy,
      value.attendanceIntent, value.notesFolderId, value.reminderMinutesBefore, now, id, expectedVersion,
    );
    if (result.changes !== 1) throw new CalendarError("stale_version");
    return getCalendarEvent(db, id)!;
  }).immediate();
}

export function archiveCalendarEvent(db: Db, id: string, expectedVersion: number, now = Date.now(), includeHistory = false): CalendarEvent {
  return db.transaction(() => {
    const current = guardedEvent(db, id, expectedVersion, true);
    if (current.archivedAt !== null) return current;
    if (!includeHistory && hasHistory(db, current, now)) throw new CalendarError("series_started");
    const result = db.prepare(`UPDATE calendar_events
      SET archived_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?`).run(now, now, id, expectedVersion);
    if (result.changes !== 1) throw new CalendarError("stale_version");
    return getCalendarEvent(db, id)!;
  }).immediate();
}

export function restoreCalendarEvent(db: Db, id: string, expectedVersion: number, now = Date.now()): { event: CalendarEvent } {
  return db.transaction(() => {
    const current = guardedEvent(db, id, expectedVersion, true);
    if (current.archivedAt === null) throw new CalendarError("not_archived");
    const result = db.prepare(`UPDATE calendar_events SET archived_at=NULL,updated_at=?,version=version+1
      WHERE id=? AND version=?`).run(now, id, expectedVersion);
    if (result.changes !== 1) throw new CalendarError("stale_version");
    return { event: getCalendarEvent(db, id)! };
  }).immediate();
}

export function endCalendarSeries(db: Db, id: string, expectedVersion: number, fromOriginalDate: string, now = Date.now()): {
  event: CalendarEvent; endedFromOriginalDate: string; previousRecurrenceUntilDate: string;
} {
  return db.transaction(() => {
    const current = guardedEvent(db, id, expectedVersion);
    if (current.recurrenceKind !== "weekly") throw new CalendarError("not_weekly");
    if (!occurrenceBelongs(current, fromOriginalDate) || fromOriginalDate === current.anchorLocalDate) {
      throw new CalendarError("occurrence_not_found");
    }
    if (resolveLocalDateTime(fromOriginalDate, current.startLocalTime, current.timeZone, current.dstPolicy) <= now) {
      throw new CalendarError("occurrence_started");
    }
    if (hasHistory(db, current, now, originalDates(current).filter((date) => date >= fromOriginalDate))) {
      throw new CalendarError("history_conflict");
    }
    const result = db.prepare(`UPDATE calendar_events SET recurrence_until_date=?,updated_at=?,version=version+1
      WHERE id=? AND version=?`).run(addLocalDays(fromOriginalDate, -7), now, id, expectedVersion);
    if (result.changes !== 1) throw new CalendarError("stale_version");
    return { event: getCalendarEvent(db, id)!, endedFromOriginalDate: fromOriginalDate,
      previousRecurrenceUntilDate: current.recurrenceUntilDate! };
  }).immediate();
}

export function extendCalendarSeries(db: Db, id: string, expectedVersion: number, recurrenceUntilDate: string, now = Date.now()): {
  event: CalendarEvent; previousRecurrenceUntilDate: string;
} {
  return db.transaction(() => {
    const current = guardedEvent(db, id, expectedVersion);
    if (current.recurrenceKind !== "weekly") throw new CalendarError("not_weekly");
    parseLocalDate(recurrenceUntilDate);
    if (recurrenceUntilDate <= current.recurrenceUntilDate!) throw new CalendarError("no_occurrence_added");
    validateDefinition(db, definitionInput(current, { recurrenceUntilDate }));
    const dates = originalDates(current, recurrenceUntilDate).filter((date) => date > current.recurrenceUntilDate!);
    if (!dates.length) throw new CalendarError("no_occurrence_added");
    for (const date of dates) {
      const exception = getCalendarException(db, id, date);
      if (resolveLocalDateTime(date, current.startLocalTime, current.timeZone, current.dstPolicy) <= now ||
          projectOccurrence(current, date, exception).startsAt <= now ||
          exception && exception.attendanceOutcome !== "unknown") throw new CalendarError("history_conflict");
    }
    const result = db.prepare(`UPDATE calendar_events SET recurrence_until_date=?,updated_at=?,version=version+1
      WHERE id=? AND version=?`).run(recurrenceUntilDate, now, id, expectedVersion);
    if (result.changes !== 1) throw new CalendarError("stale_version");
    return { event: getCalendarEvent(db, id)!, previousRecurrenceUntilDate: current.recurrenceUntilDate! };
  }).immediate();
}

export function occurrenceBelongs(event: CalendarEvent, originalDate: string): boolean {
  parseLocalDate(originalDate);
  const distance = localDateDistance(event.anchorLocalDate, originalDate);
  if (event.recurrenceKind === "none") return distance === 0;
  return distance >= 0 && distance % 7 === 0 && originalDate <= (event.recurrenceUntilDate ?? event.anchorLocalDate);
}

export function upsertCalendarException(
  db: Db,
  eventId: string,
  originalDate: string,
  expectedEventVersion: number,
  expectedExceptionVersion: number | null,
  patch: CalendarExceptionPatch,
  now = Date.now(),
): CalendarEventException | null {
  return db.transaction(() => {
    const event = guardedEvent(db, eventId, expectedEventVersion);
    if (!occurrenceBelongs(event, originalDate)) throw new CalendarError("occurrence_not_found");
    const current = getCalendarException(db, eventId, originalDate);
    if (current ? current.version !== expectedExceptionVersion : expectedExceptionVersion !== null && expectedExceptionVersion !== 0) {
      throw new CalendarError("stale_version");
    }
    const movedLocalDate = patch.movedLocalDate === undefined ? current?.movedLocalDate ?? null : patch.movedLocalDate;
    const movedLocalTime = patch.movedLocalTime === undefined ? current?.movedLocalTime ?? null : patch.movedLocalTime;
    const movedDurationMinutes = patch.movedDurationMinutes === undefined
      ? current?.movedDurationMinutes ?? null : patch.movedDurationMinutes;
    const cancelled = patch.cancelled ?? current?.cancelled ?? false;
    let attendanceIntentOverride = patch.attendanceIntentOverride === undefined
      ? current?.attendanceIntentOverride ?? null : patch.attendanceIntentOverride;
    const attendanceOutcome = patch.attendanceOutcome ?? current?.attendanceOutcome ?? "unknown";
    if (movedLocalDate !== null) parseLocalDate(movedLocalDate);
    if (movedLocalTime !== null) parseLocalTime(movedLocalTime);
    if (movedDurationMinutes !== null &&
        (!Number.isSafeInteger(movedDurationMinutes) || movedDurationMinutes < 1 || movedDurationMinutes > 10_080)) {
      throw new CalendarError("bad_request");
    }
    if (attendanceIntentOverride !== null) oneOf(attendanceIntentOverride, CALENDAR_ATTENDANCE_INTENTS);
    if (typeof cancelled !== "boolean") throw new CalendarError("bad_request");
    oneOf(attendanceOutcome, CALENDAR_ATTENDANCE_OUTCOMES);
    resolveLocalDateTime(movedLocalDate ?? originalDate, movedLocalTime ?? event.startLocalTime, event.timeZone, event.dstPolicy);
    // An echoed effective intent must not pin an inherited value. An explicit
    // null still clears a real override, even when it equals the series value.
    if (attendanceIntentOverride !== null && attendanceIntentOverride === (current?.attendanceIntentOverride ?? event.attendanceIntent)) {
      attendanceIntentOverride = current?.attendanceIntentOverride ?? null;
    }
    const before = { movedLocalDate: current?.movedLocalDate ?? null, movedLocalTime: current?.movedLocalTime ?? null,
      movedDurationMinutes: current?.movedDurationMinutes ?? null, cancelled: current?.cancelled ?? false,
      attendanceIntentOverride: current?.attendanceIntentOverride ?? null, attendanceOutcome: current?.attendanceOutcome ?? "unknown" };
    const candidate = { movedLocalDate, movedLocalTime, movedDurationMinutes, cancelled, attendanceIntentOverride, attendanceOutcome };
    const changes = (Object.keys(candidate) as Array<keyof typeof candidate>).filter((key) => candidate[key] !== before[key]);
    if (!changes.length) return current;
    const scheduleChanged = changes.some((key) => ["movedLocalDate", "movedLocalTime", "movedDurationMinutes", "cancelled"].includes(key));
    if (scheduleChanged && historyEvidence(event, originalDate, current, now)) throw new CalendarError("occurrence_started");
    // A previously cancelled past occurrence cannot be reintroduced as history.
    if (scheduleChanged && before.cancelled && !cancelled &&
        resolveLocalDateTime(originalDate, event.startLocalTime, event.timeZone, event.dstPolicy) <= now) {
      throw new CalendarError("occurrence_started");
    }
    if (current) {
      const result = db.prepare(`UPDATE calendar_event_exceptions SET
        moved_local_date=?,moved_local_time=?,moved_duration_minutes=?,cancelled=?,attendance_intent_override=?,
        attendance_outcome=?,version=version+1,updated_at=?
        WHERE event_id=? AND occurrence_local_date=? AND version=?`).run(
        movedLocalDate, movedLocalTime, movedDurationMinutes, cancelled ? 1 : 0, attendanceIntentOverride,
        attendanceOutcome, now, eventId, originalDate, current.version,
      );
      if (result.changes !== 1) throw new CalendarError("stale_version");
    } else {
      db.prepare(`INSERT INTO calendar_event_exceptions (
        event_id,occurrence_local_date,moved_local_date,moved_local_time,moved_duration_minutes,cancelled,
        attendance_intent_override,attendance_outcome,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,1,?,?)`).run(
        eventId, originalDate, movedLocalDate, movedLocalTime, movedDurationMinutes, cancelled ? 1 : 0,
        attendanceIntentOverride, attendanceOutcome, now, now,
      );
    }
    return getCalendarException(db, eventId, originalDate)!;
  }).immediate();
}

function projectOccurrence(event: CalendarEvent, originalDate: string, exception: CalendarEventException | null): CalendarOccurrence {
  const actualDate = exception?.movedLocalDate ?? originalDate;
  const actualTime = exception?.movedLocalTime ?? event.startLocalTime;
  const startsAt = resolveLocalDateTime(actualDate, actualTime, event.timeZone, event.dstPolicy);
  const endsAt = startsAt + (exception?.movedDurationMinutes ?? event.durationMinutes) * 60_000;
  return {
    eventId: event.id, occurrenceKey: `${event.id}:${originalDate}`, originalLocalDate: originalDate,
    localStart: formatZonedDateTime(startsAt, event.timeZone), localEnd: formatZonedDateTime(endsAt, event.timeZone),
    startsAt, endsAt, timeZone: event.timeZone, title: event.title, description: event.description,
    location: event.location, kind: event.kind,
    attendanceIntent: exception?.attendanceIntentOverride ?? event.attendanceIntent,
    attendanceOutcome: exception?.attendanceOutcome ?? "unknown", notesFolderId: event.notesFolderId,
    eventVersion: event.version, exceptionVersion: exception?.version ?? null,
    cancelled: exception?.cancelled ?? false,
    moved: !!(exception?.movedLocalDate || exception?.movedLocalTime || exception?.movedDurationMinutes), reminder: null,
  };
}

/** Exact source lookup, sharing the same occurrence projection as Calendar. */
export function getCalendarOccurrence(db: Db, key: string): CalendarOccurrence | null {
  const match = /^([A-Za-z0-9_-]{1,128}):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!match) return null;
  try {
    const event = getCalendarEvent(db, match[1]!);
    if (!event || event.archivedAt !== null || !occurrenceBelongs(event, match[2]!)) return null;
    return projectOccurrence(event, match[2]!, getCalendarException(db, event.id, match[2]!));
  } catch (error) { if (error instanceof CalendarError) return null; throw error; }
}

export function queryCalendar(
  db: Db, from: number, to: number, displayTimeZone = "Europe/Dublin", fetchedAt = Date.now(),
): CalendarQueryResult {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to || to - from > MAX_WINDOW_MS) {
    throw new CalendarError("invalid_range");
  }
  const timeZone = normalizeTimeZone(displayTimeZone);
  const events = listCalendarEvents(db);
  const exceptionRows = db.prepare("SELECT * FROM calendar_event_exceptions ORDER BY event_id,occurrence_local_date").all() as ExceptionRow[];
  const byEvent = new Map<string, Map<string, CalendarEventException>>();
  for (const row of exceptionRows) {
    const exception = exceptionFromRow(row);
    let map = byEvent.get(exception.eventId);
    if (!map) { map = new Map(); byEvent.set(exception.eventId, map); }
    map.set(exception.occurrenceLocalDate, exception);
  }
  const occurrences: CalendarOccurrence[] = [];
  const included = new Map<string, CalendarEvent>();
  for (const event of events) {
    if (event.archivedAt !== null) continue;
    const last = event.recurrenceKind === "weekly" ? event.recurrenceUntilDate! : event.anchorLocalDate;
    for (let date = event.anchorLocalDate; date <= last; date = addLocalDays(date, 7)) {
      const exception = byEvent.get(event.id)?.get(date) ?? null;
      const occurrence = projectOccurrence(event, date, exception);
      const referenceStart = occurrence.startsAt;
      if (referenceStart < to && occurrence.endsAt > from) {
        occurrences.push(occurrence);
        included.set(event.id, event);
        if (occurrences.length > MAX_OCCURRENCES) throw new CalendarError("invalid_range");
      }
      if (event.recurrenceKind === "none") break;
    }
  }
  occurrences.sort((a, b) => a.startsAt - b.startsAt || a.occurrenceKey.localeCompare(b.occurrenceKey));
  return {
    fetchedAt,
    window: { from, to, timeZone },
    events: [...included.values()].sort((a, b) => a.anchorLocalDate.localeCompare(b.anchorLocalDate) || a.id.localeCompare(b.id)),
    occurrences,
    complete: true,
  };
}

export function splitCalendarEvent(
  db: Db,
  id: string,
  expectedVersion: number,
  splitOriginalDate: string,
  patch: CalendarEventPatch,
  now = Date.now(),
): { previous: CalendarEvent; next: CalendarEvent; changed: true } {
  const transaction = db.transaction(() => {
    const current = guardedEvent(db, id, expectedVersion);
    if (current.recurrenceKind !== "weekly") throw new CalendarError("not_weekly");
    if (!occurrenceBelongs(current, splitOriginalDate) ||
        splitOriginalDate === current.anchorLocalDate) throw new CalendarError("occurrence_not_found");
    const changes = normalizedDefinitionPatch(db, current, patch);
    if (changes.anchorLocalDate !== undefined || changes.recurrenceKind !== undefined) throw new CalendarError("field_not_in_scope");
    if (!Object.keys(changes).length) throw new CalendarError("bad_request");
    const splitStart = resolveLocalDateTime(splitOriginalDate, current.startLocalTime, current.timeZone, current.dstPolicy);
    if (splitStart <= now) throw new CalendarError("occurrence_started");
    if (hasHistory(db, current, now, originalDates(current).filter((date) => date >= splitOriginalDate))) {
      throw new CalendarError("history_conflict");
    }
    const nextInput = definitionInput(current, {
      ...changes,
      anchorLocalDate: splitOriginalDate,
      recurrenceKind: "weekly",
      recurrenceUntilDate: changes.recurrenceUntilDate === undefined ? current.recurrenceUntilDate : changes.recurrenceUntilDate,
    });
    nextInput.splitFromEventId = current.id;
    const validatedNext = validateDefinition(db, nextInput);
    const previousUntil = addLocalDays(splitOriginalDate, -7);
    const update = db.prepare(`UPDATE calendar_events
      SET recurrence_until_date=?,version=version+1,updated_at=? WHERE id=? AND version=?`)
      .run(previousUntil, now, id, expectedVersion);
    if (update.changes !== 1) throw new CalendarError("stale_version");
    const next = createCalendarEvent(db, validatedNext, now);
    // Future occurrence overrides belong to the new definition after a split.
    // Their original local dates and row history remain unchanged.
    db.prepare(`UPDATE calendar_event_exceptions SET event_id=?
      WHERE event_id=? AND occurrence_local_date>=?`).run(next.id, id, splitOriginalDate);
    return { previous: getCalendarEvent(db, id)!, next, changed: true as const };
  });
  return transaction.immediate();
}
