import { describe, expect, it } from "vitest";
import {
  formatOffset,
  formatWallTime,
  isValidTimeZone,
  offsetMinutesAt,
  resolveWallTime,
  wallTimeValue,
} from "./time.js";

const LONDON = "Europe/London";

describe("resolveWallTime", () => {
  it("resolves an ordinary summer time exactly, with its offset", () => {
    const result = resolveWallTime("2026-07-01T09:00", LONDON);
    expect(result).toEqual({ kind: "exact", candidate: { instant: Date.UTC(2026, 6, 1, 8, 0), offsetMinutes: 60 } });
  });

  it("resolves an ordinary winter time exactly", () => {
    const result = resolveWallTime("2026-12-01T09:00", LONDON);
    expect(result).toEqual({ kind: "exact", candidate: { instant: Date.UTC(2026, 11, 1, 9, 0), offsetMinutes: 0 } });
  });

  it("reports the spring-forward gap instead of inventing a time", () => {
    // Clocks jump 01:00 GMT -> 02:00 BST on 29 March 2026.
    expect(resolveWallTime("2026-03-29T01:30", LONDON)).toEqual({ kind: "gap" });
  });

  it("reports both occurrences of an autumn overlap, earliest first", () => {
    // 01:30 happens at BST (UTC+1) and again at GMT (UTC+0) on 25 October 2026.
    expect(resolveWallTime("2026-10-25T01:30", LONDON)).toEqual({
      kind: "ambiguous",
      candidates: [
        { instant: Date.UTC(2026, 9, 25, 0, 30), offsetMinutes: 60 },
        { instant: Date.UTC(2026, 9, 25, 1, 30), offsetMinutes: 0 },
      ],
    });
  });

  it("handles a zone with a half-hour offset and a southern-hemisphere change", () => {
    expect(resolveWallTime("2026-06-01T12:00", "Asia/Kolkata")).toEqual({
      kind: "exact", candidate: { instant: Date.UTC(2026, 5, 1, 6, 30), offsetMinutes: 330 },
    });
    // Sydney springs forward 02:00 -> 03:00 on 4 October 2026.
    expect(resolveWallTime("2026-10-04T02:30", "Australia/Sydney")).toEqual({ kind: "gap" });
  });

  it("rejects malformed values, impossible dates and unknown zones", () => {
    expect(resolveWallTime("2026-02-31T09:00", LONDON)).toEqual({ kind: "invalid" });
    expect(resolveWallTime("2026-07-01 09:00", LONDON)).toEqual({ kind: "invalid" });
    expect(resolveWallTime("2026-07-01T24:00", LONDON)).toEqual({ kind: "invalid" });
    expect(resolveWallTime("2026-07-01T09:00", "Mars/Olympus")).toEqual({ kind: "invalid" });
  });

  it("works in UTC", () => {
    expect(resolveWallTime("2026-10-25T01:30", "UTC")).toEqual({
      kind: "exact", candidate: { instant: Date.UTC(2026, 9, 25, 1, 30), offsetMinutes: 0 },
    });
  });
});

describe("formatting", () => {
  it("formats offsets explicitly", () => {
    expect(formatOffset(60)).toBe("UTC+01:00");
    expect(formatOffset(0)).toBe("UTC+00:00");
    expect(formatOffset(-210)).toBe("UTC-03:30");
    expect(formatOffset(330)).toBe("UTC+05:30");
  });

  it("reads offsets and wall times in the named zone", () => {
    expect(offsetMinutesAt(Date.UTC(2026, 6, 1), LONDON)).toBe(60);
    expect(offsetMinutesAt(Date.UTC(2026, 0, 1), LONDON)).toBe(0);
    expect(wallTimeValue(Date.UTC(2026, 6, 1, 8, 0), LONDON)).toBe("2026-07-01T09:00");
    expect(formatWallTime(Date.UTC(2026, 9, 25, 0, 30), LONDON)).toBe("Sun 25 Oct 2026, 01:30");
    expect(isValidTimeZone(LONDON)).toBe(true);
    expect(isValidTimeZone("Nowhere/Else")).toBe(false);
  });
});
