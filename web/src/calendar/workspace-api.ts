import { ApiError } from "../api.js";
import { clearToken, getToken } from "../auth/tokens.js";
import type { CalendarOccurrence } from "./api.js";

/** Existing calendar-events v2 contract. No client-side schedule authority. */
export type EventInput = {
  title: string; description: string; location: string;
  kind: "lecture" | "event" | "block";
  timeZone: string; anchorLocalDate: string; startLocalTime: string; durationMinutes: number;
  recurrenceKind: "none" | "weekly"; recurrenceUntilDate: string | null;
  dstPolicy: "reject" | "earlier" | "later";
  attendanceIntent: "undecided" | "attend" | "skip";
  notesFolderId: string | null;
};
export type EventDefinition = EventInput & { id: string; version: number; archivedAt: number | null; reminderMinutesBefore: number | null };
export type CalendarWorkspace = { fetchedAt: number; complete: true; events: EventDefinition[]; occurrences: CalendarOccurrence[] };
export type OccurrencePatch = {
  /** null explicitly restores inheritance; omission preserves the existing override. */
  attendanceIntentOverride?: CalendarOccurrence["attendanceIntent"] | null;
  attendanceOutcome?: CalendarOccurrence["attendanceOutcome"];
  cancelled?: boolean;
};
const errors: Record<string, string> = {
  stale_version: "This event changed elsewhere. Close the editor to load its latest version before trying again.",
  not_found: "This event is no longer available. Refresh the calendar.",
  occurrence_not_found: "This occurrence no longer belongs to the series. Refresh the calendar.",
  invalid_range: "There are too many events in this range. Try Day or Week.",
  invalid_timezone: "Use a named time zone, such as Europe/Dublin.",
  nonexistent_local_time: "This local time does not exist because the clocks change. Choose another time.",
  ambiguous_local_time: "This time occurs twice when the clocks change. Choose earlier or later in Clock changes.",
  recurrence_too_long: "A weekly series must end within one year of its first date.",
  bad_request: "The event could not be saved. Check its fields; past series cannot be rewritten.",
};
async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init?.body) headers.set("content-type", "application/json");
  let response: Response;
  try { response = await fetch(path, { ...init, headers }); }
  catch { throw new ApiError(0, init?.method ? "The result is unconfirmed. Close and refresh before making another change; do not resend blindly." : "The calendar could not be reached. Try again.", "server_unreachable", null, path); }
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw); } catch { /* fail closed below */ }
  if (!response.ok) {
    if (response.status === 401) { clearToken(); window.dispatchEvent(new Event("ava:unauthorized")); }
    const code = typeof body?.error === "string" ? body.error : "calendar_unavailable";
    throw new ApiError(response.status, errors[code] ?? "The calendar is unavailable. Refresh before trying again.", code, null, path);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(502, "The calendar returned an invalid response. Refresh before making another change.", "invalid_response", null, path);
  return body;
}
const idValid = (id: unknown): id is string => typeof id === "string" && /^cal_[A-Za-z0-9_-]{1,64}$/.test(id);
const dateValid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value);
const timeValid = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value);
const zoneValid = (value: unknown) => { try { return typeof value === "string" && value.length <= 100 && !!new Intl.DateTimeFormat("en", { timeZone: value }).format(0); } catch { return false; } };
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const folderValid = (value: unknown) => value === null || bounded(value, 120);
function definitionValid(value: unknown): value is EventDefinition {
  const e = value as EventDefinition | null;
  return !!e && idValid(e.id) && Number.isSafeInteger(e.version) && e.version > 0
    && bounded(e.title, 160) && bounded(e.description, 10000) && bounded(e.location, 500)
    && zoneValid(e.timeZone) && dateValid(e.anchorLocalDate) && timeValid(e.startLocalTime)
    && Number.isInteger(e.durationMinutes) && e.durationMinutes > 0 && e.durationMinutes <= 10080 && ["none", "weekly"].includes(e.recurrenceKind)
    && (e.recurrenceUntilDate === null || dateValid(e.recurrenceUntilDate)) && folderValid(e.notesFolderId)
    && (e.archivedAt === null || Number.isFinite(e.archivedAt))
    && ["event", "lecture", "block"].includes(e.kind) && ["reject", "earlier", "later"].includes(e.dstPolicy)
    && ["undecided", "attend", "skip"].includes(e.attendanceIntent);
}
export async function fetchCalendarWorkspace(from: number, to: number, timeZone: string): Promise<CalendarWorkspace> {
  const body = await request(`/api/calendar/events?from=${Math.floor(from)}&to=${Math.floor(to)}&timeZone=${encodeURIComponent(timeZone)}`);
  const events = body.events, occurrences = body.occurrences;
  if (body.complete !== true || !Number.isFinite(body.fetchedAt) || !Array.isArray(events) || events.length > 500 || !events.every(definitionValid)
    || !Array.isArray(occurrences) || occurrences.length > 500 || !occurrences.every((o: CalendarOccurrence) => o && idValid(o.eventId)
      && dateValid(o.originalLocalDate) && o.occurrenceKey === `${o.eventId}:${o.originalLocalDate}` && bounded(o.title, 160)
      && bounded(o.description, 10000) && bounded(o.location, 500) && folderValid(o.notesFolderId)
      && zoneValid(o.timeZone) && Number.isFinite(o.startsAt) && Number.isFinite(o.endsAt) && o.endsAt > o.startsAt
      && ["event", "lecture", "block"].includes(o.kind) && ["undecided", "attend", "skip"].includes(o.attendanceIntent)
      && ["unknown", "attended", "skipped", "missed"].includes(o.attendanceOutcome) && typeof o.cancelled === "boolean" && typeof o.moved === "boolean"
      && Number.isSafeInteger(o.eventVersion) && o.eventVersion > 0
      && (o.exceptionVersion === null || (Number.isSafeInteger(o.exceptionVersion) && o.exceptionVersion > 0))
      && events.some((e: EventDefinition) => e.id === o.eventId && e.version === o.eventVersion))
    || new Set(events.map((e: EventDefinition) => e.id)).size !== events.length
    || new Set(occurrences.map((o: CalendarOccurrence) => o.occurrenceKey)).size !== occurrences.length) {
    throw new ApiError(502, "The calendar response is incomplete or invalid. Refresh before editing.", "invalid_response", null, "/api/calendar/events");
  }
  return { fetchedAt: body.fetchedAt as number, complete: true, events, occurrences };
}
export async function saveCalendarEvent(input: EventInput, base?: EventDefinition): Promise<EventDefinition> {
  if (base && (!idValid(base.id) || !Number.isSafeInteger(base.version) || base.version < 1)) throw new Error("Invalid event identity.");
  const body = await request(`/api/calendar/events${base ? `/${encodeURIComponent(base.id)}` : ""}`, {
    method: base ? "PATCH" : "POST", body: JSON.stringify({ ...input, ...(base ? { expectedVersion: base.version } : {}) }),
  });
  if (!definitionValid(body.event) || (base && (body.event.id !== base.id || body.event.version <= base.version))) throw new ApiError(502, "The save result is unconfirmed. Close and refresh before making another change.", "invalid_response", null, "/api/calendar/events");
  return body.event;
}
export async function updateOccurrence(base: CalendarOccurrence, patch: OccurrencePatch): Promise<void> {
  if (!idValid(base.eventId) || !/^\d{4}-\d{2}-\d{2}$/.test(base.originalLocalDate) || !Number.isSafeInteger(base.eventVersion) || base.eventVersion < 1) throw new Error("Invalid occurrence identity.");
  const body = await request(`/api/calendar/events/${encodeURIComponent(base.eventId)}/occurrences/${base.originalLocalDate}`, {
    method: "PUT", body: JSON.stringify({ ...patch, expectedEventVersion: base.eventVersion, expectedExceptionVersion: base.exceptionVersion }),
  });
  const result = body.exception as { eventId?: string; occurrenceLocalDate?: string; version?: number } | undefined;
  if (result?.eventId !== base.eventId || result.occurrenceLocalDate !== base.originalLocalDate || !Number.isSafeInteger(result.version) || result.version! <= (base.exceptionVersion ?? 0)) {
    throw new ApiError(502, "The update result is unconfirmed. Close and refresh before making another change.", "invalid_response", null, "/api/calendar/events");
  }
}
