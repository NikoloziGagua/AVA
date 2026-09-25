export const CALENDAR_EVENT_KINDS = ["lecture", "event", "block"] as const;
export const CALENDAR_RECURRENCE_KINDS = ["none", "weekly"] as const;
export const CALENDAR_DST_POLICIES = ["reject", "earlier", "later"] as const;
export const CALENDAR_ATTENDANCE_INTENTS = ["undecided", "attend", "skip"] as const;
export const CALENDAR_ATTENDANCE_OUTCOMES = ["unknown", "attended", "skipped", "missed"] as const;

export type CalendarEventKind = typeof CALENDAR_EVENT_KINDS[number];
export type CalendarRecurrenceKind = typeof CALENDAR_RECURRENCE_KINDS[number];
export type CalendarDstPolicy = typeof CALENDAR_DST_POLICIES[number];
export type CalendarAttendanceIntent = typeof CALENDAR_ATTENDANCE_INTENTS[number];
export type CalendarAttendanceOutcome = typeof CALENDAR_ATTENDANCE_OUTCOMES[number];
export type CalendarSource = "manual" | "ava_chat" | "ava_voice";

export type CalendarErrorCode =
  | "bad_request"
  | "not_found"
  | "stale_version"
  | "invalid_range"
  | "invalid_timezone"
  | "nonexistent_local_time"
  | "ambiguous_local_time"
  | "recurrence_too_long"
  | "occurrence_not_found";

const ERROR_MESSAGES: Record<CalendarErrorCode, string> = {
  bad_request: "The calendar request is invalid.",
  not_found: "That calendar event is no longer available.",
  stale_version: "That calendar event changed elsewhere. Refresh it before trying again.",
  invalid_range: "Choose a calendar window of no more than 90 days.",
  invalid_timezone: "Use a valid named IANA time zone, such as Europe/Dublin.",
  nonexistent_local_time: "That local time does not exist because the clock changes then.",
  ambiguous_local_time: "That local time occurs twice. Choose the earlier or later occurrence.",
  recurrence_too_long: "A weekly series must end within one year of its first date.",
  occurrence_not_found: "That occurrence does not belong to the current event series.",
};

/** Bounded public errors: codes/messages never echo schedule content. */
export class CalendarError extends Error {
  constructor(readonly code: CalendarErrorCode, message = ERROR_MESSAGES[code]) {
    super(message);
    this.name = "CalendarError";
  }
}

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  kind: CalendarEventKind;
  timeZone: string;
  anchorLocalDate: string;
  startLocalTime: string;
  durationMinutes: number;
  recurrenceKind: CalendarRecurrenceKind;
  recurrenceUntilDate: string | null;
  dstPolicy: CalendarDstPolicy;
  attendanceIntent: CalendarAttendanceIntent;
  notesFolderId: string | null;
  reminderMinutesBefore: number | null;
  splitFromEventId: string | null;
  source: CalendarSource;
  sourceSessionId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};

export type CalendarEventException = {
  eventId: string;
  occurrenceLocalDate: string;
  movedLocalDate: string | null;
  movedLocalTime: string | null;
  movedDurationMinutes: number | null;
  cancelled: boolean;
  attendanceIntentOverride: CalendarAttendanceIntent | null;
  attendanceOutcome: CalendarAttendanceOutcome;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type CalendarOccurrence = {
  eventId: string;
  occurrenceKey: string;
  originalLocalDate: string;
  localStart: string;
  localEnd: string;
  startsAt: number;
  endsAt: number;
  timeZone: string;
  title: string;
  description: string;
  location: string;
  kind: CalendarEventKind;
  attendanceIntent: CalendarAttendanceIntent;
  attendanceOutcome: CalendarAttendanceOutcome;
  notesFolderId: string | null;
  eventVersion: number;
  exceptionVersion: number | null;
  cancelled: boolean;
  moved: boolean;
  reminder: null;
};

export type CalendarWindow = { from: number; to: number; timeZone: string };

export type CalendarQueryResult = {
  fetchedAt: number;
  window: CalendarWindow;
  events: CalendarEvent[];
  occurrences: CalendarOccurrence[];
  complete: true;
};

