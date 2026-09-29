import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { getCalendarEvent, getCalendarException, listCalendarEvents } from "../calendar/service.js";
import { buildCalendarTools } from "./calendar-mcp.js";

const NOW = Date.parse("2027-01-01T00:00:00Z");

function tool(source: "ava_chat" | "ava_voice" = "ava_chat") {
  const db = openInMemoryDb();
  const tools = buildCalendarTools({ db, source, sessionId: `${source}-session`, now: () => NOW });
  const find = (name: string) => tools.find((entry) => entry.tool.name === name)!;
  return { db, find };
}

const lecture = {
  title: "Agile Development",
  kind: "lecture",
  time_zone: "Europe/Dublin",
  anchor_local_date: "2027-01-11",
  start_local_time: "09:00:00",
  duration_minutes: 60,
  recurrence_kind: "weekly",
  recurrence_until_date: "2027-02-08",
  attendance_intent: "attend",
};

describe("calendar AVA tools", () => {
  it.each(["ava_chat", "ava_voice"] as const)("uses the same authority from %s", async (source) => {
    const { db, find } = tool(source);
    const result = await find("calendar_add").run(lecture, { runId: "run-1" });
    expect(result.ok).toBe(true);
    expect(listCalendarEvents(db)[0]).toMatchObject({ source, sourceSessionId: `${source}-session`, version: 1 });
  });

  it("queries day/week by local wall-clock and returns stable versions", async () => {
    const { find } = tool();
    await find("calendar_add").run(lecture, { runId: "run-1" });
    const result = await find("calendar_query").run({
      view: "week", local_date: "2027-01-11", time_zone: "Europe/Dublin",
    }, { runId: "run-2" });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.text);
    expect(parsed.occurrences).toHaveLength(1);
    expect(parsed.occurrences[0]).toMatchObject({ originalLocalDate: "2027-01-11", eventVersion: 1 });
    const range = await find("calendar_query").run({
      from: Date.parse("2027-01-10Z"), to: Date.parse("2027-01-12Z"),
    }, { runId: "run-3" });
    expect(range.ok).toBe(true);
    expect(JSON.parse(range.text).occurrences).toHaveLength(1);
  });

  it("requires exact ids/versions and fails closed on stale updates", async () => {
    const { db, find } = tool();
    await find("calendar_add").run(lecture, { runId: "run-1" });
    const event = listCalendarEvents(db)[0]!;
    const updated = await find("calendar_update").run({
      event_id: event.id, scope: "series", expected_version: 1, location: "Room A",
    }, { runId: "run-2" });
    expect(updated.ok).toBe(true);
    const stale = await find("calendar_update").run({
      event_id: event.id, scope: "series", expected_version: 1, location: "Room B",
    }, { runId: "run-3" });
    expect(stale).toMatchObject({ ok: false });
    expect(stale.text).toContain("stale_version");
    expect(getCalendarEvent(db, event.id)?.location).toBe("Room A");
  });

  it("records explicit attendance without inferring outcomes", async () => {
    const { db, find } = tool();
    await find("calendar_add").run(lecture, { runId: "run-1" });
    const event = listCalendarEvents(db)[0]!;
    const result = await find("calendar_set_attendance").run({
      event_id: event.id, scope: "occurrence", expected_version: 1,
      expected_exception_version: null, original_local_date: "2027-01-11",
      attendance_intent: "skip", attendance_outcome: "skipped",
    }, { runId: "run-2" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('"attendanceOutcome":"skipped"');
  });

  it("stores a reminder preference without claiming transport delivery", async () => {
    const { db, find } = tool();
    await find("calendar_add").run(lecture, { runId: "run-1" });
    const event = listCalendarEvents(db)[0]!;
    const result = await find("calendar_remind").run({
      event_id: event.id, expected_version: 1, minutes_before: 30,
    }, { runId: "run-2" });
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain("delivery is not active");
    expect(getCalendarEvent(db, event.id)?.reminderMinutesBefore).toBe(30);
  });

  it("never reflects invalid zone input in tool failures", async () => {
    const { find } = tool();
    const result = await find("calendar_add").run({ ...lecture, time_zone: "Europe/private-secret" }, { runId: "run-1" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("invalid_timezone:");
    expect(result.text).not.toContain("private-secret");
    expect(result.text).toMatch(/Do not repeat the same call\.$/);
  });

  it("normalizes a strict full echo on a started series without changing its version", async () => {
    const { db, find } = tool();
    await find("calendar_add").run({ ...lecture, anchor_local_date: "2026-12-21", recurrence_until_date: "2027-02-08" }, { runId: "seed" });
    const base = listCalendarEvents(db)[0]!;
    const echo = { ...lecture, anchor_local_date: base.anchorLocalDate, description: "", location: "", dst_policy: "reject",
      notes_folder_id: null, reminder_minutes_before: null, cancelled: false, moved_local_date: null, moved_local_time: null,
      moved_duration_minutes: null, event_id: base.id, scope: "series", expected_version: 1 };
    const result = await find("calendar_update").run(echo, { runId: "echo" });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ changed: false, event: base, message: "Nothing changed; the calendar already matches." });
    expect(getCalendarEvent(db, base.id)).toEqual(base);
    const changed = await find("calendar_update").run({ ...echo, title: "Changed history" }, { runId: "change" });
    expect(changed.ok).toBe(false);
    expect(changed.text).toContain("series_started:");
    expect(changed.text).toContain("calendar_end_series");
    expect(changed.text).toMatch(/Do not repeat the same call\.$/);
  });

  it.each(["series", "following"])("refuses cancellation or a non-null move on %s without creating a split", async scope => {
    const { db, find } = tool();
    await find("calendar_add").run(lecture, { runId: "seed" });
    const base = listCalendarEvents(db)[0]!;
    const args = { event_id: base.id, scope, expected_version: 1, original_local_date: "2027-01-18", title: "Must not split" };
    for (const patch of [{ cancelled: true }, { moved_local_date: "2027-01-19" }, { moved_local_time: "10:00:00" }, { moved_duration_minutes: 20 }]) {
      const result = await find("calendar_update").run({ ...args, ...patch }, { runId: "refuse" });
      expect(result.ok).toBe(false);
      expect(result.text).toContain("cancelled" in patch ? "cancel_scope_unsupported:" : "field_not_in_scope:");
      expect(result.text).toMatch(/Do not repeat the same call\.$/);
      expect(listCalendarEvents(db)).toEqual([base]);
    }
    const stale = await find("calendar_update").run({ ...args, expected_version: 9, cancelled: true }, { runId: "stale" });
    expect(stale.text).toContain("stale_version:");
  });

  it.each(["calendar_update", "calendar_set_attendance"])("%s returns an explicit no-op for an inherited occurrence intent", async name => {
    const { db, find } = tool();
    await find("calendar_add").run(lecture, { runId: "seed" });
    const base = listCalendarEvents(db)[0]!;
    const args = { event_id: base.id, scope: "occurrence", expected_version: 1, expected_exception_version: null,
      original_local_date: "2027-01-11", attendance_intent: "attend", attendance_outcome: "unknown", cancelled: false };
    const result = await find(name).run(args, { runId: "echo" });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ changed: false, exception: null, message: "Nothing changed; the calendar already matches." });
    expect(getCalendarException(db, base.id, "2027-01-11")).toBeNull();
    const stale = await find(name).run({ ...args, expected_exception_version: 1 }, { runId: "stale" });
    expect(stale).toMatchObject({ ok: false });
    expect(stale.text).toContain("stale_version:");
  });

  it("ends a series and removes duplicate started definitions through exact versioned tools", async () => {
    const { db, find } = tool();
    await find("calendar_add").run(lecture, { runId: "seed" });
    const base = listCalendarEvents(db)[0]!;
    const end = await find("calendar_end_series").run({ event_id: base.id, expected_version: 1, from_original_date: "2027-01-25" }, { runId: "end" });
    expect(end.ok).toBe(true);
    expect(JSON.parse(end.text)).toMatchObject({ event: { id: base.id, version: 2, recurrenceUntilDate: "2027-01-18" }, endedFromOriginalDate: "2027-01-25", previousRecurrenceUntilDate: "2027-02-08" });
    const stale = await find("calendar_end_series").run({ event_id: base.id, expected_version: 1, from_original_date: "2027-01-18" }, { runId: "stale" });
    expect(stale.text).toContain("stale_version:");
    for (let i = 0; i < 2; i++) {
      await find("calendar_add").run({ ...lecture, anchor_local_date: "2026-12-21" }, { runId: "duplicate" });
      const duplicate = listCalendarEvents(db).find(e => e.id !== base.id && e.archivedAt === null)!;
      const args = { event_id: duplicate.id, expected_version: 1, include_history: false };
      const refused = await find("calendar_remove").run(args, { runId: "refused" });
      expect(refused.text).toContain("series_started:");
      const removed = await find("calendar_remove").run({ ...args, include_history: true }, { runId: "remove" });
      expect(removed.ok).toBe(true);
      expect(JSON.parse(removed.text)).toMatchObject({ changed: true, event: { id: duplicate.id, version: 2, archivedAt: NOW } });
      expect(removed.text).not.toContain("undo it in Calendar");
    }
    // Removed events stay stored but never show: only the ended series remains visible.
    expect(listCalendarEvents(db).filter(e => e.archivedAt === null)).toEqual([getCalendarEvent(db, base.id)]);
    const week = await find("calendar_query").run({ view: "week", local_date: "2027-01-11" }, { runId: "query" });
    expect(new Set(JSON.parse(week.text).occurrences.map((o: { eventId: string }) => o.eventId))).toEqual(new Set([base.id]));
  });

  it.each(["calendar_end_series", "calendar_remove"])("%s rejects malformed identity/version input without mutations", async name => {
    const { db, find } = tool();
    for (const args of [{}, { event_id: "x", expected_version: 0 }, { event_id: "x", expected_version: 1.2 }]) {
      const result = await find(name).run(args, { runId: "bad" });
      expect(result.ok).toBe(false);
      expect(result.text).toContain("bad_request:");
    }
    expect(listCalendarEvents(db)).toEqual([]);
  });
});
