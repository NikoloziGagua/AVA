/**
 * Wall-clock time in a named time zone, without guessing (contract
 * i4-one-off-reminders v1). A datetime-local value names a wall time, not an
 * instant: around daylight-saving changes it can name no instant (a gap) or
 * two (an overlap). `new Date(value)` would silently pick one; this module
 * reports both cases so the UI can ask instead.
 */

export type WallTimeCandidate = { instant: number; offsetMinutes: number };

export type ResolvedWallTime =
  | { kind: "invalid" }
  | { kind: "gap" }
  | { kind: "exact"; candidate: WallTimeCandidate }
  | { kind: "ambiguous"; candidates: [WallTimeCandidate, WallTimeCandidate] };

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const HOUR = 60 * 60_000;

/** The browser's IANA zone ("Europe/London"), or UTC when it cannot say. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

type WallParts = { year: number; month: number; day: number; hour: number; minute: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();
function wallPartsAt(instant: number, zone: string): WallParts {
  let format = partFormatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    partFormatters.set(zone, format);
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! };
}

const asUtc = (p: WallParts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

/** The zone's offset from UTC at an instant, in minutes (east positive). */
export function offsetMinutesAt(instant: number, zone: string): number {
  const floored = Math.floor(instant / 60_000) * 60_000;
  return Math.round((asUtc(wallPartsAt(floored, zone)) - floored) / 60_000);
}

/** Resolve a datetime-local value ("2026-10-25T01:30") in a named zone. */
export function resolveWallTime(value: string, zone: string): ResolvedWallTime {
  const match = WALL_TIME.exec(value);
  if (!match || !isValidTimeZone(zone)) return { kind: "invalid" };
  const wanted: WallParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]),
  };
  const wallUtc = asUtc(wanted);
  // Reject calendar overflow such as 31 February, which Date.UTC would roll over.
  const check = new Date(wallUtc);
  if (
    check.getUTCFullYear() !== wanted.year || check.getUTCMonth() + 1 !== wanted.month
    || check.getUTCDate() !== wanted.day || wanted.hour > 23 || wanted.minute > 59
  ) return { kind: "invalid" };

  // Every offset in force within a day either side covers any DST change.
  const offsets = new Set<number>();
  for (const probe of [-24, -12, 0, 12, 24]) offsets.add(offsetMinutesAt(wallUtc + probe * HOUR, zone));
  const candidates: WallTimeCandidate[] = [];
  for (const offsetMinutes of offsets) {
    const instant = wallUtc - offsetMinutes * 60_000;
    const back = wallPartsAt(instant, zone);
    if (asUtc(back) === wallUtc && !candidates.some((c) => c.instant === instant)) {
      candidates.push({ instant, offsetMinutes });
    }
  }
  candidates.sort((a, b) => a.instant - b.instant);
  if (candidates.length === 0) return { kind: "gap" };
  if (candidates.length === 1) return { kind: "exact", candidate: candidates[0]! };
  return { kind: "ambiguous", candidates: [candidates[0]!, candidates[candidates.length - 1]!] };
}

/** "UTC+01:00", "UTC-03:30", "UTC+00:00". */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sun 25 Oct 2026, 01:30" in the given zone. Fixed names, so every ICU version agrees. */
export function formatWallTime(instant: number, zone: string): string {
  const p = wallPartsAt(instant, zone);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  const two = (n: number) => String(n).padStart(2, "0");
  return `${weekday} ${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${two(p.hour)}:${two(p.minute)}`;
}

/** A datetime-local value for an instant in the given zone. */
export function wallTimeValue(instant: number, zone: string): string {
  const p = wallPartsAt(instant, zone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}
