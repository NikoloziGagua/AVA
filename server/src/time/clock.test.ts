import { describe, expect, it } from "vitest";
import { clockLine, clockNow } from "./clock.js";

describe("clockNow", () => {
  it("reports Dublin summer time with its offset", () => {
    expect(clockNow(Date.parse("2026-09-27T18:05:00Z"))).toEqual({
      timeZone: "Europe/Dublin", localDate: "2026-09-27", localTime: "19:05", weekday: "Sunday", utcOffset: "+01:00",
    });
  });
  it("crosses midnight locally, not in UTC", () => {
    expect(clockNow(Date.parse("2026-09-27T23:30:00Z")).localDate).toBe("2026-09-28");
  });
  it("follows the clock change", () => {
    const winter = clockNow(Date.parse("2026-10-26T12:00:00Z"));
    expect(winter.utcOffset).toMatch(/^\+00:00$|^\+0$/);
    expect(winter.localTime).toBe("12:00");
  });
  it("renders one line telling the model not to look the date up", () => {
    expect(clockLine(Date.parse("2026-09-27T18:05:00Z"))).toBe("[NOW] Sunday 2026-09-27 19:05 Europe/Dublin (UTC+01:00). Use this; do not look up the date or time with a tool.");
  });
});
