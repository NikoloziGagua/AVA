import { ApiError } from "../api.js";
import { clearToken, getToken } from "../auth/tokens.js";

/** One occurrence from GET /api/calendar/events (contract calendar-events v2). */
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
  kind: "lecture" | "event" | "block";
  attendanceIntent: "undecided" | "attend" | "skip";
  attendanceOutcome: "unknown" | "attended" | "skipped" | "missed";
  notesFolderId: string | null;
  eventVersion: number;
  exceptionVersion: number | null;
  cancelled: boolean;
  moved: boolean;
};

export type CalendarRange = {
  fetchedAt: number;
  occurrences: CalendarOccurrence[];
  complete: boolean;
};

export const DEFAULT_TIME_ZONE = "Europe/Dublin";

/** Occurrences whose time overlaps [from, to) in epoch ms; the server caps a window at 90 days. */
export async function fetchCalendarRange(from: number, to: number, timeZone = DEFAULT_TIME_ZONE): Promise<CalendarRange> {
  const path = `/api/calendar/events?from=${Math.floor(from)}&to=${Math.floor(to)}&timeZone=${encodeURIComponent(timeZone)}`;
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(path, { headers }); }
  catch { throw new ApiError(0, "AVA's server is unreachable.", "server_unreachable", "Restart the AVA Desktop Runtime.", path); }
  const text = await response.text();
  let body: { fetchedAt?: number; occurrences?: CalendarOccurrence[]; complete?: boolean; error?: string } = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    if (response.status === 401) { clearToken(); window.dispatchEvent(new Event("ava:unauthorized")); }
    throw new ApiError(response.status, `The calendar returned HTTP ${response.status}.`, body.error ?? `http_${response.status}`, null, path);
  }
  return {
    fetchedAt: typeof body.fetchedAt === "number" ? body.fetchedAt : Date.now(),
    occurrences: Array.isArray(body.occurrences) ? body.occurrences : [],
    complete: body.complete === true,
  };
}
