import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "./db.js";
import { createSession, getSession, markHumanActivity, setStatus, listByStatus, softDeleteSession } from "./sessions.js";
import { appendMessage, listMessages } from "./messages.js";
import { PidfileRegistry } from "../process/pidfile.js";
import { runRecovery, snapshotInterruptedConversationTasks, recordInterruptedConversationTasks } from "./recovery.js";
import { ObservabilityService } from "../observability/store.js";

let dir: string;
let db: Db;
let pidfiles: PidfileRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-rec-"));
  db = openDb(join(dir, "x.db"));
  pidfiles = new PidfileRegistry(join(dir, "pidfiles"));
});

afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

function startTask(sessionId: string, id: string, runKind = "chat_agent") {
  const service = new ObservabilityService(db);
  return service.startRun({ id, sessionId, runKind, runtimeType: "ava", ownerType: "ava", title: "Fixture task" });
}

describe("runRecovery", () => {
  it("kills orphaned worker pids from previous runs and clears the registry", async () => {
    pidfiles.add("oldRun", 12345);
    pidfiles.add("oldRun", 67890);
    const killed: number[] = [];
    await runRecovery({
      db,
      pidfiles,
      kill: async (pid) => { killed.push(pid); return true; },
    });
    expect(killed.sort()).toEqual([12345, 67890]);
    expect(pidfiles.listAll()).toEqual([]);
  });

  it("does not infer interrupted work from active sessions or idle voice connections", async () => {
    const a = createSession(db, { title: "a" });
    const b = createSession(db, { title: "b" });
    startTask(b.id, "voice-idle", "voice_session");
    await runRecovery({ db, pidfiles, kill: async () => true });
    expect(listByStatus(db, "interrupted")).toEqual([]);
    expect(listMessages(db, a.id)).toEqual([]);
    expect(listMessages(db, b.id)).toEqual([]);
  });

  it("records one notice per proven unfinished action without advancing timestamps or human recency", async () => {
    const a = createSession(db, { origin: "human" });
    markHumanActivity(db, a.id, 123);
    startTask(a.id, "chat-unfinished");
    startTask(a.id, "voice-action-unfinished", "voice_action");
    const tasks = snapshotInterruptedConversationTasks(db);
    expect(tasks).toHaveLength(2);
    const service = new ObservabilityService(db);
    db.transaction(() => {
      recordInterruptedConversationTasks(db, tasks);
      service.store.markOrphanedRuns();
    })();
    await runRecovery({ db, pidfiles, kill: async () => true, interruptedTasks: tasks });
    const expected = listMessages(db, a.id);
    expect(expected).toHaveLength(2);
    expect(new Set(expected.map(m => m.metadata?.interruptedTaskId))).toEqual(new Set(["chat-unfinished", "voice-action-unfinished"]));
    expect(getSession(db, a.id)).toMatchObject({ status: "interrupted", updated_at: a.updated_at, last_human_activity_at: 123 });
    db.close();
    db = openDb(join(dir, "x.db"));
    await runRecovery({ db, pidfiles, kill: async () => true });
    await runRecovery({ db, pidfiles, kill: async () => true, interruptedTasks: tasks });
    expect(listMessages(db, a.id)).toEqual(expected);
  });

  it("excludes terminal and deleted tasks, while preserving explicitly archived session state", async () => {
    const complete = createSession(db, { origin: "human" });
    const deleted = createSession(db, {});
    const archived = createSession(db, {});
    setStatus(db, archived.id, "archived");
    const service = new ObservabilityService(db);
    for (const status of ["completed", "failed", "cancelled", "timed_out", "orphaned"] as const) {
      startTask(complete.id, status);
      service.record(status, { type: "test.terminal", status: "done", title: "Terminal", terminal: true, runStatus: status });
    }
    startTask(deleted.id, "deleted-active");
    softDeleteSession(db, deleted.id);
    startTask(archived.id, "archived-active");
    expect(snapshotInterruptedConversationTasks(db)).toEqual([{ runId: "archived-active", sessionId: archived.id }]);
    await runRecovery({ db, pidfiles, kill: async () => true });
    expect(listMessages(db, complete.id)).toEqual([]);
    expect(listMessages(db, deleted.id)).toEqual([]);
    expect(listMessages(db, archived.id)).toHaveLength(1);
    expect(getSession(db, archived.id)?.status).toBe("archived");
  });

  it("rolls notices and orphan projection back together on failed startup transaction", () => {
    const session = createSession(db, { origin: "human" });
    startTask(session.id, "unfinished");
    const service = new ObservabilityService(db);
    expect(() => db.transaction(() => {
      recordInterruptedConversationTasks(db, snapshotInterruptedConversationTasks(db));
      service.store.markOrphanedRuns();
      throw new Error("synthetic startup failure");
    })()).toThrow("synthetic startup failure");
    expect(listMessages(db, session.id)).toEqual([]);
    expect(snapshotInterruptedConversationTasks(db)).toHaveLength(1);
    recordInterruptedConversationTasks(db, snapshotInterruptedConversationTasks(db));
    expect(listMessages(db, session.id)).toHaveLength(1);
  });

  it("does not claim a saved final result is absent when terminal completion was interrupted", async () => {
    const session = createSession(db, { origin: "human" });
    startTask(session.id, "saved-but-not-terminal");
    appendMessage(db, { sessionId: session.id, role: "assistant", content: "The report was saved." });
    new ObservabilityService(db).record("saved-but-not-terminal", {
      type: "agent.response.completed", status: "success", title: "Response recorded", terminal: false,
    });
    await runRecovery({ db, pidfiles, kill: async () => true });
    const messages = listMessages(db, session.id);
    expect(messages[0]?.content).toBe("The report was saved.");
    expect(messages[1]?.content).toContain("completion status");
    expect(messages[1]?.content).toContain("check it before deciding whether to retry");
    expect(messages[1]?.content).not.toContain("before this task recorded a result");
  });

  it("does not touch idle or archived sessions", async () => {
    const s = createSession(db, { title: "idle one" });
    setStatus(db, s.id, "idle");
    await runRecovery({ db, pidfiles, kill: async () => true });
    expect(listByStatus(db, "interrupted")).toEqual([]);
  });

  it("continues even if kill throws for one of the pids", async () => {
    pidfiles.add("r", 1);
    pidfiles.add("r", 2);
    let calls = 0;
    await runRecovery({
      db,
      pidfiles,
      kill: async () => {
        calls++;
        if (calls === 1) throw new Error("nope");
        return true;
      },
    });
    expect(calls).toBe(2);
    expect(pidfiles.listAll()).toEqual([]);
  });
});
