import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../state/db.js";
import { createSession, getSession, listSessions, markHumanActivity, softDeleteSession } from "../state/sessions.js";
import { listMessages } from "../state/messages.js";
import { chatRoutes } from "./chat.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { SseBuffer } from "../sse/buffer.js";
import { initiativeFixture } from "../initiative/fixture.test-helper.js";

describe("authoritative chat conversation binding", () => {
  let db: Db;
  let directory: string;
  let app: express.Express;
  let runs: ActiveRuns;
  let runAgentImpl: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ava-chat-binding-"));
    db = openDb(":memory:");
    runs = new ActiveRuns();
    for (const [id, label] of [["human", "Phone"], ["automation", "watch-internal"], ["voice_action", "voice-internal"]]) {
      db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at, session_actor) VALUES (?, ?, ?, 1, ?)").run(id, `fixture-${id}`, label, id);
    }
    runs = new ActiveRuns();
    runAgentImpl = vi.fn(async (opts: { emit: (event: unknown) => void }) => {
      opts.emit({ kind: "final", payload: { text: "Fixture response." } });
    });
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.deviceId = req.header("x-fixture-device") ?? "human"; next(); });
    app.use("/api/chat", chatRoutes(db, runs, (_req, _res, next) => next(), {
      pidfiles: {} as never, fsRoots: [], memoryDir: directory, dataDir: directory,
      getChrome: async () => ({} as never),
      provider: new MockLLMProvider({ scripts: [] }), runAgentImpl: runAgentImpl as never,
    }, { anthropic: null, openai: null }));
  });
  afterEach(async () => {
    // Fixture agent finishes through the actual route, before closing SQLite.
    try { await vi.waitFor(() => expect(runs.list()).toHaveLength(0)); }
    finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  async function send(body: Record<string, unknown>, actor = "human", status = 200) {
    const result = await request(app).post("/api/chat").set("x-fixture-device", actor)
      .send({ text: "Please explain this fixture", ...body }).expect(status);
    if (status === 200) await vi.waitFor(() => expect(runs.get(result.body.sessionId)).toBeUndefined());
    return result;
  }

  it("persists a human text turn and acknowledges its exact authoritative binding", async () => {
    const result = await send({ bindingRequestId: "chat-new-1" });
    const id = result.body.sessionId;
    expect(result.body.binding).toEqual({ version: 1, sessionId: id, origin: "human", resolution: "created", bindingRequestId: "chat-new-1" });
    const user = listMessages(db, id)[0]!;
    expect(user.metadata?.inputModality).toBe("text");
    expect(getSession(db, id)?.last_human_activity_at).toBe(user.created_at);
    const replay = await send({ bindingRequestId: "chat-new-1", text: "A second accepted turn in that conversation" });
    expect(replay.body.sessionId).toBe(id);
    expect(listSessions(db)).toHaveLength(1);
  });

  it("reports the exact stored row of the accepted turn, even when the same words repeat", async () => {
    const first = await send({ text: "same words" });
    const id = first.body.sessionId;
    const second = await send({ sessionId: id, text: "same words" });
    const rows = listMessages(db, id).filter((m) => m.role === "user");
    expect(rows).toHaveLength(2);
    expect(first.body.userMessageId).toBe(rows[0]!.id);
    expect(second.body.userMessageId).toBe(rows[1]!.id);
    expect(second.body.userMessageId).not.toBe(first.body.userMessageId);
  });

  it("reports no accepted-turn row when nothing was stored (persist:false), and adds no writes", async () => {
    const session = createSession(db, { origin: "human" });
    const before = listMessages(db, session.id).length;
    const result = await send({ sessionId: session.id, voice: true, persist: false }, "voice_action");
    expect(result.body.userMessageId).toBeNull();
    expect(listMessages(db, session.id).filter((m) => m.role === "user")).toHaveLength(before);
  });

  it("an accepted reply engages the exact assistant invitation once, not delegated audit turns", async () => {
    const f = initiativeFixture(db); await f.engine.tick();
    const row = f.rows()[0]!;
    await send({ sessionId: row.session_id, intent: "resume", persist: false }, "voice_action");
    expect(f.rows()[0]!.disposition_state).toBe("open");
    await send({ sessionId: row.session_id, intent: "resume", text: "Let's compare the two options." });
    expect(f.rows()[0]).toMatchObject({ disposition_state: "engaged", disposition_version: 2 });
    expect(listMessages(db, row.session_id!).filter(m => m.role === "user")).toHaveLength(1);
    await send({ sessionId: row.session_id, intent: "resume", text: "Focus on the pilot." });
    expect(f.rows()[0]!.disposition_version).toBe(2);
  });

  it("preserves legacy exact selection, including typed exact voice characters and modality", async () => {
    const legacy = createSession(db, {});
    const exact = "  @_princi150?q=A_B%20C  ";
    const result = await send({ sessionId: legacy.id, text: exact, voice: true, inputSource: "voice_exact_text" });
    expect(result.body.binding).toMatchObject({ sessionId: legacy.id, origin: "unknown", resolution: "resumed_exact" });
    expect(listMessages(db, legacy.id)[0]).toMatchObject({ content: exact, metadata: { inputModality: "text", inputSource: "voice_exact_text" } });
    expect(getSession(db, legacy.id)).toMatchObject({ origin: "unknown", last_human_activity_at: expect.any(Number) });
  });

  it("continues human A over newer/pinned automation B", async () => {
    const a = createSession(db, { origin: "human" });
    const b = createSession(db, { origin: "automation" });
    markHumanActivity(db, a.id, 100);
    db.prepare("UPDATE sessions SET updated_at = ?, pinned = 1 WHERE id = ?").run(Date.now() + 100_000, b.id);
    const result = await send({ conversationIntent: "continue" });
    expect(result.body.binding).toMatchObject({ sessionId: a.id, resolution: "continued" });
    expect(listMessages(db, b.id)).toEqual([]);
  });

  it.each(["missing", "deleted", "automation"])("rejects exact %s target without replacement or ID disclosure", async kind => {
    const id = kind === "missing" ? "private-missing-id" : createSession(db, { origin: kind === "automation" ? "automation" : "human" }).id;
    if (kind === "deleted") softDeleteSession(db, id);
    const before = db.prepare("SELECT COUNT(*) AS n FROM sessions").get();
    const result = await send({ sessionId: id }, "human", 404);
    expect(result.body).toEqual({ error: "session_unavailable", message: "This conversation is unavailable." });
    expect(JSON.stringify(result.body)).not.toContain(id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual(before);
    expect(runAgentImpl).not.toHaveBeenCalled();
  });

  it.each([
    { conversationIntent: "new", sessionId: "existing" },
    { conversationIntent: "resume" },
    { conversationIntent: "continue", sessionId: "existing" },
    { bindingRequestId: "with spaces" }, { bindingRequestId: "x".repeat(129) },
  ])("rejects contradictory/malformed intent %j", async body => {
    await send(body, "human", 400);
    expect(listSessions(db)).toEqual([]);
  });

  it("a rejected busy turn never persists input or advances human recency", async () => {
    const session = createSession(db, { origin: "human" });
    markHumanActivity(db, session.id, 123);
    runs.register({ sessionId: session.id, runId: "busy", abort: new AbortController(), buffer: new SseBuffer({ maxEvents: 10, maxBytes: 10000 }) });
    try {
      await send({ sessionId: session.id }, "human", 409);
      expect(getSession(db, session.id)).toMatchObject({ last_human_activity_at: 123, updated_at: session.updated_at });
      expect(listMessages(db, session.id)).toEqual([]);
      expect(runAgentImpl).not.toHaveBeenCalled();
    } finally { runs.unregister(session.id); }
  });

  it("watch credentials create automation, and voice flags cannot reclassify their turns", async () => {
    const result = await send({ voice: true }, "automation");
    expect(result.body.binding.origin).toBe("automation");
    expect(getSession(db, result.body.sessionId)?.last_human_activity_at).toBeNull();
    expect(listMessages(db, result.body.sessionId)[0]?.metadata?.inputModality).toBeUndefined();
  });

  it("trusted voice action reuses exact history without double-storing/stamping", async () => {
    const session = createSession(db, { origin: "human" });
    markHumanActivity(db, session.id, 123);
    const result = await send({ sessionId: session.id, voice: true, persist: false }, "voice_action");
    expect(result.body.binding.sessionId).toBe(session.id);
    expect(listMessages(db, session.id)).toEqual([]);
    expect(getSession(db, session.id)?.last_human_activity_at).toBe(123);
    await send({ voice: true, persist: false }, "voice_action", 400);
    expect(listSessions(db)).toHaveLength(1);
  });

  it("a human transcription is voice; a persist:false flag does not manufacture automation", async () => {
    const spoken = await send({ voice: true });
    expect(listMessages(db, spoken.body.sessionId)[0]?.metadata?.inputModality).toBe("voice");
    const transient = await send({ persist: false });
    expect(transient.body.binding.origin).toBe("human");
    expect(getSession(db, transient.body.sessionId)?.last_human_activity_at).toBeNull();
    expect(listMessages(db, transient.body.sessionId)).toEqual([]);
  });

  it("stamps one fresh clock into each voice-action prompt at execution time (v3)", async () => {
    const session = createSession(db, { origin: "human" });
    const prompts: string[] = [];
    runAgentImpl.mockImplementation(async (opts: { prompt?: string; userText?: string; emit: (event: unknown) => void } & Record<string, unknown>) => {
      prompts.push(String(opts.prompt ?? opts.userText ?? JSON.stringify(opts)));
      opts.emit({ kind: "final", payload: { text: "Fixture response." } });
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.parse("2026-09-27T22:59:00Z"));
      await send({ sessionId: session.id, voice: true, persist: false, text: "What is on today?" }, "voice_action");
      vi.setSystemTime(Date.parse("2026-09-27T23:01:00Z"));
      await send({ sessionId: session.id, voice: true, persist: false, text: "And now?" }, "voice_action");
    } finally { vi.useRealTimers(); }
    expect(prompts).toHaveLength(2);
    expect(prompts[0]!.match(/\[NOW\]/g)).toHaveLength(1);
    expect(prompts[0]).toContain("[NOW] Sunday 2026-09-27 23:59 Europe/Dublin (UTC+01:00)");
    expect(prompts[1]).toContain("[NOW] Monday 2026-09-28 00:01 Europe/Dublin (UTC+01:00)");
    expect(listMessages(db, session.id)).toEqual([]);
  });
});
