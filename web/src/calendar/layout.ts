import type { CalendarOccurrence } from "./api.js";

const DAY = 86_400_000;
export function localDate(at: number, timeZone = "Europe/Dublin"): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
export function addDays(date: string, count: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + count * DAY).toISOString().slice(0, 10);
}
export function weekStart(date: string): string {
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}
export function visibleDates(date: string, mode: "month" | "week" | "day"): string[] {
  const start = mode === "month" ? weekStart(`${date.slice(0, 7)}-01`) : mode === "week" ? weekStart(date) : date;
  return Array.from({ length: mode === "month" ? 42 : mode === "week" ? 7 : 1 }, (_, i) => addDays(start, i));
}
/** Wide UTC bounds cover every IANA wall day; actual rows are filtered by display zone. */
export function queryWindow(dates: string[]): { from: number; to: number } {
  return { from: Date.parse(`${dates[0]}T00:00:00Z`) - DAY, to: Date.parse(`${addDays(dates[dates.length - 1]!, 1)}T00:00:00Z`) + DAY };
}
export function eventsOnDay(rows: CalendarOccurrence[], date: string, zone: string): CalendarOccurrence[] {
  return rows.filter(row => localDate(row.startsAt, zone) <= date && localDate(row.endsAt - 1, zone) >= date)
    .sort((a, b) => a.startsAt - b.startsAt || a.occurrenceKey.localeCompare(b.occurrenceKey));
}
function minutes(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  return Number(parts.find(p => p.type === "hour")!.value) * 60 + Number(parts.find(p => p.type === "minute")!.value);
}
/** Layout is visual only: never rewrites wall/UTC times. Minimum height is 30min for legibility. */
export function placeDay(rows: CalendarOccurrence[], date: string, zone: string) {
  const placed = eventsOnDay(rows, date, zone).map(row => {
    const start = localDate(row.startsAt, zone) < date ? 0 : minutes(row.startsAt, zone);
    const end = localDate(row.endsAt, zone) > date ? 1440 : minutes(row.endsAt, zone);
    return { row, start, end: Math.min(1440, Math.max(start + 30, end)), column: 0, columns: 1 };
  });
  let group: typeof placed = [], edge = -1;
  const finish = () => {
    const ends: number[] = [];
    for (const item of group) {
      let column = ends.findIndex(end => end <= item.start);
      if (column < 0) column = ends.length;
      ends[column] = item.end; item.column = column;
    }
    for (const item of group) item.columns = ends.length;
  };
  for (const item of placed) {
    if (item.start >= edge) { finish(); group = []; }
    group.push(item); edge = Math.max(edge, item.end);
  }
  finish(); return placed;
}
