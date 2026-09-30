import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { openDb, type Db } from "./db.js";
import { createSession, getSession, listSessions, markHumanActivity, purgeDeletedSessions, setPinned, setStatus, softDeleteSession, updateTitle } from "./sessions.js";
import { resolveConversation, requireExactSessionAcknowledgement, SessionBindingError, type ConversationRequest } from "./session-binding.js";

describe("resolveConversation", () => {
  it("rejects missing or mismatched action acknowledgements before selecting a stream/cancellation target", () => {
    expect(requireExactSessionAcknowledgement("canonical", { sessionId: "canonical" })).toBe("canonical");
    expect(requireExactSessionAcknowledgement("canonical", { sessionId: "canonical", binding: { sessionId: "canonical" } })).toBe("canonical");
    for (const response of [null, {}, [], { sessionId: "foreign" }, { sessionId: "canonical", binding: { sessionId: "foreign" } }]) {
      expect(() => requireExactSessionAcknowledgement("canonical", response)).toThrow("This conversation is unavailable.");
    }
    expect(() => requireExactSessionAcknowledgement(null, { sessionId: "foreign" })).toThrow(SessionBindingError);
  });
  let db: Db;
  const directories: string[] = [];
  beforeEach(() => { db = openDb(":memory:"); });
  afterEach(() => {
    db.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });
  const request = (overrides: Partial<ConversationRequest> = {}): ConversationRequest => ({
    actor: "human", deviceId: "phone", intent: "new", ...overrides,
  });
  const diskPath = () => {
    const directory = mkdtempSync(join(tmpdir(), "ava-binding-"));
    directories.push(directory);
    return join(directory, "state.db");
  };

  it("binds without stamping a human turn; callers stamp accepted input separately", () => {
    const binding = resolveConversation(db, request({ title: "Hello", bindingRequestId: "new-1" }));
    expect(binding).toMatchObject({ version: 1, origin: "human", resolution: "created", bindingRequestId: "new-1" });
    expect(getSession(db, binding.sessionId)).toMatchObject({ title: "Hello", last_human_activity_at: null });
    markHumanActivity(db, binding.sessionId, 100);
    resolveConversation(db, request({ intent: "resume", sessionId: binding.sessionId }));
    expect(getSession(db, binding.sessionId)?.last_human_activity_at).toBe(100);
  });

  it("resumes unknown/human exact records without changing origin, including archived history", () => {
    const session = createSession(db, { title: "Legacy" });
    setStatus(db, session.id, "archived");
    const binding = resolveConversation(db, request({ intent: "resume", sessionId: session.id, bindingRequestId: "echo-me" }));
    expect(binding).toEqual({ version: 1, sessionId: session.id, origin: "unknown", resolution: "resumed_exact", bindingRequestId: "echo-me" });
    expect(getSession(db, session.id)?.last_human_activity_at).toBeNull();
  });

  it("never replaces missing, deleted or automation targets requested by a human", () => {
    const deleted = createSession(db, { origin: "human" });
    const automation = createSession(db, { origin: "automation" });
    softDeleteSession(db, deleted.id);
    const count = listSessions(db).length;
    for (const sessionId of ["rejected-private-id", deleted.id, automation.id]) {
      try {
        resolveConversation(db, request({ intent: "resume", sessionId }));
        expect.fail("expected unavailable");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionBindingError);
        expect(error).toMatchObject({ status: 404, code: "session_unavailable", message: "This conversation is unavailable." });
        expect(String(error)).not.toContain(sessionId);
      }
    }
    expect(listSessions(db)).toHaveLength(count);
  });

  it("continues only eligible human activity, ignoring background updates, pins and archives", () => {
    const older = createSession(db, { origin: "human" });
    const recent = createSession(db, {});
    const pinned = createSession(db, {});
    const automation = createSession(db, { origin: "automation" });
    const archived = createSession(db, { origin: "human" });
    markHumanActivity(db, older.id, 100);
    markHumanActivity(db, recent.id, 200);
    markHumanActivity(db, archived.id, 900);
    setStatus(db, archived.id, "archived");
    setPinned(db, pinned.id, true);
    updateTitle(db, older.id, "background title");
    db.prepare("UPDATE sessions SET updated_at = 999999 WHERE id IN (?, ?)").run(pinned.id, automation.id);
    expect(resolveConversation(db, request({ intent: "continue" }))).toMatchObject({ sessionId: recent.id, origin: "unknown", resolution: "continued" });
    expect(getSession(db, recent.id)?.last_human_activity_at).toBe(200);
  });

  it("uses only human timestamp then id for continuation ties, never created/updated time", () => {
    db.prepare(`INSERT INTO sessions (id, created_at, updated_at, origin, last_human_activity_at)
      VALUES ('a-human', 9999, 9999, 'human', 100), ('z-human', 1, 1, 'human', 100),
      ('null-human', 99999, 99999, 'human', NULL)`).run();
    expect(resolveConversation(db, request({ intent: "continue" })).sessionId).toBe("z-human");
  });

  it("creates human when there is no eligible continuation, even with pinned legacy or archived human", () => {
    const pinned = createSession(db, {});
    setPinned(db, pinned.id, true);
    const archived = createSession(db, { origin: "human" });
    markHumanActivity(db, archived.id, 100);
    setStatus(db, archived.id, "archived");
    expect(resolveConversation(db, request({ intent: "continue" }))).toMatchObject({ origin: "human", resolution: "created" });
  });

  it("keeps automation continuation separate while allowing exact automation delivery into human history", () => {
    const human = createSession(db, { origin: "human" });
    markHumanActivity(db, human.id, 500);
    const automated = resolveConversation(db, request({ actor: "automation", intent: "continue" }));
    expect(automated).toMatchObject({ origin: "automation", resolution: "created" });
    expect(automated.sessionId).not.toBe(human.id);
    expect(resolveConversation(db, request({ actor: "automation", intent: "continue" }))).toMatchObject({ sessionId: automated.sessionId, resolution: "continued" });
    expect(resolveConversation(db, request({ actor: "automation", intent: "resume", sessionId: human.id }))).toMatchObject({ sessionId: human.id, resolution: "resumed_exact" });
    expect(getSession(db, human.id)?.last_human_activity_at).toBe(500);
    expect(getSession(db, automated.sessionId)?.last_human_activity_at).toBeNull();
  });

  it("resumes an exact invitation without hijacking continue, across reconnect and restart", () => {
    const path = diskPath();
    db.close();
    db = openDb(path);
    const human = createSession(db, { origin: "human" });
    markHumanActivity(db, human.id, 100);
    const invitation = createSession(db, { origin: "assistant" });
    setPinned(db, invitation.id, true);
    for (let restart = 0; restart < 2; restart++) {
      for (const actor of ["human", "voice_action"] as const) {
        expect(resolveConversation(db, request({ actor, intent: "resume", sessionId: invitation.id })))
          .toMatchObject({ sessionId: invitation.id, origin: "assistant", resolution: "resumed_exact" });
      }
      expect(getSession(db, invitation.id)?.last_human_activity_at).toBeNull();
      expect(resolveConversation(db, request({ intent: "continue" })).sessionId).toBe(human.id);
      db.close(); db = openDb(path);
    }
    markHumanActivity(db, invitation.id, 200);
    expect(resolveConversation(db, request({ intent: "continue" })))
      .toMatchObject({ sessionId: invitation.id, origin: "assistant", resolution: "continued" });
    softDeleteSession(db, invitation.id);
    expect(() => resolveConversation(db, request({ intent: "resume", sessionId: invitation.id })))
      .toThrow("This conversation is unavailable.");
    expect(resolveConversation(db, request({ intent: "continue" })).sessionId).toBe(human.id);
  });

  it("voice actions require an exact human/legacy target and never stamp activity", () => {
    const human = createSession(db, { origin: "human" });
    markHumanActivity(db, human.id, 100);
    expect(resolveConversation(db, request({ actor: "voice_action", intent: "resume", sessionId: human.id }))).toMatchObject({ sessionId: human.id, resolution: "resumed_exact" });
    expect(getSession(db, human.id)?.last_human_activity_at).toBe(100);
    for (const intent of ["new", "continue"] as const) {
      expect(() => resolveConversation(db, request({ actor: "voice_action", intent }))).toThrow(SessionBindingError);
    }
    const automation = createSession(db, { origin: "automation" });
    expect(() => resolveConversation(db, request({ actor: "voice_action", intent: "resume", sessionId: automation.id }))).toThrow("This conversation is unavailable.");
  });

  it("replays a keyed new binding per device without conflating distinct devices or intents", () => {
    const first = resolveConversation(db, request({ bindingRequestId: "new-1" }));
    const replay = resolveConversation(db, request({ bindingRequestId: "new-1", title: "retry title" }));
    expect(replay).toEqual(first);
    expect(getSession(db, first.sessionId)?.title).toBeNull();
    const secondDevice = resolveConversation(db, request({ deviceId: "laptop", bindingRequestId: "new-1" }));
    expect(secondDevice.sessionId).not.toBe(first.sessionId);
    const secondKey = resolveConversation(db, request({ bindingRequestId: "new-2" }));
    expect(secondKey.sessionId).not.toBe(first.sessionId);
    expect(() => resolveConversation(db, request({ actor: "automation", bindingRequestId: "new-1" }))).toThrow(SessionBindingError);
    expect(listSessions(db)).toHaveLength(3);
  });

  it("retains key identity across database restarts and after deletion/purge", () => {
    const path = diskPath();
    db.close();
    db = openDb(path);
    const first = resolveConversation(db, request({ bindingRequestId: "durable-new" }));
    db.close();
    db = openDb(path);
    expect(resolveConversation(db, request({ bindingRequestId: "durable-new" }))).toEqual(first);
    softDeleteSession(db, first.sessionId);
    expect(() => resolveConversation(db, request({ bindingRequestId: "durable-new" }))).toThrow("This conversation is unavailable.");
    purgeDeletedSessions(db, Date.now() + 1);
    db.close();
    db = openDb(path);
    expect(() => resolveConversation(db, request({ bindingRequestId: "durable-new" }))).toThrow("This conversation is unavailable.");
    expect(listSessions(db)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM session_binding_requests").get()).toEqual({ n: 1 });
  });

  it("serializes simultaneous new-key requests from independent SQLite connections", async () => {
    const path = diskPath();
    const initialized = openDb(path);
    initialized.close();
    const workers: Worker[] = [];
    const results: Array<Promise<{ sessionId: string }>> = [];
    const ready: Array<Promise<void>> = [];
    try {
      for (let i = 0; i < 3; i++) {
        const worker = new Worker(`
          const { parentPort, workerData } = require('node:worker_threads');
          require('tsx/cjs');
          const { openDb } = require(workerData.dbModule);
          const { resolveConversation } = require(workerData.bindingModule);
          const db = openDb(workerData.path);
          parentPort.once('message', () => {
            try {
              const binding = resolveConversation(db, workerData.request);
              parentPort.postMessage({ kind: 'bound', binding });
            } finally { db.close(); }
          });
          parentPort.postMessage({ kind: 'ready' });
        `, { eval: true, workerData: {
          path, request: request({ bindingRequestId: "parallel-new" }),
          dbModule: fileURLToPath(new URL("./db.ts", import.meta.url)),
          bindingModule: fileURLToPath(new URL("./session-binding.ts", import.meta.url)),
        } });
        workers.push(worker);
        ready.push(new Promise<void>((resolve, reject) => {
          worker.on("message", message => { if (message.kind === "ready") resolve(); });
          worker.once("error", reject);
        }));
        results.push(new Promise((resolve, reject) => {
          worker.on("message", message => { if (message.kind === "bound") resolve(message.binding); });
          worker.once("error", reject);
          worker.once("exit", code => { if (code !== 0) reject(new Error(`Binding worker exited ${code}`)); });
        }));
      }
      const allResults = Promise.all(results);
      const readyAndResults = Promise.all([Promise.all(ready).then(() => {
        for (const worker of workers) worker.postMessage("go");
      }), allResults]);
      const [, bindings] = await readyAndResults;
      expect(new Set(bindings.map(binding => binding.sessionId)).size).toBe(1);
      const check = openDb(path);
      try {
        expect(listSessions(check)).toHaveLength(1);
        expect(check.prepare("SELECT COUNT(*) AS n FROM session_binding_requests").get()).toEqual({ n: 1 });
      } finally { check.close(); }
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }, 20_000);

  it("rejects contradictory requests and malformed opaque keys without creating anything", () => {
    const invalid: Partial<ConversationRequest>[] = [
      { intent: "new", sessionId: "existing" }, { intent: "continue", sessionId: "existing" },
      { intent: "resume" }, { intent: "resume", sessionId: "" },
      ...["", "a b", "a.b", "a/b", "é", "\n", "a".repeat(129)].map(bindingRequestId => ({ bindingRequestId })),
    ];
    for (const overrides of invalid) {
      expect(() => resolveConversation(db, request(overrides))).toThrow(SessionBindingError);
    }
    expect(listSessions(db)).toEqual([]);
    expect(resolveConversation(db, request({ bindingRequestId: "A_0-".repeat(32) })).bindingRequestId).toHaveLength(128);
  });
});
