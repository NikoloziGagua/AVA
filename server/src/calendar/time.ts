import { CalendarError, type CalendarDstPolicy } from "./types.js";

export const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})$/;

export type LocalDateParts = { year: number; month: number; day: number };
export type LocalTimeParts = { hour: number; minute: number; second: number };

// Building an Intl.DateTimeFormat is expensive (~0.1-1ms); a year-long weekly
// expansion makes hundreds, so formatters are cached per zone. They are pure.
const zoneNames = new Map<string, string>();
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

export function normalizeTimeZone(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 100 ||
    (value !== "UTC" && !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(value))
  ) throw new CalendarError("invalid_timezone");
  const known = zoneNames.get(value);
  if (known) return known;
  try {
    const resolved = new Intl.DateTimeFormat("en-GB", { timeZone: value }).resolvedOptions().timeZone;
    zoneNames.set(value, resolved);
    return resolved;
  } catch {
    throw new CalendarError("invalid_timezone");
  }
}

export function parseLocalDate(value: string): LocalDateParts {
  const match = DATE_RE.exec(value);
  if (!match) throw new CalendarError("bad_request");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new CalendarError("bad_request");
  }
  return { year, month, day };
}

export function parseLocalTime(value: string): LocalTimeParts {
  const match = TIME_RE.exec(value);
  if (!match) throw new CalendarError("bad_request");
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) throw new CalendarError("bad_request");
  return { hour, minute, second };
}

export function formatLocalDate(parts: LocalDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function addLocalDays(value: string, days: number): string {
  const parsed = parseLocalDate(value);
  const date = new Date(0);
  date.setUTCFullYear(parsed.year, parsed.month - 1, parsed.day + days);
  date.setUTCHours(0, 0, 0, 0);
  return formatLocalDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

export function localDateDistance(from: string, to: string): number {
  const a = parseLocalDate(from), b = parseLocalDate(to);
  const epoch = (p: LocalDateParts) => {
    const d = new Date(0);
    d.setUTCFullYear(p.year, p.month - 1, p.day);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((epoch(b) - epoch(a)) / DAY_MS);
}

function zonedParts(epoch: number, timeZone: string) {
  let formatter = zonedFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    });
    zonedFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(epoch);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: number("year"), month: number("month"), day: number("day"),
    hour: number("hour"), minute: number("minute"), second: number("second"),
  };
}

function partsAsWallEpoch(parts: ReturnType<typeof zonedParts>): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

/**
 * Resolve a wall clock in an IANA zone without allowing JS Date to silently
 * shift a DST gap. Candidate offsets are observed around the target day, then
 * every candidate is round-tripped through Intl. Zero candidates is a gap;
 * multiple candidates require an explicit earlier/later policy.
 */
export function resolveLocalDateTime(
  localDate: string,
  localTime: string,
  timeZone: string,
  policy: CalendarDstPolicy = "reject",
): number {
  const date = parseLocalDate(localDate);
  const time = parseLocalTime(localTime);
  const zone = normalizeTimeZone(timeZone);
  const wall = new Date(0);
  wall.setUTCFullYear(date.year, date.month - 1, date.day);
  wall.setUTCHours(time.hour, time.minute, time.second, 0);
  const wallEpoch = wall.getTime();

  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 3) {
    const instant = wallEpoch + delta * 60 * 60_000;
    offsets.add(partsAsWallEpoch(zonedParts(instant, zone)) - instant);
  }
  const candidates = [...offsets]
    .map((offset) => wallEpoch - offset)
    .filter((instant) => {
      const projected = zonedParts(instant, zone);
      return projected.year === date.year && projected.month === date.month && projected.day === date.day &&
        projected.hour === time.hour && projected.minute === time.minute && projected.second === time.second;
    })
    .sort((a, b) => a - b)
    .filter((instant, index, all) => index === 0 || instant !== all[index - 1]);

  if (candidates.length === 0) throw new CalendarError("nonexistent_local_time");
  if (candidates.length > 1 && policy === "reject") throw new CalendarError("ambiguous_local_time");
  return policy === "later" ? candidates[candidates.length - 1]! : candidates[0]!;
}

export function formatZonedDateTime(epoch: number, timeZone: string): string {
  const parts = zonedParts(epoch, normalizeTimeZone(timeZone));
  return `${formatLocalDate(parts)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
}

export function localDayWindow(localDate: string, timeZone: string): { from: number; to: number; timeZone: string } {
  const zone = normalizeTimeZone(timeZone);
  return {
    from: resolveLocalDateTime(localDate, "00:00:00", zone, "earlier"),
    to: resolveLocalDateTime(addLocalDays(localDate, 1), "00:00:00", zone, "later"),
    timeZone: zone,
  };
}
