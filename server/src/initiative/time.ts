import { addLocalDays, formatZonedDateTime, resolveLocalDateTime } from "../calendar/time.js";
import { CalendarError } from "../calendar/types.js";
import { INITIATIVE_TIME_ZONE } from "./prompt.js";
import type { InitiativeSettings } from "./settings.js";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export function localDate(now: number): string { return formatZonedDateTime(now, INITIATIVE_TIME_ZONE).slice(0, 10); }
/** Dublin gap: advance to the first real minute; overlap: first instance. */
export function resolveMinute(date: string, time: string): number {
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  for (let offset = 0; offset <= 180; offset++) {
    const total = minute + offset;
    const day = addLocalDays(date, Math.floor(total / 1440));
    const wall = `${String(Math.floor(total % 1440 / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
    try { return resolveLocalDateTime(day, wall, INITIATIVE_TIME_ZONE, "earlier"); }
    catch (error) { if (!(error instanceof CalendarError) || error.code !== "nonexistent_local_time") throw error; }
  }
  throw new Error("initiative_time_unresolvable");
}
export function isQuiet(now: number, settings: InitiativeSettings): boolean {
  const time = formatZonedDateTime(now, INITIATIVE_TIME_ZONE).slice(11, 16);
  const { quietStart: start, quietEnd: end } = settings;
  // Equal endpoints deliberately mean all-day quiet, never silently no quiet.
  return start === end || (start < end ? time >= start && time < end : time >= start || time < end);
}
export function occurrenceWindow(now: number, settings: InitiativeSettings) {
  const date = localDate(now);
  const originalStart = resolveMinute(date, settings.deliveryLocalTime);
  let from = originalStart;
  let to = Math.min(from + 3 * HOUR, resolveMinute(addLocalDays(date, 1), "00:00"));
  if (settings.quietStart === settings.quietEnd) to = from;
  else for (const day of [addLocalDays(date, -1), date, addLocalDays(date, 1)]) {
    const quietFrom = resolveMinute(day, settings.quietStart);
    const quietTo = resolveMinute(settings.quietStart < settings.quietEnd ? day : addLocalDays(day, 1), settings.quietEnd);
    if (quietTo <= from || quietFrom >= to) continue;
    if (quietFrom <= from) from = Math.min(to, quietTo);
    else to = quietFrom;
  }
  return { key: `daily:${date}`, date, from, to, eligible: now >= from && now < to && !isQuiet(now, settings) };
}
