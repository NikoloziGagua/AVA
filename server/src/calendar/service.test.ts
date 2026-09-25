import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import {
  archiveCalendarEvent,
  createCalendarEvent,
  getCalendarEvent,
  getCalendarException,
  queryCalendar,
  splitCalendarEvent,
  updateCalendarEvent,
  upsertCalendarException,
} from "./service.js";
import { CalendarError } from "./types.js";

const JAN_1 = Date.parse("2026-01-01T00:00:00Z");
const base = {
  title: "Agile Development",
  kind: "lecture" as const,
  timeZone: "Europe/Dublin",
  anchorLocalDate: "2026-01-12",
  startLocalTime: "09:00:00",
  durationMinutes: 60,
  recurrenceKind: "weekly" as const,
  recurrenceUntilDate: "2026-02-09",
  source: "ava_chat" as const,
  sourceSessionId: "session-1",
};

function errorCode(fn: () => unknown): string | undefined {
  try { fn(); } catch (error) { return error instanceof CalendarError ? error.code : undefined; }
  return undefined;
}

describe("calendar authority", () => {
  it("creates and projects stable weekly occurrences through Dublin wall time", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const result = queryCalendar(db, Date.parse("2026-01-10Z"), Date.parse("2026-02-12Z"), "Europe/Dublin", JAN_1);
    expect(result.events).toHaveLength(1);
    expect(result.occurrences).toHaveLength(5);
    expect(result.occurrences.map((o) => o.occurrenceKey)).toEqual([
      `${event.id}:2026-01-12`, `${event.id}:2026-01-19`, `${event.id}:2026-01-26`,
      `${event.id}:2026-02-02`, `${event.id}:2026-02-09`,
    ]);
    expect(result.occurrences[0]).toMatchObject({ localStart: "2026-01-12T09:00:00", attendanceOutcome: "unknown" });
  });

  it("moves and cancels occurrences without changing their stable original key", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const moved = upsertCalendarException(db, event.id, "2026-01-19", 1, null, {
      movedLocalDate: "2026-01-20", movedLocalTime: "11:30:00", attendanceIntentOverride: "skip",
    }, JAN_1 + 1);
    expect(moved.version).toBe(1);
    upsertCalendarException(db, event.id, "2026-01-26", 1, null, { cancelled: true }, JAN_1 + 2);
    const result = queryCalendar(db, Date.parse("2026-01-18Z"), Date.parse("2026-01-28Z"));
    expect(result.occurrences[0]).toMatchObject({
      occurrenceKey: `${event.id}:2026-01-19`, localStart: "2026-01-20T11:30:00", moved: true, attendanceIntent: "skip",
    });
    expect(result.occurrences[1]).toMatchObject({ occurrenceKey: `${event.id}:2026-01-26`, cancelled: true });
  });

  it("guards stale writes and refuses schedule rewrites after history begins", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const updated = updateCalendarEvent(db, event.id, 1, { reminderMinutesBefore: 20 }, JAN_1 + 1);
    expect(updated.version).toBe(2);
    expect(errorCode(() => updateCalendarEvent(db, event.id, 1, { reminderMinutesBefore: 10 }, JAN_1 + 2)))
      .toBe("stale_version");
    expect(errorCode(() => updateCalendarEvent(db, event.id, 2, {}, JAN_1 + 2))).toBe("bad_request");
    expect(errorCode(() => updateCalendarEvent(db, event.id, 2, { title: "Rewrite history" }, Date.parse("2026-01-20Z"))))
      .toBe("bad_request");
  });

  it("allows explicit attendance outcomes on past occurrences but not past movement", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const after = Date.parse("2026-01-13T00:00:00Z");
    const exception = upsertCalendarException(db, event.id, "2026-01-12", 1, null,
      { attendanceOutcome: "attended" }, after);
    expect(exception.attendanceOutcome).toBe("attended");
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 1, 1,
      { movedLocalTime: "10:00:00" }, after))).toBe("bad_request");
  });

  it("splits this-and-following without rewriting prior occurrences", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    upsertCalendarException(db, event.id, "2026-02-02", 1, null, { attendanceIntentOverride: "skip" }, JAN_1);
    const split = splitCalendarEvent(db, event.id, 1, "2026-01-26", { startLocalTime: "10:00:00" }, JAN_1);
    expect(split.previous.recurrenceUntilDate).toBe("2026-01-19");
    expect(split.next).toMatchObject({ anchorLocalDate: "2026-01-26", startLocalTime: "10:00:00", splitFromEventId: event.id });
    expect(getCalendarException(db, split.next.id, "2026-02-02")?.attendanceIntentOverride).toBe("skip");
    expect(getCalendarException(db, event.id, "2026-02-02")).toBeNull();
    const all = queryCalendar(db, Date.parse("2026-01-10Z"), Date.parse("2026-02-12Z"));
    expect(all.occurrences.map((o) => [o.originalLocalDate, o.localStart])).toEqual([
      ["2026-01-12", "2026-01-12T09:00:00"], ["2026-01-19", "2026-01-19T09:00:00"],
      ["2026-01-26", "2026-01-26T10:00:00"], ["2026-02-02", "2026-02-02T10:00:00"],
      ["2026-02-09", "2026-02-09T10:00:00"],
    ]);
  });

  it("archives future occurrences while preserving prior schedule history", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const archived = archiveCalendarEvent(db, event.id, 1, Date.parse("2026-01-20T00:00:00Z"));
    expect(archived.archivedAt).not.toBeNull();
    const result = queryCalendar(db, Date.parse("2026-01-01Z"), Date.parse("2026-03-01Z"));
    expect(result.occurrences.map((o) => o.originalLocalDate)).toEqual(["2026-01-12", "2026-01-19"]);
    expect(getCalendarEvent(db, event.id)?.version).toBe(2);
  });

  it("rejects invalid recurrence, range and DST definitions", () => {
    const db = openInMemoryDb();
    expect(errorCode(() => createCalendarEvent(db, { ...base, recurrenceUntilDate: "2027-02-09" }, JAN_1)))
      .toBe("recurrence_too_long");
    expect(errorCode(() => createCalendarEvent(db, {
      ...base, recurrenceKind: "none", recurrenceUntilDate: null,
      anchorLocalDate: "2026-03-29", startLocalTime: "01:30:00",
    }, JAN_1))).toBe("nonexistent_local_time");
    expect(errorCode(() => queryCalendar(db, 0, 91 * 86_400_000))).toBe("invalid_range");
  });

  it("is durable across reopening the same database", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { openDb } = await import("../state/db.js");
    const dir = mkdtempSync(join(tmpdir(), "ava-calendar-"));
    const path = join(dir, "state.db");
    try {
      const first = openDb(path);
      const event = createCalendarEvent(first, base, JAN_1);
      first.close();
      const second = openDb(path);
      expect(getCalendarEvent(second, event.id)).toMatchObject({ title: base.title, version: 1 });
      second.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
