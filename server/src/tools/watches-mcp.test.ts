import { afterEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createWatch, getWatch, recordCodexCompleted, recordCodexSuccessor } from "../state/watches.js";
import { buildWatchTools } from "./watches-mcp.js";
import { ObservabilityService } from "../observability/store.js";
import { CommunicationObservabilityRecorder, communicationRunId } from "../observability/communications.js";

describe("watch_create tool", () => {
  it("bounds one-off reminder content without changing legacy monitor limits", async () => {
    const db = openInMemoryDb();
    const create = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_create")!;
    expect(await create.run({ prompt: "x".repeat(2001), kind: "reminder", run_in_minutes: 1, time_zone: "UTC" })).toMatchObject({ ok: false });
    expect(db.prepare("SELECT count(*) n FROM watches").get()).toEqual({ n: 0 });
    expect(await create.run({ prompt: "x".repeat(2001), kind: "check", interval_minutes: 5 })).toMatchObject({ ok: true });
    db.close();
  });
  it("keeps ordinary AVA monitors on the shared scheduler path", async () => {
    const db = openInMemoryDb();
    const create = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_create")!;
    const result = await create.run({ prompt: "check Instagram inbox", interval_minutes: 15, once: false }, { runId: "test-run" });

    expect(result.ok).toBe(true);
    const watch = db.prepare("SELECT * FROM watches").get() as { kind: string; target_thread_id: string | null };
    expect(watch).toMatchObject({ kind: "check", target_thread_id: null });
  });

  it("pins Codex target identity and cycle ancestry", async () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    new CommunicationObservabilityRecorder(observability).ensureStarted({
      source: "codex_watcher",
      sourceId: "previous-watch",
      runtimeType: "codex",
      title: "Previous Codex watcher",
      requestSummary: "previous task",
    });
    const target = { threadId: "thread-exact", sessionFile: "C:/sessions/exact.jsonl", cwd: "C:/repo/AVA" };
    const create = buildWatchTools({ db, resolveCodexTarget: () => target, observability })
      .find((entry) => entry.tool.name === "watch_create")!;
    const result = await create.run({
      prompt: "build notes",
      kind: "codex",
      interval_minutes: 1,
      continue_cycle: true,
      parent_watch_id: "previous-watch",
    }, { runId: "missing-chat-parent" });

    expect(result).toMatchObject({ ok: true });
    const id = /\(([A-Za-z0-9_-]+)\)/.exec(result.text)?.[1];
    expect(getWatch(db, id!)).toMatchObject({
      kind: "codex",
      target_thread_id: "thread-exact",
      target_session_file: "C:/sessions/exact.jsonl",
      target_cwd: "C:/repo/AVA",
      continue_cycle: 1,
      parent_watch_id: "previous-watch",
    });
    expect(observability.getRun(communicationRunId("codex_watcher", id!))).toMatchObject({
      parentRunId: communicationRunId("codex_watcher", "previous-watch"),
      traceId: observability.getRun(communicationRunId("codex_watcher", "previous-watch"))?.traceId,
      runtimeType: "codex",
      status: "queued",
    });
  });

  it("refuses an unpinned Codex watch", async () => {
    const db = openInMemoryDb();
    const create = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_create")!;
    const result = await create.run({ prompt: "build notes", kind: "codex", interval_minutes: 1 }, { runId: "test-run" });
    expect(result).toMatchObject({ ok: false });
    expect(result.text).toContain("no active Codex TUI thread");
  });

  it("normalizes an empty root-cycle parent to NULL", async () => {
    const db = openInMemoryDb();
    const target = { threadId: "thread-root", sessionFile: "C:/sessions/root.jsonl", cwd: "C:/repo/AVA" };
    const create = buildWatchTools({ db, resolveCodexTarget: () => target })
      .find((entry) => entry.tool.name === "watch_create")!;
    await create.run({
      prompt: "first cycle task",
      kind: "codex",
      interval_minutes: 1,
      parent_watch_id: "   ",
    }, { runId: "test-run" });
    const watch = db.prepare("SELECT parent_watch_id FROM watches").get() as { parent_watch_id: string | null };
    expect(watch.parent_watch_id).toBeNull();
  });

  it("lists completed task state separately from blocked successor planning", async () => {
    const db = openInMemoryDb();
    const created = createWatch(db, {
      prompt: "completed task",
      kind: "codex",
      intervalMinutes: 1,
      target: { threadId: "thread-list", sessionFile: "C:/sessions/list.jsonl", cwd: "C:/repo/AVA" },
      continueCycle: true,
    });
    recordCodexCompleted(db, created.id, 10);
    recordCodexSuccessor(db, created.id, {
      status: "blocked",
      result: "AVA provider quota exhausted",
      now: 11,
    });
    const list = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_list")!;
    const result = await list.run({}, { runId: "test-run" });
    expect(result.text).toContain("last: completed");
    expect(result.text).toContain("next: blocked (AVA provider quota exhausted)");
  });
});

describe("one-off reminder tool schedules", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  afterEach(() => { vi.restoreAllMocks(); });

  function setup() {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = openInMemoryDb();
    const tools = buildWatchTools({ db });
    return {
      db,
      create: tools.find((entry) => entry.tool.name === "watch_create")!,
      list: tools.find((entry) => entry.tool.name === "watch_list")!,
    };
  }

  it("advertises full explicit dates and timezone requirements", () => {
    const { create } = setup();
    expect(create.tool.inputSchema.properties).toHaveProperty("at");
    expect(create.tool.inputSchema.properties).toHaveProperty("time_zone");
    expect(create.tool.description).toContain("Creation proves scheduling, not phone delivery");
    expect(create.tool.description).not.toContain("Free, instant");
  });

  it("preserves the exact explicit-offset instant and zone and reports scheduling, not delivery", async () => {
    const { db, create, list } = setup();
    const result = await create.run({
      prompt: "Submit the report", kind: "reminder",
      at: "2026-10-25T01:30:00+01:00", time_zone: "Europe/London",
    }, { runId: "test-reminder" });
    expect(result.ok).toBe(true);
    const id = /\(([A-Za-z0-9_-]+)\)/.exec(result.text)?.[1];
    expect(getWatch(db, id!)).toMatchObject({
      kind: "reminder", run_at: Date.parse("2026-10-25T00:30:00Z"),
      time_zone: "Europe/London", once: 1, enabled: 1, last_run_at: null,
    });
    expect(result.text).toContain("reminder scheduled");
    expect(result.text).toContain("2026-10-25T00:30:00.000Z");
    expect(result.text).toContain("phone receipt are not yet confirmed");
    expect(result.text).not.toContain("delivered");
    const status = JSON.parse(result.text.split("\nreminder_status: ")[1]!);
    expect(status).toMatchObject({ version: 1, state: "scheduled", attempts: 0, timeZone: "Europe/London", phoneReceipt: "unconfirmed" });
    const listed = await list.run({}, { runId: "test-list" });
    expect(listed.text).toContain('"state":"scheduled"');
    expect(listed.text).toContain("[Europe/London]");
    expect(listed.text).toContain("phone receipt unconfirmed");
    db.close();
  });

  it("resolves strict numeric relative minutes from the captured clock with a required timezone", async () => {
    const { db, create } = setup();
    const result = await create.run({
      prompt: "Take a break", kind: "reminder", run_in_minutes: 1.5, time_zone: "UTC",
    }, { runId: "test-reminder" });
    expect(result.ok).toBe(true);
    const watch = db.prepare("SELECT run_at,time_zone FROM watches").get();
    expect(watch).toEqual({ run_at: now + 90_000, time_zone: "UTC" });
    db.close();
  });

  it.each([
    { run_in_minutes: 5 },
    { run_in_minutes: "5", time_zone: "UTC" },
    { run_in_minutes: true, time_zone: "UTC" },
    { run_in_minutes: Infinity, time_zone: "UTC" },
    { run_in_minutes: 0, time_zone: "UTC" },
    { run_in_minutes: 0.000001, time_zone: "UTC" },
    { run_in_minutes: 366 * 24 * 60 + 1, time_zone: "UTC" },
    { run_in_minutes: 5, time_zone: "+01:00" },
    { run_in_minutes: 5, time_zone: "UTC", once: false },
    { run_in_minutes: 5, time_zone: "UTC", daily_at: "09:00" },
    { run_in_minutes: 5, time_zone: "UTC", interval_minutes: 10 },
    { at_local: "09:00" },
    { at_local: "09:00", time_zone: "Europe/London" },
    { at: "2026-02-01T09:00:00Z" },
    { at: "2026-02-01T09:00:00", time_zone: "UTC" },
    { at: "2026-02-30T09:00:00Z", time_zone: "UTC" },
    { at: "2026-02-01T09:00:00Z", time_zone: "UTC", run_in_minutes: 5 },
    { at: "2026-02-01T09:00:00Z", time_zone: "UTC", daily_at: "09:00" },
  ])("rejects invalid/conflicting reminder input without storing a watch: %j", async (schedule) => {
    const { db, create } = setup();
    const result = await create.run({ prompt: "Reminder", kind: "reminder", ...schedule }, { runId: "test-reminder" });
    expect(result.ok).toBe(false);
    expect(result.text.length).toBeLessThan(300);
    expect(db.prepare("SELECT count(*) AS n FROM watches").get()).toEqual({ n: 0 });
    db.close();
  });

  it("preserves legacy recurring reminder schedules", async () => {
    const { db, create } = setup();
    expect((await create.run({ prompt: "Stand up", kind: "reminder", daily_at: "09:00", once: false }, { runId: "daily" })).ok).toBe(true);
    expect((await create.run({ prompt: "Stretch", kind: "reminder", interval_minutes: 30, once: false }, { runId: "interval" })).ok).toBe(true);
    const rows = db.prepare("SELECT daily_at,interval_minutes,run_at,once FROM watches ORDER BY prompt").all();
    expect(rows).toEqual([
      { daily_at: "09:00", interval_minutes: 1440, run_at: null, once: 0 },
      { daily_at: null, interval_minutes: 30, run_at: null, once: 0 },
    ]);
    db.close();
  });

  it("preserves existing relative check and Codex scheduling", async () => {
    const { db, create } = setup();
    const check = await create.run({ prompt: "Check the report", kind: "check", run_in_minutes: 10 }, { runId: "check" });
    expect(check.ok).toBe(true);
    const codexCreate = buildWatchTools({ db, resolveCodexTarget: () => ({ threadId: "exact", sessionFile: "C:/sessions/exact.jsonl", cwd: "C:/repo/AVA" }) })
      .find((entry) => entry.tool.name === "watch_create")!;
    expect((await codexCreate.run({ prompt: "Inspect report", kind: "codex", run_in_minutes: 20 }, { runId: "codex" })).ok).toBe(true);
    expect(db.prepare("SELECT kind,run_at FROM watches ORDER BY run_at").all()).toEqual([
      { kind: "check", run_at: now + 600_000 }, { kind: "codex", run_at: now + 1_200_000 },
    ]);
    db.close();
  });

  it("does not promote historical delivered prose into a receipt", async () => {
    const { db, list } = setup();
    const watch = createWatch(db, { prompt: "Historical reminder", kind: "reminder", runAt: now + 60_000, timeZone: "UTC" });
    db.prepare("DELETE FROM reminder_occurrences WHERE watch_id=?").run(watch.id);
    db.prepare("UPDATE watches SET last_run_at=?,last_status='triggered',last_result='reminder delivered',enabled=0 WHERE id=?").run(now, watch.id);
    const result = await list.run({}, { runId: "test-list" });
    expect(result.text).toContain("delivery not recorded; phone receipt unconfirmed");
    expect(result.text).not.toContain("reminder delivered");
    expect(result.text).not.toContain("reminder_status:");
    db.close();
  });

  it("keeps malformed historical dates readable without inventing schedule evidence", async () => {
    const { db, list } = setup();
    const watch = createWatch(db, { prompt: "Old malformed time", kind: "reminder", runAt: now + 60_000, timeZone: "UTC" });
    db.prepare("DELETE FROM reminder_occurrences WHERE watch_id=?").run(watch.id);
    db.prepare("UPDATE watches SET run_at=?,time_zone=NULL WHERE id=?").run(1e20, watch.id);
    const result = await list.run({}, { runId: "test-list" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("schedule unknown");
    expect(result.text).toContain("delivery not recorded");
    db.close();
  });
});
