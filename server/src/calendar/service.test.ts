import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import {
  archiveCalendarEvent,
  createCalendarEvent,
  endCalendarSeries,
  extendCalendarSeries,
  getCalendarEvent,
  getCalendarException,
  getCalendarOccurrence,
  queryCalendar,
  restoreCalendarEvent,
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
  it("accepts a normalized full echo after a series starts without writing", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const { source, sourceSessionId, ...echo } = base;
    const before = db.prepare("SELECT * FROM calendar_events").all();
    const result = updateCalendarEvent(db, event.id, 1, { ...echo, title: ` ${base.title} ` }, Date.parse("2026-01-20Z"));
    expect(result).toEqual(event);
    expect(db.prepare("SELECT * FROM calendar_events").all()).toEqual(before);
    expect(errorCode(() => updateCalendarEvent(db, event.id, 2, echo, Date.parse("2026-01-20Z"))))
      .toBe("stale_version");
  });

  it("keeps a default occurrence echo absent and checks the exception version first", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const patch = { movedLocalDate: null, movedLocalTime: null, movedDurationMinutes: null,
      cancelled: false, attendanceIntentOverride: "undecided" as const, attendanceOutcome: "unknown" as const };
    expect(upsertCalendarException(db, event.id, "2026-01-12", 1, null, patch, Date.parse("2026-01-20Z")))
      .toBeNull();
    expect(getCalendarException(db, event.id, "2026-01-12")).toBeNull();
    expect(upsertCalendarException(db, event.id, "2026-01-12", 1, 0, patch, JAN_1)).toBeNull();
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 1, 7, patch, JAN_1)))
      .toBe("stale_version");
  });

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
    expect(moved!.version).toBe(1);
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
    expect(updateCalendarEvent(db, event.id, 2, {}, JAN_1 + 2)).toEqual(updated);
    expect(errorCode(() => updateCalendarEvent(db, event.id, 2, { title: "Rewrite history" }, Date.parse("2026-01-20Z"))))
      .toBe("series_started");
  });

  it("allows explicit attendance outcomes on past occurrences but not past movement", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const after = Date.parse("2026-01-13T00:00:00Z");
    const exception = upsertCalendarException(db, event.id, "2026-01-12", 1, null,
      { attendanceOutcome: "attended" }, after);
    expect(exception!.attendanceOutcome).toBe("attended");
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 1, 1,
      { movedLocalTime: "10:00:00" }, after))).toBe("occurrence_started");
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

  it("requires explicit inclusion of history to archive and restores it without deleting evidence", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const now = Date.parse("2026-01-20T00:00:00Z");
    const exception = upsertCalendarException(db, event.id, "2026-01-12", 1, null, { attendanceOutcome: "attended" }, now);
    expect(errorCode(() => archiveCalendarEvent(db, event.id, 1, now))).toBe("series_started");
    expect(getCalendarEvent(db, event.id)).toEqual(event);
    const archived = archiveCalendarEvent(db, event.id, 1, now, true);
    expect(archived.archivedAt).not.toBeNull();
    const result = queryCalendar(db, Date.parse("2026-01-01Z"), Date.parse("2026-03-01Z"));
    expect(result.occurrences).toEqual([]);
    expect(result.events).toEqual([]);
    expect(getCalendarOccurrence(db, `${event.id}:2026-01-12`)).toBeNull();
    expect(getCalendarException(db, event.id, "2026-01-12")).toEqual(exception);
    expect(getCalendarEvent(db, event.id)?.version).toBe(2);
    expect(archiveCalendarEvent(db, event.id, 2, now + 1, false)).toEqual(archived);
    expect(errorCode(() => archiveCalendarEvent(db, event.id, 1, now + 1, true))).toBe("stale_version");
    expect(errorCode(() => restoreCalendarEvent(db, event.id, 1, now + 1))).toBe("stale_version");
    expect(restoreCalendarEvent(db, event.id, 2, now + 1).event).toMatchObject({ version: 3, archivedAt: null });
    expect(getCalendarOccurrence(db, `${event.id}:2026-01-12`)).toMatchObject({ attendanceOutcome: "attended" });
    expect(queryCalendar(db, Date.parse("2026-01-01Z"), Date.parse("2026-03-01Z")).occurrences).toHaveLength(5);
    expect(errorCode(() => restoreCalendarEvent(db, event.id, 3, now + 2))).toBe("not_archived");
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

  it("drops echoed historical keys but still applies a real reminder preference change", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const { source, sourceSessionId, ...echo } = base;
    const now = Date.parse("2026-01-20Z");
    const updated = updateCalendarEvent(db, event.id, 1, { ...echo, reminderMinutesBefore: 15 }, now);
    expect(updated).toEqual({ ...event, reminderMinutesBefore: 15, version: 2, updatedAt: now });
    expect(errorCode(() => updateCalendarEvent(db, event.id, 2, { ...echo, durationMinutes: 90 }, now)))
      .toBe("series_started");
    expect(errorCode(() => updateCalendarEvent(db, event.id, 2, { ...echo, title: " " }, now))).toBe("bad_request");
    expect(getCalendarEvent(db, event.id)).toEqual(updated);
    expect(db.prepare("SELECT count(*) AS n FROM watches").get()).toEqual({ n: 0 });
  });

  it("preserves existing occurrence echoes, validates first, and permits explicit override clearing", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const patch = { movedLocalTime: "10:00:00", attendanceIntentOverride: "skip" as const };
    const original = upsertCalendarException(db, event.id, "2026-01-12", 1, null, patch, JAN_1)!;
    const now = Date.parse("2026-01-20Z");
    expect(upsertCalendarException(db, event.id, "2026-01-12", 1, 1, patch, now)).toEqual(original);
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 2, 1, patch, now))).toBe("stale_version");
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 1, null, patch, now))).toBe("stale_version");
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 1, 1, { movedLocalTime: "25:00:00" }, now)))
      .toBe("bad_request");
    const cleared = upsertCalendarException(db, event.id, "2026-01-12", 1, 1, { attendanceIntentOverride: null }, now);
    expect(cleared).toMatchObject({ version: 2, attendanceIntentOverride: null, movedLocalTime: "10:00:00" });
    expect(upsertCalendarException(db, event.id, "2026-01-12", 1, 2, { attendanceIntentOverride: "undecided" }, now))
      .toEqual(cleared);
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-13", 1, null, {}, now))).toBe("occurrence_not_found");
  });

  it("preserves a future exception while ending and restores its original key on extend", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const past = upsertCalendarException(db, event.id, "2026-01-12", 1, null, { attendanceOutcome: "attended" }, JAN_1)!;
    const future = upsertCalendarException(db, event.id, "2026-02-02", 1, null, { movedLocalDate: "2026-02-03", cancelled: true }, JAN_1)!;
    const rows = db.prepare("SELECT * FROM calendar_event_exceptions ORDER BY occurrence_local_date").all();
    const now = Date.parse("2026-01-20Z");
    const ended = endCalendarSeries(db, event.id, 1, "2026-01-26", now);
    expect(ended).toMatchObject({ event: { version: 2, recurrenceUntilDate: "2026-01-19" },
      endedFromOriginalDate: "2026-01-26", previousRecurrenceUntilDate: base.recurrenceUntilDate });
    expect(queryCalendar(db, Date.parse("2026-01-01Z"), Date.parse("2026-03-01Z")).occurrences).toHaveLength(2);
    expect(getCalendarOccurrence(db, `${event.id}:2026-02-02`)).toBeNull();
    expect(getCalendarException(db, event.id, "2026-01-12")).toEqual(past);
    expect(getCalendarException(db, event.id, "2026-02-02")).toEqual(future);
    expect(errorCode(() => endCalendarSeries(db, event.id, 1, "2026-01-26", now))).toBe("stale_version");
    const extended = extendCalendarSeries(db, event.id, 2, ended.previousRecurrenceUntilDate, now + 1);
    expect(extended).toMatchObject({ event: { version: 3, recurrenceUntilDate: base.recurrenceUntilDate }, previousRecurrenceUntilDate: "2026-01-19" });
    expect(getCalendarOccurrence(db, `${event.id}:2026-02-02`)).toMatchObject({
      localStart: "2026-02-03T09:00:00", cancelled: true, exceptionVersion: 1,
    });
    expect(db.prepare("SELECT * FROM calendar_event_exceptions ORDER BY occurrence_local_date").all()).toEqual(rows);
    expect(errorCode(() => extendCalendarSeries(db, event.id, 2, ended.previousRecurrenceUntilDate, now + 1))).toBe("stale_version");
  });

  it.each([
    { patch: { movedLocalDate: "2026-01-15" }, label: "a moved occurrence already happened" },
    { patch: { attendanceOutcome: "attended" as const }, label: "a recorded outcome" },
    { patch: { cancelled: true, attendanceOutcome: "skipped" as const }, label: "a cancelled recorded outcome" },
  ])("protects end, split and historical edits when $label", ({ patch }) => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    upsertCalendarException(db, event.id, "2026-02-02", 1, null, patch, JAN_1);
    const now = Date.parse("2026-01-20Z");
    const before = db.prepare("SELECT * FROM calendar_event_exceptions").all();
    expect(errorCode(() => endCalendarSeries(db, event.id, 1, "2026-01-26", now))).toBe("history_conflict");
    expect(errorCode(() => splitCalendarEvent(db, event.id, 1, "2026-01-26", { title: "Different" }, now))).toBe("history_conflict");
    expect(errorCode(() => updateCalendarEvent(db, event.id, 1, { title: "Different" }, now))).toBe("series_started");
    expect(getCalendarEvent(db, event.id)).toEqual(event);
    expect(db.prepare("SELECT * FROM calendar_event_exceptions").all()).toEqual(before);
    expect(db.prepare("SELECT count(*) AS n FROM calendar_events").get()).toEqual({ n: 1 });
  });

  it("uses moved/history evidence even before the series anchor starts", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    upsertCalendarException(db, event.id, "2026-01-26", 1, null, { movedLocalDate: "2026-01-02" }, JAN_1);
    const now = Date.parse("2026-01-03Z");
    expect(errorCode(() => updateCalendarEvent(db, event.id, 1, { title: "New" }, now))).toBe("series_started");
    expect(errorCode(() => archiveCalendarEvent(db, event.id, 1, now))).toBe("series_started");
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-26", 1, 1, { cancelled: true }, now)))
      .toBe("occurrence_started");
  });

  it("does not let an occurrence cancelled earlier be uncancelled after its original start", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const cancelled = upsertCalendarException(db, event.id, "2026-01-12", 1, null, { cancelled: true }, JAN_1);
    expect(errorCode(() => upsertCalendarException(db, event.id, "2026-01-12", 1, 1,
      { cancelled: false }, Date.parse("2026-01-13Z")))).toBe("occurrence_started");
    expect(getCalendarException(db, event.id, "2026-01-12")).toEqual(cancelled);
  });

  it("ends around a cancelled occurrence without claiming a cancelled past outcome happened", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    upsertCalendarException(db, event.id, "2026-01-26", 1, null, { movedLocalDate: "2026-01-02", cancelled: true }, JAN_1);
    const now = Date.parse("2026-01-03Z");
    expect(endCalendarSeries(db, event.id, 1, "2026-01-26", now).event.version).toBe(2);
    // Undo still cannot re-add even a cancelled occurrence at a past effective start.
    expect(errorCode(() => extendCalendarSeries(db, event.id, 2, base.recurrenceUntilDate, now))).toBe("history_conflict");
  });

  it("extends on anchor cadence rather than old-until cadence and refuses no added occurrence", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, { ...base, recurrenceUntilDate: "2026-01-14" }, JAN_1);
    expect(errorCode(() => extendCalendarSeries(db, event.id, 1, "2026-01-18", JAN_1))).toBe("no_occurrence_added");
    expect(errorCode(() => extendCalendarSeries(db, event.id, 1, "2026-01-14", JAN_1))).toBe("no_occurrence_added");
    expect(errorCode(() => extendCalendarSeries(db, event.id, 1, "2026-01-13", JAN_1))).toBe("no_occurrence_added");
    expect(errorCode(() => extendCalendarSeries(db, event.id, 1, "2027-01-14", JAN_1))).toBe("recurrence_too_long");
    expect(getCalendarEvent(db, event.id)).toEqual(event);
    expect(extendCalendarSeries(db, event.id, 1, "2026-01-21", JAN_1).event.version).toBe(2);
    expect(queryCalendar(db, Date.parse("2026-01-01Z"), Date.parse("2026-02-01Z")).occurrences.map(o => o.originalLocalDate))
      .toEqual(["2026-01-12", "2026-01-19"]);
  });

  it("refuses extending through original or moved history and leaves retained exceptions intact", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const hidden = upsertCalendarException(db, event.id, "2026-02-02", 1, null, { movedLocalDate: "2026-01-15" }, JAN_1)!;
    endCalendarSeries(db, event.id, 1, "2026-01-26", JAN_1);
    expect(errorCode(() => extendCalendarSeries(db, event.id, 2, "2026-02-09", Date.parse("2026-01-20Z"))))
      .toBe("history_conflict");
    expect(errorCode(() => extendCalendarSeries(db, event.id, 2, "2026-02-09", Date.parse("2026-01-27Z"))))
      .toBe("history_conflict");
    expect(getCalendarException(db, event.id, "2026-02-02")).toEqual(hidden);
    expect(getCalendarEvent(db, event.id)).toMatchObject({ version: 2, recurrenceUntilDate: "2026-01-19" });
  });

  it("does not reintroduce a retained outcome, including old-version archived data", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    upsertCalendarException(db, event.id, "2026-02-02", 1, null, { attendanceOutcome: "missed" }, JAN_1);
    // Simulate a pre-v3 capped definition with an outcome outside its current bound.
    db.prepare("UPDATE calendar_events SET recurrence_until_date='2026-01-19' WHERE id=?").run(event.id);
    expect(errorCode(() => extendCalendarSeries(db, event.id, 1, "2026-02-09", JAN_1))).toBe("history_conflict");
    expect(getCalendarException(db, event.id, "2026-02-02")).toMatchObject({ attendanceOutcome: "missed", version: 1 });
  });

  it("keeps DST validation on extension and uses Dublin wall time through offset changes", () => {
    const db = openInMemoryDb();
    const input = { ...base, anchorLocalDate: "2026-03-22", recurrenceUntilDate: "2026-03-22", startLocalTime: "01:30:00" };
    const gap = createCalendarEvent(db, input, JAN_1);
    expect(errorCode(() => extendCalendarSeries(db, gap.id, 1, "2026-03-29", JAN_1))).toBe("nonexistent_local_time");
    expect(getCalendarEvent(db, gap.id)?.version).toBe(1);
    const valid = createCalendarEvent(db, { ...input, startLocalTime: "09:00:00" }, JAN_1);
    extendCalendarSeries(db, valid.id, 1, "2026-03-29", JAN_1);
    expect(queryCalendar(db, Date.parse("2026-03-21Z"), Date.parse("2026-03-30Z")).occurrences.filter(o => o.eventId === valid.id)
      .map(o => new Date(o.startsAt).toISOString())).toEqual(["2026-03-22T09:00:00.000Z", "2026-03-29T08:00:00.000Z"]);
  });

  it("rejects wrong scope, dates, versions, archived edits and no-change splits", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const single = createCalendarEvent(db, { ...base, recurrenceKind: "none", recurrenceUntilDate: null }, JAN_1);
    expect(errorCode(() => endCalendarSeries(db, "cal_missing", 1, "2026-01-19", JAN_1))).toBe("not_found");
    expect(errorCode(() => endCalendarSeries(db, single.id, 1, "2026-01-19", JAN_1))).toBe("not_weekly");
    expect(errorCode(() => extendCalendarSeries(db, single.id, 1, "2026-01-19", JAN_1))).toBe("not_weekly");
    for (const date of ["2026-01-12", "2026-01-13", "2026-02-16"]) {
      expect(errorCode(() => endCalendarSeries(db, event.id, 1, date, JAN_1))).toBe("occurrence_not_found");
    }
    expect(errorCode(() => endCalendarSeries(db, event.id, 1, "2026-01-19", Date.parse("2026-01-19T09:00:00Z"))))
      .toBe("occurrence_started");
    expect(errorCode(() => splitCalendarEvent(db, event.id, 1, "2026-01-19", { title: ` ${base.title} ` }, JAN_1))).toBe("bad_request");
    expect(errorCode(() => splitCalendarEvent(db, event.id, 1, "2026-01-19", { anchorLocalDate: "2026-01-13" }, JAN_1))).toBe("field_not_in_scope");
    archiveCalendarEvent(db, event.id, 1, JAN_1);
    const operations = [
      () => updateCalendarEvent(db, event.id, 2, {}, JAN_1),
      () => upsertCalendarException(db, event.id, "2026-01-12", 2, null, {}, JAN_1),
      () => endCalendarSeries(db, event.id, 2, "2026-01-19", JAN_1),
      () => extendCalendarSeries(db, event.id, 2, "2026-02-16", JAN_1),
      () => splitCalendarEvent(db, event.id, 2, "2026-01-19", { title: "new" }, JAN_1),
    ];
    for (const operation of operations) expect(errorCode(operation)).toBe("archived");
    expect(getCalendarEvent(db, event.id)?.version).toBe(2);
  });

  it("rolls a split back if new definition insertion fails", () => {
    const db = openInMemoryDb();
    const event = createCalendarEvent(db, base, JAN_1);
    const exception = upsertCalendarException(db, event.id, "2026-02-02", 1, null, { cancelled: true }, JAN_1);
    db.exec("CREATE TEMP TRIGGER fail_split BEFORE INSERT ON calendar_events BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect(() => splitCalendarEvent(db, event.id, 1, "2026-01-26", { title: "new" }, JAN_1)).toThrow("fixture failure");
    expect(getCalendarEvent(db, event.id)).toEqual(event);
    expect(getCalendarException(db, event.id, "2026-02-02")).toEqual(exception);
    expect(db.prepare("SELECT count(*) AS n FROM calendar_events").get()).toEqual({ n: 1 });
  });

  it("preserves lifecycle state on restart and guards competing SQLite connections", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { openDb } = await import("../state/db.js");
    const dir = mkdtempSync(join(tmpdir(), "ava-calendar-"));
    const path = join(dir, "state.db");
    try {
      const first = openDb(path);
      const event = createCalendarEvent(first, base, JAN_1);
      const exception = upsertCalendarException(first, event.id, "2026-02-02", 1, null, { cancelled: true }, JAN_1);
      const ended = endCalendarSeries(first, event.id, 1, "2026-01-26", JAN_1);
      first.close();
      const second = openDb(path);
      const competing = openDb(path);
      expect(getCalendarEvent(second, event.id)).toEqual(ended.event);
      expect(getCalendarEvent(competing, event.id)).toEqual(ended.event);
      archiveCalendarEvent(second, event.id, 2, JAN_1);
      expect(errorCode(() => extendCalendarSeries(competing, event.id, 2, base.recurrenceUntilDate, JAN_1)))
        .toBe("stale_version");
      expect(restoreCalendarEvent(competing, event.id, 3, JAN_1).event.version).toBe(4);
      expect(errorCode(() => restoreCalendarEvent(second, event.id, 3, JAN_1))).toBe("stale_version");
      expect(extendCalendarSeries(second, event.id, 4, base.recurrenceUntilDate, JAN_1).event.version).toBe(5);
      competing.close();
      second.close();
      const reopened = openDb(path);
      expect(getCalendarEvent(reopened, event.id)).toMatchObject({ version: 5, archivedAt: null, recurrenceUntilDate: base.recurrenceUntilDate });
      expect(getCalendarException(reopened, event.id, "2026-02-02")).toEqual(exception);
      expect(queryCalendar(reopened, Date.parse("2026-01-01Z"), Date.parse("2026-03-01Z")).occurrences).toHaveLength(5);
      reopened.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
