import { describe, expect, it } from "vitest";
import type { CalendarOccurrence } from "../calendar/api.js";
import { localDate, pickOneThing, suggestionsFor } from "./oneThing.js";

const TZ = "Europe/Dublin";
// 2026-09-25 09:00 in Dublin (UTC+1).
const NOW = Date.parse("2026-09-25T08:00:00Z");
const HOUR = 3_600_000;

function occurrence(overrides: Partial<CalendarOccurrence>): CalendarOccurrence {
  return {
    eventId: "e1", occurrenceKey: "e1:2026-09-25", originalLocalDate: "2026-09-25",
    localStart: "2026-09-25T10:00:00", localEnd: "2026-09-25T11:00:00",
    startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, timeZone: TZ,
    title: "Agile Development · Lecture", description: "", location: "Room 2.14", kind: "lecture",
    attendanceIntent: "attend", attendanceOutcome: "unknown", notesFolderId: null,
    eventVersion: 1, exceptionVersion: null, cancelled: false, moved: false,
    ...overrides,
  };
}

const empty = { now: NOW, timeZone: TZ, occurrences: [], reminders: [], notes: [] };

describe("pickOneThing", () => {
  it("prefers the next event today that hasn't started", () => {
    const thing = pickOneThing({
      ...empty,
      occurrences: [
        occurrence({ occurrenceKey: "late", title: "Later lecture", startsAt: NOW + 5 * HOUR }),
        occurrence({ occurrenceKey: "past", title: "Already started", startsAt: NOW - HOUR }),
        occurrence({ occurrenceKey: "next", title: "Next lecture", startsAt: NOW + HOUR }),
      ],
      reminders: [{ id: "r", title: "Soon reminder", dueAt: NOW + 10 * 60_000 }],
    });
    expect(thing).toMatchObject({ kind: "event", title: "Next lecture", key: "next" });
  });

  it("ignores cancelled events and events on another day", () => {
    const thing = pickOneThing({
      ...empty,
      occurrences: [
        occurrence({ title: "Cancelled", cancelled: true }),
        occurrence({ title: "Tomorrow", startsAt: NOW + 26 * HOUR }),
      ],
    });
    expect(thing.kind).toBe("none");
  });

  it("falls back to a reminder due within 24 hours, soonest first", () => {
    const thing = pickOneThing({
      ...empty,
      reminders: [
        { id: "far", title: "Too far", dueAt: NOW + 30 * HOUR },
        { id: "b", title: "Second", dueAt: NOW + 5 * HOUR },
        { id: "a", title: "First", dueAt: NOW + 2 * HOUR },
        { id: "past", title: "Past", dueAt: NOW - HOUR },
      ],
    });
    expect(thing).toMatchObject({ kind: "reminder", id: "a" });
  });

  it("falls back to the most recently updated pinned note", () => {
    const thing = pickOneThing({
      ...empty,
      notes: [
        { id: "old", title: "Old pinned", pinned: true, archived: false, updatedAt: 1 },
        { id: "new", title: "New pinned", pinned: true, archived: false, updatedAt: 5 },
        { id: "unpinned", title: "Unpinned", pinned: false, archived: false, updatedAt: 9 },
        { id: "archived", title: "Archived", pinned: true, archived: true, updatedAt: 10 },
      ],
    });
    expect(thing).toMatchObject({ kind: "note", id: "new" });
  });

  it("says nothing is planned when there is nothing", () => {
    expect(pickOneThing(empty)).toEqual({ kind: "none" });
  });

  it("decides 'today' in AVA's time zone, not UTC", () => {
    // 23:30 Dublin on the 25th is 22:30 UTC; an event at 23:45 Dublin is still today.
    const lateNow = Date.parse("2026-09-25T22:30:00Z");
    expect(localDate(lateNow, TZ)).toBe("2026-09-25");
    const thing = pickOneThing({ ...empty, now: lateNow, occurrences: [occurrence({ startsAt: lateNow + 15 * 60_000 })] });
    expect(thing.kind).toBe("event");
  });
});

describe("pickOneThing with sources that didn't answer", () => {
  const lecture = occurrence({ title: "Lecture", startsAt: NOW + HOUR });
  const due = { id: "r", title: "Due soon", dueAt: NOW + 2 * HOUR };
  const pinned = { id: "n", title: "Pinned", pinned: true, archived: false, updatedAt: 1 };

  it("never shows anything when the calendar is unknown", () => {
    expect(pickOneThing({ ...empty, occurrences: null, reminders: [due], notes: [pinned] })).toEqual({ kind: "unknown", missing: ["calendar"] });
    expect(pickOneThing({ ...empty, occurrences: null, reminders: null, notes: null })).toEqual({ kind: "unknown", missing: ["calendar", "reminders", "notes"] });
  });

  it("still shows a found event, because nothing outranks it", () => {
    expect(pickOneThing({ ...empty, occurrences: [lecture], reminders: null, notes: null }).kind).toBe("event");
  });

  it("does not skip unknown reminders to show a note or nothing", () => {
    expect(pickOneThing({ ...empty, occurrences: [], reminders: null, notes: [pinned] })).toEqual({ kind: "unknown", missing: ["reminders"] });
    expect(pickOneThing({ ...empty, occurrences: [], reminders: null, notes: [] })).toEqual({ kind: "unknown", missing: ["reminders"] });
  });

  it("shows a due reminder even when notes are unknown", () => {
    expect(pickOneThing({ ...empty, occurrences: [], reminders: [due], notes: null }).kind).toBe("reminder");
  });

  it("does not claim nothing is planned while notes are unknown", () => {
    expect(pickOneThing({ ...empty, occurrences: [], reminders: [], notes: null })).toEqual({ kind: "unknown", missing: ["notes"] });
  });
});

describe("suggestionsFor", () => {
  it("offers three steps tied to the one thing", () => {
    expect(suggestionsFor({ kind: "event", title: "Agile lecture", startsAt: 0, location: "", attendanceIntent: "attend", key: "k" }))
      .toEqual(["Get me ready for Agile lecture", "Plan my day", "What's due this week?"]);
    expect(suggestionsFor({ kind: "none" })).toHaveLength(3);
    expect(suggestionsFor({ kind: "note", title: "x".repeat(60), id: "n" })[0]!.length).toBeLessThanOrEqual(50);
  });
});
