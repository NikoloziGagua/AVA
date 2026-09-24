import { describe, expect, it } from "vitest";
import { ReminderScheduleError, resolveReminderInstant, validateReminderSchedule } from "./reminder-schedule.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const DAY = 24 * 60 * 60_000;

function expectCode(action: () => unknown, code: ReminderScheduleError["code"]) {
  try {
    action();
    throw new Error("expected schedule rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ReminderScheduleError);
    expect((error as ReminderScheduleError).code).toBe(code);
  }
}

describe("validateReminderSchedule", () => {
  it("preserves an exact epoch with its named display zone independently of server timezone", () => {
    expect(validateReminderSchedule({ runAt: NOW + 1234, timeZone: "Europe/London", once: true }, NOW))
      .toEqual({ runAt: NOW + 1234, timeZone: "Europe/London" });
    expect(validateReminderSchedule({ runAt: NOW + DAY, timeZone: "UTC" }, NOW).timeZone).toBe("UTC");
  });

  it("accepts the 366-day boundary and rejects anything beyond it", () => {
    expect(validateReminderSchedule({ runAt: NOW + 366 * DAY, timeZone: "UTC" }, NOW).runAt).toBe(NOW + 366 * DAY);
    expectCode(() => validateReminderSchedule({ runAt: NOW + 366 * DAY + 1, timeZone: "UTC" }, NOW), "run_at_too_far");
  });

  it.each([undefined, null, "", "GMT", "EST", "+01:00", "Europe/Missing", " UTC", "x".repeat(101)])("rejects invalid/missing timezone %s", (timeZone) => {
    expectCode(() => validateReminderSchedule({ runAt: NOW + DAY, timeZone }, NOW), "invalid_time_zone");
  });

  it.each([undefined, null, "1767312000000", true, NaN, Infinity, NOW + 0.5, Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001])("rejects an invalid epoch without coercion: %s", (runAt) => {
    expectCode(() => validateReminderSchedule({ runAt, timeZone: "UTC" }, NOW), "invalid_run_at");
  });

  it.each([NOW, NOW - 1])("rejects nonfuture epoch %s", (runAt) => {
    expectCode(() => validateReminderSchedule({ runAt, timeZone: "UTC" }, NOW), "run_at_not_future");
  });

  it.each([{ intervalMinutes: 5 }, { intervalMinutes: null }, { dailyAt: "09:00" }, { dailyAt: null }, { once: false }, { once: "true" }])("rejects conflicting one-off inputs %j", (extra) => {
    expectCode(() => validateReminderSchedule({ runAt: NOW + DAY, timeZone: "UTC", ...extra }, NOW), "conflicting_schedule");
  });

  it("does not echo untrusted timezone input in its bounded error", () => {
    try {
      validateReminderSchedule({ runAt: NOW + DAY, timeZone: "secret-input" }, NOW);
    } catch (error) {
      expect(String(error)).not.toContain("secret-input");
      expect(String(error).length).toBeLessThan(200);
    }
  });
});

describe("resolveReminderInstant", () => {
  it("resolves explicit offsets and millisecond precision exactly", () => {
    expect(resolveReminderInstant("2026-07-01T09:30:00.123+01:00", "Europe/London", NOW))
      .toEqual({ runAt: Date.parse("2026-07-01T08:30:00.123Z"), timeZone: "Europe/London" });
    expect(resolveReminderInstant("2026-07-01T09:30:00+05:45", "Asia/Kathmandu", NOW).runAt)
      .toBe(Date.parse("2026-07-01T03:45:00Z"));
    expect(resolveReminderInstant("2026-01-02T00:00:00Z", "UTC", NOW).runAt).toBe(NOW + DAY);
  });

  it("accepts a real leap day but rejects normalized impossible calendar dates", () => {
    const beforeLeap = Date.parse("2028-01-01T00:00:00Z");
    expect(resolveReminderInstant("2028-02-29T09:00:00Z", "UTC", beforeLeap).runAt)
      .toBe(Date.parse("2028-02-29T09:00:00Z"));
    for (const at of ["2026-02-29T09:00:00Z", "2026-02-30T09:00:00Z", "2026-04-31T09:00:00Z", "2026-13-01T00:00:00Z", "2026-01-00T00:00:00Z", "2026-01-02T24:00:00Z", "2026-01-02T09:60:00Z", "2026-01-02T09:00:60Z"]) {
      expectCode(() => resolveReminderInstant(at, "UTC", NOW), "invalid_local_date");
    }
  });

  it.each(["2026-01-02", "2026-01-02T09:00:00", "2026-01-02T09:00Z", "2026-01-02 09:00:00Z", "2026-01-02T09:00:00-00:00", "2026-01-02T09:00:00+24:00", "2026-01-02T09:00:00+01:60", "2026-01-02T09:00:00.1234Z"])("rejects missing/unknown/invalid offset or noncanonical syntax %s", (at) => {
    expectCode(() => resolveReminderInstant(at, "UTC", NOW), "invalid_at");
  });

  it("rejects both offsets for a London spring DST gap", () => {
    for (const offset of ["+00:00", "+01:00"]) {
      expectCode(() => resolveReminderInstant(`2026-03-29T01:30:00${offset}`, "Europe/London", NOW), "time_zone_offset_mismatch");
    }
  });

  it("preserves either explicit choice during a London autumn DST overlap", () => {
    const earlier = resolveReminderInstant("2026-10-25T01:30:00+01:00", "Europe/London", NOW);
    const later = resolveReminderInstant("2026-10-25T01:30:00+00:00", "Europe/London", NOW);
    expect(earlier.runAt).toBe(Date.parse("2026-10-25T00:30:00Z"));
    expect(later.runAt - earlier.runAt).toBe(60 * 60_000);
  });

  it("rejects a valid-looking date whose explicit offset does not match its named zone", () => {
    expectCode(() => resolveReminderInstant("2026-07-01T09:30:00Z", "Europe/London", NOW), "time_zone_offset_mismatch");
  });

  it("applies the same missing-zone, future and horizon validation", () => {
    expectCode(() => resolveReminderInstant("2026-01-02T09:00:00Z", "", NOW), "invalid_time_zone");
    expectCode(() => resolveReminderInstant("2026-01-01T00:00:00Z", "UTC", NOW), "run_at_not_future");
    expectCode(() => resolveReminderInstant("2027-01-03T00:00:00Z", "UTC", NOW), "run_at_too_far");
  });
});
