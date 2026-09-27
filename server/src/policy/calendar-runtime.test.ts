import { afterEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { createRule } from "../state/rules.js";
import { buildCalendarTools } from "../tools/calendar-mcp.js";
import { listCalendarEvents } from "../calendar/service.js";
import { buildPolicyHook, type PolicyEvent } from "./runtime.js";

const databases: Db[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.useRealTimers(); });
const lecture = {
  title: "Fixture lecture", kind: "lecture", time_zone: "Europe/Dublin",
  anchor_local_date: "2027-01-11", start_local_time: "09:00:00", duration_minutes: 60,
  recurrence_kind: "weekly", recurrence_until_date: "2027-02-08",
};
function fixture() {
  const db = openInMemoryDb(); databases.push(db);
  const sessionId = createSession(db, { title: "Calendar policy fixture" }).id;
  const events: PolicyEvent[] = [];
  const policy = buildPolicyHook({ db, sessionId, emit: event => events.push(event) });
  const tools = buildCalendarTools({ db, sessionId, source: "ava_voice", now: () => Date.parse("2027-01-01Z") });
  const run = async (name: string, args: Record<string, unknown>) => {
    const gate = await policy(name, args);
    if (!gate.allow) return { ok: false, text: gate.message };
    return tools.find(t => t.tool.name === name)!.run(args, { runId: "fixture" });
  };
  return { db, events, run };
}

describe("calendar through shared policy and real SQLite service", () => {
  it.each(["none", "weekly"])("does not create an approval or timer for %s add and query", async recurrence_kind => {
    const { db, events, run } = fixture();
    vi.useFakeTimers();
    const add = await run("calendar_add", { ...lecture, recurrence_kind,
      recurrence_until_date: recurrence_kind === "weekly" ? lecture.recurrence_until_date : undefined });
    expect(add.ok).toBe(true);
    const query = await run("calendar_query", { view: "week", local_date: "2027-01-11" });
    expect(query.ok).toBe(true);
    expect(JSON.parse(query.text).occurrences).toHaveLength(1);
    expect(listCalendarEvents(db)).toHaveLength(1);
    expect(events).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["calendar_add", "calendar_query"])("honours a standing deny rule for %s", async tool => {
    const { db, run, events } = fixture();
    createRule(db, { source: "Fixture denial", status: "active", parsed: JSON.stringify({ match: { tool }, action: "deny" }) });
    expect(await run(tool, lecture)).toMatchObject({ ok: false, text: expect.stringContaining("BLOCKED") });
    expect(listCalendarEvents(db)).toHaveLength(0);
    expect(events).toEqual([]);
  });
  it.each([
    { recurrence_until_date: "2029-01-11" },
    { time_zone: "invalid-zone" },
    { duration_minutes: -1 },
    { anchor_local_date: "2027-02-30" },
  ])("still rejects invalid service inputs without writing: %j", async patch => {
    const { db, run } = fixture();
    expect((await run("calendar_add", { ...lecture, ...patch })).ok).toBe(false);
    expect(listCalendarEvents(db)).toHaveLength(0);
  });
});
