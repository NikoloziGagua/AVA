import { describe, expect, it } from "vitest";
import { addDays, eventsOnDay, localDate, placeDay, queryWindow, visibleDates, weekStart } from "./layout.js";
import { occurrence } from "./fixtures.test-helper.js";
describe("Calendar wall dates and layout", () => {
  it("uses Dublin dates, Monday weeks and a complete 42-cell month", () => {
    expect(localDate(Date.parse("2030-09-26T23:30:00Z"))).toBe("2030-09-27");
    expect(weekStart("2030-09-27")).toBe("2030-09-23");
    expect(visibleDates("2030-09-27", "month")).toHaveLength(42);
    expect(visibleDates("2030-09-27", "week")).toHaveLength(7);
    expect(visibleDates("2030-09-27", "day")).toEqual(["2030-09-27"]);
    expect(addDays("2032-02-28", 1)).toBe("2032-02-29");
    const range = queryWindow(visibleDates("2030-09-27", "month"));
    expect((range.to - range.from) / 86400000).toBe(44);
  });
  it("places overlapping events side by side without changing source timestamps", () => {
    const rows = [occurrence, { ...occurrence, occurrenceKey: "other", startsAt: occurrence.startsAt + 1800000, endsAt: occurrence.endsAt + 1800000 }];
    const before = JSON.stringify(rows);
    const placed = placeDay(rows, "2030-09-27", "Europe/Dublin");
    expect(placed.map(p => [p.start, p.column, p.columns])).toEqual([[600, 0, 2], [630, 1, 2]]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("includes overnight events on each overlapping day, excluding an exact midnight end", () => {
    const row = { ...occurrence, startsAt: Date.parse("2030-09-26T23:00:00Z"), endsAt: Date.parse("2030-09-27T23:00:00Z") };
    expect(eventsOnDay([row], "2030-09-27", "Europe/Dublin")).toHaveLength(1);
    expect(eventsOnDay([row], "2030-09-28", "Europe/Dublin")).toHaveLength(0);
    expect(placeDay([row], "2030-09-27", "Europe/Dublin")[0]).toMatchObject({ start: 0, end: 1440 });
  });
  it("keeps UTC ordering over the repeated Dublin hour without fabricating elapsed time", () => {
    const early = { ...occurrence, startsAt: Date.parse("2030-10-27T00:30:00Z"), endsAt: Date.parse("2030-10-27T01:15:00Z") };
    const late = { ...early, occurrenceKey: "late", startsAt: Date.parse("2030-10-27T01:30:00Z"), endsAt: Date.parse("2030-10-27T02:30:00Z") };
    expect(eventsOnDay([late, early], "2030-10-27", "Europe/Dublin")).toEqual([early, late]);
    expect(placeDay([early], "2030-10-27", "Europe/Dublin")[0]!.end).toBeGreaterThan(90);
  });
});
