import { normalizeTimeZone, parseLocalDate, parseLocalTime } from "../calendar/time.js";

const MAX_HORIZON_MS = 366 * 24 * 60 * 60_000;

const ERROR_MESSAGES = {
  invalid_run_at: "Reminder time must be a valid integer epoch millisecond.",
  run_at_not_future: "Choose a future reminder time.",
  run_at_too_far: "Choose a reminder within the next 366 days.",
  invalid_time_zone: "Provide UTC or a valid named IANA time_zone, such as Europe/London.",
  conflicting_schedule: "A one-off reminder needs exactly one time, no interval or daily schedule, and once=true.",
  invalid_at: "Provide at as a full date and time with seconds and an explicit UTC offset, such as 2026-10-25T01:30:00+01:00; do not use at_local.",
  invalid_local_date: "The reminder date or time does not exist in the calendar.",
  time_zone_offset_mismatch: "The date, wall time and UTC offset must match time_zone; choose an explicit valid offset at a daylight-saving transition.",
} as const;

export type ReminderScheduleErrorCode = keyof typeof ERROR_MESSAGES;

/** Public errors contain only bounded codes/messages, never supplied input. */
export class ReminderScheduleError extends Error {
  constructor(readonly code: ReminderScheduleErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ReminderScheduleError";
  }
}

export type ReminderSchedule = { runAt: number; timeZone: string };

function normalizeReminderTimeZone(value: unknown): string {
  try {
    return normalizeTimeZone(value);
  } catch {
    throw new ReminderScheduleError("invalid_time_zone");
  }
}

/** The persisted instant is authoritative; its zone is retained for display. */
export function validateReminderSchedule(input: {
  runAt: unknown;
  timeZone: unknown;
  intervalMinutes?: unknown;
  dailyAt?: unknown;
  once?: unknown;
}, now = Date.now()): ReminderSchedule {
  if (
    input.intervalMinutes !== undefined || input.dailyAt !== undefined ||
    (input.once !== undefined && input.once !== true)
  ) {
    throw new ReminderScheduleError("conflicting_schedule");
  }
  const timeZone = normalizeReminderTimeZone(input.timeZone);
  const runAt = input.runAt;
  if (
    typeof runAt !== "number" || !Number.isSafeInteger(runAt) ||
    !Number.isFinite(new Date(runAt).getTime()) || !Number.isFinite(now)
  ) {
    throw new ReminderScheduleError("invalid_run_at");
  }
  if (runAt <= now) throw new ReminderScheduleError("run_at_not_future");
  if (runAt - now > MAX_HORIZON_MS) throw new ReminderScheduleError("run_at_too_far");
  return { runAt, timeZone };
}

/**
 * `at` is a wall time in `timeZone`, with a known explicit offset. An epoch
 * caller may display its instant in any zone; this human/tool form instead
 * checks the redundant wall time/offset/zone so DST cannot silently shift it.
 * No naive Date.parse or server-local timezone participates in resolution.
 */
export function resolveReminderInstant(at: string, timeZone: string, now = Date.now()): ReminderSchedule {
  const zone = normalizeReminderTimeZone(timeZone);
  const match = typeof at === "string" && at.length <= 40
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(at)
    : null;
  if (!match || match[8] === "-00:00") throw new ReminderScheduleError("invalid_at");

  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const hour = Number(match[4]), minute = Number(match[5]), second = Number(match[6]);
  const millis = Number((match[7] ?? "").padEnd(3, "0"));
  try {
    parseLocalDate(`${match[1]}-${match[2]}-${match[3]}`);
    parseLocalTime(`${match[4]}:${match[5]}:${match[6]}`);
  } catch {
    throw new ReminderScheduleError("invalid_local_date");
  }
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00-99.
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, millis);
  if (
    wall.getUTCFullYear() !== year || wall.getUTCMonth() + 1 !== month || wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second
  ) {
    throw new ReminderScheduleError("invalid_local_date");
  }

  const offset = match[8]!;
  const offsetHours = offset === "Z" ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === "Z" ? 0 : Number(offset.slice(4, 6));
  if (offsetHours > 23 || offsetMinutes > 59) throw new ReminderScheduleError("invalid_at");
  const offsetMs = (offsetHours * 60 + offsetMinutes) * 60_000 * (offset.startsWith("-") ? -1 : 1);
  const runAt = wall.getTime() - offsetMs;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, calendar: "iso8601", numberingSystem: "latn", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(runAt);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  if (
    part("year") !== year || part("month") !== month || part("day") !== day ||
    part("hour") !== hour || part("minute") !== minute || part("second") !== second
  ) {
    throw new ReminderScheduleError("time_zone_offset_mismatch");
  }
  return validateReminderSchedule({ runAt, timeZone: zone }, now);
}
