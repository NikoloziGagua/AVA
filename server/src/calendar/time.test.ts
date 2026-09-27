import { describe, expect, it } from "vitest";
import { CalendarError } from "./types.js";
import {
  addLocalDays,
  formatZonedDateTime,
  localDateDistance,
  localDayWindow,
  normalizeTimeZone,
  resolveLocalDateTime,
} from "./time.js";

function code(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return error instanceof CalendarError ? error.code : undefined; }
  return undefined;
}

describe("calendar wall-clock resolution", () => {
  it("resolves Europe/Dublin independently across standard and summer time", () => {
    expect(new Date(resolveLocalDateTime("2026-01-12", "09:00:00", "Europe/Dublin")).toISOString())
      .toBe("2026-01-12T09:00:00.000Z");
    expect(new Date(resolveLocalDateTime("2026-07-13", "09:00:00", "Europe/Dublin")).toISOString())
      .toBe("2026-07-13T08:00:00.000Z");
  });

  it("rejects spring gaps and requires a policy for autumn ambiguity", () => {
    expect(code(() => resolveLocalDateTime("2026-03-29", "01:30:00", "Europe/Dublin")))
      .toBe("nonexistent_local_time");
    expect(code(() => resolveLocalDateTime("2026-10-25", "01:30:00", "Europe/Dublin")))
      .toBe("ambiguous_local_time");
    const earlier = resolveLocalDateTime("2026-10-25", "01:30:00", "Europe/Dublin", "earlier");
    const later = resolveLocalDateTime("2026-10-25", "01:30:00", "Europe/Dublin", "later");
    expect(later - earlier).toBe(60 * 60_000);
  });

  it("rejects invalid zones and calendar values without echoing input", () => {
    expect(code(() => normalizeTimeZone("Europe/private-secret"))).toBe("invalid_timezone");
    expect(code(() => resolveLocalDateTime("2026-02-30", "09:00:00", "UTC"))).toBe("bad_request");
  });

  it("uses local calendar arithmetic and day windows across DST", () => {
    expect(addLocalDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(localDateDistance("2026-03-27", "2026-03-30")).toBe(3);
    const window = localDayWindow("2026-03-29", "Europe/Dublin");
    expect(window.to - window.from).toBe(23 * 60 * 60_000);
    expect(formatZonedDateTime(window.from, "Europe/Dublin")).toBe("2026-03-29T00:00:00");
  });
});

describe("cached zone formatters (v3)", () => {
  it("reuse formatters but never results: every instant is computed fresh", async () => {
    const { resolveLocalDateTime, normalizeTimeZone } = await import("./time.js");
    expect(normalizeTimeZone("Europe/Dublin")).toBe("Europe/Dublin");
    expect(normalizeTimeZone("Europe/Dublin")).toBe("Europe/Dublin");
    const summer = resolveLocalDateTime("2027-07-01", "09:00:00", "Europe/Dublin");
    const winter = resolveLocalDateTime("2027-01-11", "09:00:00", "Europe/Dublin");
    expect(summer).toBe(Date.parse("2027-07-01T08:00:00Z"));
    expect(winter).toBe(Date.parse("2027-01-11T09:00:00Z"));
    expect(resolveLocalDateTime("2027-01-11", "09:00:00", "America/New_York")).toBe(Date.parse("2027-01-11T14:00:00Z"));
    expect(resolveLocalDateTime("2027-07-01", "09:00:00", "Europe/Dublin")).toBe(summer);
  });
});
