import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { createSession } from "../state/sessions.js";
import { createResearchVisual, createVisualExplanation } from "../state/visual-explanations.js";
import { requestPathFixture } from "../visual-explanations/fixtures.test-helper.js";
import { vikingMapFixture } from "../visual-explanations/research-fixtures.test-helper.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import type { AgentEvent } from "../orchestrator/agent.js";
import { chatRoutes } from "./chat.js";

function setup(runAgentImpl: (opts: any) => Promise<void>) {
  const dataDir = mkdtempSync(join(tmpdir(), "ava-inline-visual-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-inline-visual-memory-"));
  const db = openDb(join(dataDir, "state.db"));
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("visual-device", "visual-device-hash", "test", Date.now());
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "visual-device"; next(); });
  app.use("/api/chat", chatRoutes(
    db,
    new ActiveRuns(),
    (_req, _res, next) => next(),
    {
      pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
      fsRoots: [],
      memoryDir,
      dataDir,
      getChrome: async () => ({} as never),
      provider: new MockLLMProvider({ scripts: [] }),
      runAgentImpl: runAgentImpl as never,
    },
    { anthropic: null, openai: null },
  ));
  return { app, db };
}

describe("inline visual message chat boundary", () => {
  it.each([
    ["Research development of AI and create a visual timeline", "research_visual_create", "visual_explanation_create"],
    ["draw me a chart here of the comparisons in chat", "research_visual_create", "visual_explanation_create"],
    ["show me with a map Viking migrations", "research_visual_create", "visual_explanation_create"],
    ["research the best free AI models in a comprehensive report with benchmarks", "research_visual_create", "visual_explanation_create"],
    ["visually explain AVA's Instagram architecture", "visual_explanation_create", "research_visual_create"],
  ])("routes the real request %s to %s", async (text, expected, absent) => {
    const runAgent = vi.fn(async (opts: { emit: (event: AgentEvent) => void; deps: { tools: Array<{ tool: { name: string } }> } }) => {
      const names = opts.deps.tools.map((entry) => entry.tool.name);
      expect(names).toContain(expected);
      expect(names).not.toContain(absent);
      opts.emit({ kind: "final", payload: { text: "Routed." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app } = setup(runAgent);
    await request(app).post("/api/chat").send({ text }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it("attaches every successful created visual revision to the persisted assistant message", async () => {
    let db!: Db;
    const runAgent = vi.fn(async (opts: { emit: (event: AgentEvent) => void; sessionId: string; runId: string }) => {
      const visual = createVisualExplanation(db, requestPathFixture, {
        source: "ava_chat",
        sessionId: opts.sessionId,
        runId: opts.runId,
      }).visual;
      opts.emit({ kind: "tool_call", payload: { tool: "visual_explanation_create", args: {} } });
      opts.emit({
        kind: "tool_result",
        payload: {
          tool: "visual_explanation_create",
          ok: true,
          result: JSON.stringify({ visualMessageId: visual.visualMessageId, revision: visual.revision }),
        },
      });
      opts.emit({ kind: "final", payload: { text: "Here is the visual explanation." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const configured = setup(runAgent);
    db = configured.db;
    const started = await request(configured.app).post("/api/chat").send({ text: "Show this visually" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant")!;
    expect(assistant.metadata?.visualMessages).toHaveLength(1);
    expect(assistant.metadata?.visualMessages?.[0]).toMatchObject({ revision: 1 });
  });

  it("sends only explicit, server-derived visual context to the agent", async () => {
    const runAgent = vi.fn(async (opts: { emit: (event: AgentEvent) => void }) => {
      opts.emit({ kind: "final", payload: { text: "The branch means…" } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app, db } = setup(runAgent);
    const session = createSession(db, { title: "Visual context" });
    const visual = createVisualExplanation(db, requestPathFixture, { source: "ava_chat", sessionId: session.id, runId: "source-run" }).visual;
    await request(app).post("/api/chat").send({
      sessionId: session.id,
      text: "Explain the selected branch",
      visualContext: {
        visualMessageId: visual.visualMessageId,
        revision: 1,
        action: "branch",
        sceneId: "act",
        selectedElementIds: ["verify"],
      },
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const prompt = (runAgent.mock.calls[0]?.[0] as unknown as { prompt: string }).prompt;
    expect(prompt).toContain("[EXPLICIT VISUAL CONTEXT — server validated]");
    expect(prompt).toContain("verify: Evidence available?");
    expect(listMessages(db, session.id)[0]?.metadata?.visualContext).toMatchObject({ action: "branch", revision: 1 });
  });

  it("attaches research visuals and returns validated claim/source context to AVA", async () => {
    let db!: Db;
    let storedId = "";
    const runAgent = vi.fn(async (opts: { emit: (event: AgentEvent) => void; sessionId: string; runId: string; prompt: string }) => {
      if (!storedId) {
        const visual = createResearchVisual(db, vikingMapFixture, { source: "ava_chat", sessionId: opts.sessionId, runId: opts.runId }).visual;
        storedId = visual.visualMessageId;
        opts.emit({ kind: "tool_result", payload: { tool: "research_visual_create", ok: true, result: JSON.stringify({ visualMessageId: storedId, revision: 1 }) } });
        opts.emit({ kind: "final", payload: { text: "Here is the grounded map." } });
      } else {
        expect(opts.prompt).toContain("westRoute: Western migration route");
        expect(opts.prompt).toContain("Primary research source (https://example.org/research/primary)");
        opts.emit({ kind: "final", payload: { text: "The route is broadly supported." } });
      }
      opts.emit({ kind: "done", payload: {} });
    });
    const configured = setup(runAgent); db = configured.db;
    const started = await request(configured.app).post("/api/chat").send({ text: "Research Viking migrations with a map" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant")!;
    expect(assistant.metadata?.visualMessages).toEqual([{ visualMessageId: storedId, revision: 1 }]);
    await request(configured.app).post("/api/chat").send({
      sessionId: started.body.sessionId,
      text: "Explain the route evidence",
      visualContext: { visualMessageId: storedId, revision: 1, action: "branch", sceneId: "origins", selectedElementIds: ["westRoute"] },
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("rejects stale revisions and invalid selections before creating a chat turn", async () => {
    const runAgent = vi.fn(async () => {});
    const { app, db } = setup(runAgent);
    const session = createSession(db, { title: "Stale visual" });
    const first = createVisualExplanation(db, requestPathFixture, { source: "ava_chat", sessionId: session.id, runId: "one" }).visual;
    createVisualExplanation(db, {
      ...structuredClone(requestPathFixture),
      title: "Request path revision",
      revisesVisualMessageId: first.visualMessageId,
      expectedRevision: 1,
    }, { source: "ava_chat", sessionId: session.id, runId: "two" });

    const stale = await request(app).post("/api/chat").send({
      sessionId: session.id,
      text: "Explain it",
      visualContext: { visualMessageId: first.visualMessageId, revision: 1, action: "explain", sceneId: "act", selectedElementIds: [] },
    }).expect(409);
    expect(stale.body).toMatchObject({ error: "stale_visual_revision", currentRevision: 2 });

    const invalid = await request(app).post("/api/chat").send({
      sessionId: session.id,
      text: "Explain it",
      visualContext: { visualMessageId: first.visualMessageId, revision: 2, action: "branch", sceneId: "act", selectedElementIds: ["request"] },
    }).expect(400);
    expect(invalid.body.error).toBe("invalid_visual_context");
    expect(listMessages(db, session.id)).toHaveLength(0);
    expect(runAgent).not.toHaveBeenCalled();
  });
});
