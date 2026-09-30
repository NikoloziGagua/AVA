import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { appendMessage, listMessages } from "../state/messages.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { MemoryIndexService } from "../memory-index/store.js";
import { ObservabilityService } from "../observability/store.js";
import { chatRoutes } from "./chat.js";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-chat-retrieval-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-chat-retrieval-memory-"));
  const db = openDb(join(dir, "ava.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
    .run("fixture", "hash-fixture", "memory retrieval fixture", Date.now());
  const source = createSession(db, { title: "Aurora research" });
  const user = appendMessage(db, { sessionId: source.id, role: "user", content: "Develop our aurora observation plan." });
  const assistant = appendMessage(db, {
    sessionId: source.id,
    role: "assistant",
    content: "The authoritative aurora plan uses two flexible nights, live cloud checks, and an inland backup location.",
  });
  const memoryIndex = new MemoryIndexService(db, null);
  await memoryIndex.capture({
    sessionId: source.id,
    fromMessageId: user.id,
    throughMessageId: assistant.id,
    kind: "idea",
    title: "Aurora observation plan",
    summary: "Use a flexible two-night window with cloud monitoring and an inland fallback.",
    conclusions: ["Keep the schedule flexible"],
    tags: ["aurora", "travel"],
  });
  const prompts: string[] = [];
  const runAgentImpl = vi.fn(async (opts: { prompt: string; emit: (event: never) => void }) => {
    prompts.push(opts.prompt);
    opts.emit({ kind: "final", payload: { text: "Retrieved answer." } } as never);
    opts.emit({ kind: "done", payload: {} } as never);
  });
  const observability = new ObservabilityService(db);
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { deviceId?: string }, _res, next) => { req.deviceId = "fixture"; next(); });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_req, _res, next) => next(), {
    pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
    fsRoots: [],
    memoryDir,
    memoryIndex,
    dataDir: dir,
    getChrome: async () => ({} as never),
    provider: new MockLLMProvider({ scripts: [] }),
    runAgentImpl: runAgentImpl as never,
    observability,
  }, { anthropic: null, openai: null }));
  return { app, prompts, observability, db };
}

describe("chat automatic memory retrieval", () => {
  it("injects source-verified cross-chat context and explains its use in Mission Control", async () => {
    const fixture = await setup();
    const response = await request(fixture.app).post("/api/chat").send({
      text: "What did we decide about the aurora observation plan?",
    }).expect(200);
    await vi.waitFor(() => expect(fixture.prompts).toHaveLength(1));

    expect(fixture.prompts[0]).toContain("VERIFIED DURABLE MEMORY");
    expect(fixture.prompts[0]).toContain("live cloud checks");
    const events = fixture.observability.getEvents(response.body.taskId);
    expect(events.find((event) => event.type === "memory.retrieval.used")).toMatchObject({
      summary: "AVA used 1 latest source-verified memory checkpoint.",
      privacyLevel: "personal",
    });
    await vi.waitFor(() => {
      const persisted = listMessages(fixture.db, response.body.sessionId)
        .findLast((message) => message.role === "assistant");
      expect(persisted?.metadata?.memoryContext).toMatchObject({
        schemaVersion: 1,
        status: "used",
        selected: [{ title: "Aurora observation plan", sourceStatus: "verified" }],
      });
      const metadata = JSON.stringify(persisted?.metadata?.memoryContext);
      expect(metadata).not.toContain("live cloud checks");
      expect(metadata).not.toContain("prompt");
      expect(metadata).not.toContain("query");
      expect(metadata).not.toContain("sourceSessionId");
    });

    const replay = await request(fixture.app)
      .get(`/api/chat/${response.body.sessionId}/stream`)
      .query({ taskId: response.body.taskId })
      .expect(200);
    expect(replay.text).toContain("event: memory_context");
    expect(replay.text).toContain('"status":"used"');
    expect(replay.text).not.toContain("live cloud checks");
  });

  it("leaves an irrelevant fresh chat clean and reports why no memory was used", async () => {
    const fixture = await setup();
    const response = await request(fixture.app).post("/api/chat").send({
      text: "Explain sourdough fermentation.",
    }).expect(200);
    await vi.waitFor(() => expect(fixture.prompts).toHaveLength(1));

    expect(fixture.prompts[0]).not.toContain("VERIFIED DURABLE MEMORY");
    expect(fixture.observability.getEvents(response.body.taskId)
      .find((event) => event.type === "memory.retrieval.no_match"))
      .toMatchObject({ status: "skipped" });
    await vi.waitFor(() => {
      const persisted = listMessages(fixture.db, response.body.sessionId)
        .findLast((message) => message.role === "assistant");
      expect(persisted?.metadata?.memoryContext).toMatchObject({
        status: "no_match",
        selected: [],
      });
    });
  });
});
