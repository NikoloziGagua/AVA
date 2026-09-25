import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { getCalendarEvent, listCalendarEvents } from "../calendar/service.js";
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
    expect(result).toEqual({ ok: false, text: "invalid_timezone: Use a valid named IANA time zone, such as Europe/Dublin." });
  });
});
