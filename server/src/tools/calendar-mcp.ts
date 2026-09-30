import type { Db } from "../state/db.js";
import type { ToolDef } from "./ava-mcp.js";
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
  type CalendarEventKind,
  type CalendarRecurrenceKind,
  type CalendarSource,
} from "../calendar/types.js";
import {
  archiveCalendarEvent,
  createCalendarEvent,
  endCalendarSeries,
  getCalendarEvent,
  queryCalendar,
  splitCalendarEvent,
  updateCalendarEvent,
  upsertCalendarException,
  type CalendarEventPatch,
  type CalendarExceptionPatch,
} from "../calendar/service.js";
import { addLocalDays, localDayWindow, normalizeTimeZone } from "../calendar/time.js";

function enumValue<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === "string" && values.includes(value as T) ? value as T : undefined;
}

function finiteInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function patchFromArgs(args: Record<string, unknown>): CalendarEventPatch {
  const patch: CalendarEventPatch = {};
  if (typeof args.title === "string") patch.title = args.title;
  if (typeof args.description === "string") patch.description = args.description;
  if (typeof args.location === "string") patch.location = args.location;
  const kind = enumValue(args.kind, CALENDAR_EVENT_KINDS); if (kind) patch.kind = kind as CalendarEventKind;
  if (typeof args.time_zone === "string") patch.timeZone = args.time_zone;
  if (typeof args.anchor_local_date === "string") patch.anchorLocalDate = args.anchor_local_date;
  if (typeof args.start_local_time === "string") patch.startLocalTime = args.start_local_time;
  const duration = finiteInt(args.duration_minutes); if (duration !== undefined) patch.durationMinutes = duration;
  const recurrence = enumValue(args.recurrence_kind, CALENDAR_RECURRENCE_KINDS);
  if (recurrence) patch.recurrenceKind = recurrence as CalendarRecurrenceKind;
  const until = nullableString(args.recurrence_until_date); if (until !== undefined) patch.recurrenceUntilDate = until;
  const policy = enumValue(args.dst_policy, CALENDAR_DST_POLICIES); if (policy) patch.dstPolicy = policy as CalendarDstPolicy;
  const intent = enumValue(args.attendance_intent, CALENDAR_ATTENDANCE_INTENTS);
  if (intent) patch.attendanceIntent = intent as CalendarAttendanceIntent;
  const folder = nullableString(args.notes_folder_id); if (folder !== undefined) patch.notesFolderId = folder;
  if (args.reminder_minutes_before === null) patch.reminderMinutesBefore = null;
  else {
    const reminder = finiteInt(args.reminder_minutes_before);
    if (reminder !== undefined) patch.reminderMinutesBefore = reminder;
  }
  return patch;
}

function exceptionPatchFromArgs(args: Record<string, unknown>): CalendarExceptionPatch {
  const patch: CalendarExceptionPatch = {};
  const movedDate = nullableString(args.moved_local_date); if (movedDate !== undefined) patch.movedLocalDate = movedDate;
  const movedTime = nullableString(args.moved_local_time); if (movedTime !== undefined) patch.movedLocalTime = movedTime;
  if (args.moved_duration_minutes === null) patch.movedDurationMinutes = null;
  else {
    const movedDuration = finiteInt(args.moved_duration_minutes);
    if (movedDuration !== undefined) patch.movedDurationMinutes = movedDuration;
  }
  if (typeof args.cancelled === "boolean") patch.cancelled = args.cancelled;
  if (args.attendance_intent === null) patch.attendanceIntentOverride = null;
  else {
    const intent = enumValue(args.attendance_intent, CALENDAR_ATTENDANCE_INTENTS);
    if (intent) patch.attendanceIntentOverride = intent as CalendarAttendanceIntent;
  }
  const outcome = enumValue(args.attendance_outcome, CALENDAR_ATTENDANCE_OUTCOMES);
  if (outcome) patch.attendanceOutcome = outcome as CalendarAttendanceOutcome;
  return patch;
}

const NOTHING_CHANGED = "Nothing changed; the calendar already matches.";
const NO_REPEAT = "Do not repeat the same call.";
// One sentence naming the correct next call, so a refusal is recovered in one round.
const RECOVERY: Record<string, string> = {
  bad_request: "Check the arguments against the tool description.",
  not_found: "That event no longer exists; call calendar_query for the current list.",
  stale_version: "The event changed; call calendar_query again and use its current version.",
  invalid_range: "Ask for a window of at most 90 days.",
  invalid_timezone: "Use a valid named IANA time zone, such as Europe/Dublin.",
  nonexistent_local_time: "That local time does not exist because the clocks change; choose another time.",
  ambiguous_local_time: "That local time occurs twice; choose another time or set dst_policy to earlier or later.",
  recurrence_too_long: "End the weekly series within one year of its first date.",
  occurrence_not_found: "Call calendar_query and use an exact original_local_date of that series.",
  series_started: "This series already has history, so its past can't change. To stop it, call calendar_end_series from a future occurrence; to change future ones, use scope 'following'; to remove a duplicate or mistake, call calendar_remove.",
  occurrence_started: "That occurrence has already started, so its schedule can't change; pick a later occurrence.",
  history_conflict: "That would hide or bring back an occurrence that already happened or was recorded; choose a later occurrence.",
  cancel_scope_unsupported: "To cancel one occurrence use scope 'occurrence'; to stop the series call calendar_end_series; to remove the whole thing call calendar_remove.",
  field_not_in_scope: "moved_local_date, moved_local_time and moved_duration_minutes only apply to scope 'occurrence'; leave them out for series or following.",
  not_weekly: "Only a weekly series can be ended; use calendar_remove to remove a one-off event.",
  archived: "That event was removed; ask Sir before doing anything else with it.",
  not_archived: "That event isn't removed.",
  no_occurrence_added: "That end date adds no weekly occurrences; choose a later date.",
};
function errorText(error: unknown): string {
  if (!(error instanceof CalendarError)) return `calendar request failed. ${NO_REPEAT}`;
  return `${error.code}: ${RECOVERY[error.code] ?? error.message} ${NO_REPEAT}`;
}
const badRequest = (detail: string) => ({ ok: false as const, text: `bad_request: ${detail} ${NO_REPEAT}` });

/** v3 guards run before any refusal or no-op, so a stale echo can never look like success. */
function guardEvent(db: Db, id: string, expected: number) {
  const event = getCalendarEvent(db, id);
  if (!event) throw new CalendarError("not_found");
  if (event.version !== expected) throw new CalendarError("stale_version");
  if (event.archivedAt !== null) throw new CalendarError("archived");
}
/** Occurrence-only fields with a real value can't ride along a series or following update. */
function refuseOutOfScope(args: Record<string, unknown>): CalendarError | null {
  if (args.cancelled === true) return new CalendarError("cancel_scope_unsupported");
  if (args.moved_local_date != null || args.moved_local_time != null || args.moved_duration_minutes != null) {
    return new CalendarError("field_not_in_scope");
  }
  return null;
}
const unchanged = (extra: Record<string, unknown>) => JSON.stringify({ changed: false, ...extra, message: NOTHING_CHANGED });

const commonProperties = {
  title: { type: "string", maxLength: 160 },
  description: { type: "string", maxLength: 5_000 },
  location: { type: "string", maxLength: 500 },
  kind: { type: "string", enum: CALENDAR_EVENT_KINDS },
  time_zone: { type: "string", description: "Named IANA zone; default Europe/Dublin." },
  anchor_local_date: { type: "string", description: "YYYY-MM-DD." },
  start_local_time: { type: "string", description: "HH:mm:ss local wall time." },
  duration_minutes: { type: "integer", minimum: 1, maximum: 10_080 },
  recurrence_kind: { type: "string", enum: CALENDAR_RECURRENCE_KINDS },
  recurrence_until_date: { type: ["string", "null"], description: "Required for weekly; at most one year." },
  dst_policy: { type: "string", enum: CALENDAR_DST_POLICIES },
  attendance_intent: { type: "string", enum: CALENDAR_ATTENDANCE_INTENTS },
  notes_folder_id: { type: ["string", "null"] },
  reminder_minutes_before: { type: ["integer", "null"], minimum: 0, maximum: 10_080 },
} as const;

export function buildCalendarTools(options: {
  db: Db;
  sessionId?: string | null;
  source?: Extract<CalendarSource, "ava_chat" | "ava_voice">;
  now?: () => number;
}): ToolDef[] {
  const now = options.now ?? Date.now;
  const source = options.source ?? "ava_chat";
  return [
    {
      tool: {
        name: "calendar_query",
        description: "Read Sir's authoritative AVA calendar for a day, week or bounded epoch range. Use before updates so stable IDs and current versions are available.",
        inputSchema: {
          type: "object",
          properties: {
            local_date: { type: "string", description: "YYYY-MM-DD for a day/week query." },
            view: { type: "string", enum: ["day", "week", "range"] },
            from: { type: "integer", description: "Range start epoch ms." },
            to: { type: "integer", description: "Range end epoch ms, at most 90 days later." },
            time_zone: { type: "string", description: "Display/query zone; defaults Europe/Dublin." },
          },
        },
      },
      run: async (args) => {
        try {
          const timeZone = normalizeTimeZone(typeof args.time_zone === "string" ? args.time_zone : "Europe/Dublin");
          let from = finiteInt(args.from), to = finiteInt(args.to);
          const view = args.view === "range" || args.view === "week" || args.view === "day"
            ? args.view
            : from !== undefined && to !== undefined ? "range" : "day";
          if (view !== "range") {
            if (typeof args.local_date !== "string") return { ok: false, text: "local_date is required for day/week" };
            const first = localDayWindow(args.local_date, timeZone);
            from = first.from;
            to = view === "week"
              ? localDayWindow(addLocalDays(args.local_date, 7), timeZone).from
              : first.to;
          }
          if (from === undefined || to === undefined) return { ok: false, text: "from and to are required for range" };
          const result = queryCalendar(options.db, from, to, timeZone, now());
          return { ok: true, text: JSON.stringify(result) };
        } catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
    {
      tool: {
        name: "calendar_add",
        description: "Add one explicit calendar event or one bounded weekly series. Never fabricate lecture times; use the date, time, zone and term end Sir supplied or confirmed.",
        inputSchema: {
          type: "object",
          properties: commonProperties,
          required: ["title", "kind", "anchor_local_date", "start_local_time", "duration_minutes"],
        },
      },
      run: async (args) => {
        try {
          const event = createCalendarEvent(options.db, {
            title: String(args.title ?? ""),
            description: typeof args.description === "string" ? args.description : "",
            location: typeof args.location === "string" ? args.location : "",
            kind: enumValue(args.kind, CALENDAR_EVENT_KINDS) as CalendarEventKind,
            timeZone: typeof args.time_zone === "string" ? args.time_zone : "Europe/Dublin",
            anchorLocalDate: String(args.anchor_local_date ?? ""),
            startLocalTime: String(args.start_local_time ?? ""),
            durationMinutes: Number(args.duration_minutes),
            recurrenceKind: enumValue(args.recurrence_kind, CALENDAR_RECURRENCE_KINDS),
            recurrenceUntilDate: nullableString(args.recurrence_until_date),
            dstPolicy: enumValue(args.dst_policy, CALENDAR_DST_POLICIES),
            attendanceIntent: enumValue(args.attendance_intent, CALENDAR_ATTENDANCE_INTENTS),
            notesFolderId: nullableString(args.notes_folder_id),
            reminderMinutesBefore: args.reminder_minutes_before === null ? null : finiteInt(args.reminder_minutes_before),
            source,
            sourceSessionId: options.sessionId ?? null,
          }, now());
          return { ok: true, text: `Added to Calendar.\n${JSON.stringify(event)}` };
        } catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
    {
      tool: {
        name: "calendar_update",
        description: "Update a future series, one occurrence, or this-and-following. Query first and pass exact event/occurrence IDs and versions; no fuzzy title matching. cancelled and moved_* apply only to scope 'occurrence'. To stop a series use calendar_end_series; to remove a duplicate use calendar_remove.",
        inputSchema: {
          type: "object",
          properties: {
            event_id: { type: "string" },
            scope: { type: "string", enum: ["series", "occurrence", "following"] },
            expected_version: { type: "integer", minimum: 1 },
            original_local_date: { type: "string" },
            expected_exception_version: { type: ["integer", "null"], minimum: 0 },
            moved_local_date: { type: ["string", "null"] },
            moved_local_time: { type: ["string", "null"] },
            moved_duration_minutes: { type: ["integer", "null"], minimum: 1, maximum: 10_080 },
            cancelled: { type: "boolean" },
            ...commonProperties,
          },
          required: ["event_id", "scope", "expected_version"],
        },
      },
      run: async (args) => {
        const id = typeof args.event_id === "string" ? args.event_id : "";
        const expected = finiteInt(args.expected_version);
        if (!id || expected === undefined) return badRequest("event_id and expected_version are required.");
        try {
          if (args.scope === "series" || args.scope === "following") {
            guardEvent(options.db, id, expected);
            const refusal = refuseOutOfScope(args);
            if (refusal) throw refusal;
          }
          if (args.scope === "series") {
            const event = updateCalendarEvent(options.db, id, expected, patchFromArgs(args), now());
            return { ok: true, text: event.version === expected ? unchanged({ event }) : JSON.stringify({ changed: true, event }) };
          }
          if (typeof args.original_local_date !== "string") return badRequest("original_local_date is required.");
          if (args.scope === "following") {
            const result = splitCalendarEvent(options.db, id, expected, args.original_local_date, patchFromArgs(args), now());
            return { ok: true, text: JSON.stringify(result) };
          }
          if (args.scope !== "occurrence") return badRequest("scope must be series, occurrence or following.");
          const expectedException = args.expected_exception_version === null ? null : finiteInt(args.expected_exception_version) ?? null;
          const exception = upsertCalendarException(
            options.db, id, args.original_local_date, expected, expectedException, exceptionPatchFromArgs(args), now(),
          );
          const changed = (exception?.version ?? 0) !== (expectedException ?? 0);
          return { ok: true, text: changed ? JSON.stringify({ changed: true, exception }) : unchanged({ exception }) };
        } catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
    {
      tool: {
        name: "calendar_set_attendance",
        description: "Set planned attendance for a series or one occurrence, or record an explicit attended/skipped/missed outcome. AVA never infers missed from time passing.",
        inputSchema: {
          type: "object",
          properties: {
            event_id: { type: "string" }, scope: { type: "string", enum: ["series", "occurrence"] },
            expected_version: { type: "integer", minimum: 1 }, original_local_date: { type: "string" },
            expected_exception_version: { type: ["integer", "null"], minimum: 0 },
            attendance_intent: { type: ["string", "null"], enum: [...CALENDAR_ATTENDANCE_INTENTS, null] },
            attendance_outcome: { type: "string", enum: CALENDAR_ATTENDANCE_OUTCOMES },
          },
          required: ["event_id", "scope", "expected_version"],
        },
      },
      run: async (args) => {
        const id = typeof args.event_id === "string" ? args.event_id : "";
        const expected = finiteInt(args.expected_version);
        if (!id || expected === undefined) return badRequest("event_id and expected_version are required.");
        try {
          if (args.scope === "series") {
            const intent = enumValue(args.attendance_intent, CALENDAR_ATTENDANCE_INTENTS);
            if (!intent) return badRequest("attendance_intent is required for a series.");
            const event = updateCalendarEvent(options.db, id, expected, { attendanceIntent: intent }, now());
            return { ok: true, text: event.version === expected ? unchanged({ event }) : JSON.stringify({ changed: true, event }) };
          }
          if (args.scope !== "occurrence" || typeof args.original_local_date !== "string") {
            return badRequest("original_local_date is required for an occurrence.");
          }
          const expectedException = args.expected_exception_version === null ? null : finiteInt(args.expected_exception_version) ?? null;
          const exception = upsertCalendarException(
            options.db, id, args.original_local_date, expected, expectedException,
            exceptionPatchFromArgs(args), now(),
          );
          const changed = (exception?.version ?? 0) !== (expectedException ?? 0);
          return { ok: true, text: changed ? JSON.stringify({ changed: true, exception }) : unchanged({ exception }) };
        } catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
    {
      tool: {
        name: "calendar_end_series",
        description: "Stop a weekly series from one future occurrence onward while keeping everything before it and anything recorded. Use this when Sir is done with a real series. Query first and pass the exact event id, its current version and the original date of the first occurrence to drop. It is versioned and can be undone in the Calendar screen; you cannot undo it yourself, so say only what was done.",
        inputSchema: {
          type: "object",
          properties: {
            event_id: { type: "string" }, expected_version: { type: "integer", minimum: 1 },
            from_original_date: { type: "string", description: "YYYY-MM-DD: the first occurrence that no longer happens." },
          },
          required: ["event_id", "expected_version", "from_original_date"],
        },
      },
      run: async (args) => {
        const id = typeof args.event_id === "string" ? args.event_id : "";
        const expected = finiteInt(args.expected_version);
        if (!id || expected === undefined || expected < 1 || typeof args.from_original_date !== "string") {
          return badRequest("event_id, expected_version (at least 1) and from_original_date are required.");
        }
        try { return { ok: true, text: JSON.stringify({ changed: true, ...endCalendarSeries(options.db, id, expected, args.from_original_date, now()) }) }; }
        catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
    {
      tool: {
        name: "calendar_remove",
        description: "Remove a whole event or series that is a duplicate or a mistake (nothing is deleted; it can be restored in the Calendar screen). To stop a real series going forward use calendar_end_series instead. Ask Sir to confirm before calling. A series with past occurrences is refused unless include_history is true, which also hides those past occurrences; use it only when Sir wants them gone too. You cannot restore it yourself, so say only what was done.",
        inputSchema: {
          type: "object",
          properties: {
            event_id: { type: "string" }, expected_version: { type: "integer", minimum: 1 },
            include_history: { type: "boolean", description: "Also hide past occurrences of a series that has started." },
          },
          required: ["event_id", "expected_version"],
        },
      },
      run: async (args) => {
        const id = typeof args.event_id === "string" ? args.event_id : "";
        const expected = finiteInt(args.expected_version);
        if (!id || expected === undefined || expected < 1) return badRequest("event_id and expected_version (at least 1) are required.");
        try {
          const event = archiveCalendarEvent(options.db, id, expected, now(), args.include_history === true);
          return { ok: true, text: JSON.stringify({ changed: event.version !== expected, event }) };
        } catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
    {
      tool: {
        name: "calendar_remind",
        description: "Set or remove an event-owned reminder offset. This C1 tool records the schedule preference only; it does not claim a notification was scheduled or shown until C3 materialises it through Reminders.",
        inputSchema: {
          type: "object",
          properties: {
            event_id: { type: "string" }, expected_version: { type: "integer", minimum: 1 },
            minutes_before: { type: ["integer", "null"], minimum: 0, maximum: 10_080 },
          },
          required: ["event_id", "expected_version", "minutes_before"],
        },
      },
      run: async (args) => {
        const id = typeof args.event_id === "string" ? args.event_id : "";
        const expected = finiteInt(args.expected_version);
        const minutes = args.minutes_before === null ? null : finiteInt(args.minutes_before);
        if (!id || expected === undefined || (args.minutes_before !== null && minutes === undefined)) {
          return { ok: false, text: "event_id, expected_version and a valid minutes_before are required" };
        }
        try {
          const event = updateCalendarEvent(options.db, id, expected, { reminderMinutesBefore: minutes }, now());
          return { ok: true, text: `Calendar reminder preference saved; delivery is not active until linked reminders are materialised.\n${JSON.stringify(event)}` };
        } catch (error) { return { ok: false, text: errorText(error) }; }
      },
    },
  ];
}
