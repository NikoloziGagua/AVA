import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { runAgent, type AgentEvent } from "../orchestrator/agent.js";
import { CAPABILITIES_MD } from "../orchestrator/capabilities-content.js";
import { capabilityIdsForTool } from "../explorer/registry.js";
import type { AgentroomService } from "../agentroom/service.js";
import { chatRoutes } from "./chat.js";

const roomPost = { schemaVersion: 1 as const, messageId: 75, roomName: "klevar", correlationId: "run_room", postedAt: 1234 };

function setup(
  runAgentImpl?: (opts: any) => Promise<void>,
  agentroom?: Partial<AgentroomService>,
  provider = new MockLLMProvider({ scripts: [] }),
) {
  const dataDir = mkdtempSync(join(tmpdir(), "ava-room-chat-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-room-memory-"));
  const db = openDb(join(dataDir, "state.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
    .run("room-device", "room-device-hash", "test", Date.now());
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "room-device"; next(); });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_req, _res, next) => next(), {
    pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
    fsRoots: [], memoryDir, dataDir,
    getChrome: async () => ({} as never),
    provider,
    ...(runAgentImpl ? { runAgentImpl: runAgentImpl as never } : {}),
    ...(agentroom ? { agentroom: { toolsEnabled: () => false, ...agentroom } as AgentroomService } : {}),
  }, { anthropic: null, openai: null }));
  return { app, db };
}

async function settle() { await new Promise((resolve) => setTimeout(resolve, 30)); }

describe("agentroom evidence on the chat boundary", () => {
  it("offers the development-room tools without registering the retired Strategy Room tool", async () => {
    let toolNames: string[] = [];
    const run = vi.fn(async (opts: { deps: { tools: Array<{ tool: { name: string } }> }; emit: (event: AgentEvent) => void }) => {
      toolNames = opts.deps.tools.map((tool) => tool.tool.name);
      opts.emit({ kind: "final", payload: { text: "The development room is ready." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app } = setup(run, {
      toolsEnabled: () => true,
      unreadContext: vi.fn().mockResolvedValue(""),
      post: vi.fn().mockResolvedValue(roomPost),
      read: vi.fn().mockResolvedValue([]),
    });

    await request(app).post("/api/chat").send({ text: "take this to the room" }).expect(200);
    await settle();

    expect(toolNames).toEqual(expect.arrayContaining(["room_read", "room_post"]));
    expect(toolNames).not.toContain("strategy_room_open");
    expect(CAPABILITIES_MD).toContain('"The room" means the live development room');
    expect(CAPABILITIES_MD).not.toContain("strategy_room_open");
    expect(capabilityIdsForTool("strategy_room_open")).toEqual([]);
    expect(capabilityIdsForTool("room_read")).toEqual(["developer-collaboration.agentroom"]);
    expect(capabilityIdsForTool("room_post")).toEqual(["developer-collaboration.agentroom"]);
  });

  it("carries a real tool result receipt through runAgent into SSE and message metadata", async () => {
    const provider = new MockLLMProvider({ scripts: [
      [
        { kind: "tool_call", call: { id: "room-call-1", name: "room_post", args: { body: "Review this bounded proposal." } } },
        { kind: "done", stop_reason: "tool_use" },
      ],
      [
        { kind: "delta", text: "Posted to the development room." },
        { kind: "done", stop_reason: "end_turn" },
      ],
    ] });
    const post = vi.fn().mockResolvedValue(roomPost);
    const events: AgentEvent[] = [];
    const integratedRun = (opts: Parameters<typeof runAgent>[0]) => runAgent({
      ...opts,
      emit: (event) => {
        events.push(event);
        opts.emit(event);
      },
    });
    const { app, db } = setup(integratedRun, {
      toolsEnabled: () => true,
      unreadContext: vi.fn().mockResolvedValue(""),
      post,
      read: vi.fn().mockResolvedValue([]),
    }, provider);

    const started = await request(app).post("/api/chat")
      .send({ text: "Post this bounded proposal to the development room" })
      .expect(200);
    await vi.waitFor(() => {
      expect(events.find((event) => event.kind === "tool_result")?.payload).toMatchObject({
        tool: "room_post",
        ok: true,
        roomPost,
      });
      const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant");
      expect(assistant?.metadata?.roomPosts).toEqual({ schemaVersion: 1, items: [roomPost] });
    });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      body: "Review this bounded proposal.",
      sessionId: started.body.sessionId,
      runId: expect.any(String),
    }), expect.any(AbortSignal));

    const stream = await request(app).get(`/api/chat/${started.body.sessionId}/stream?taskId=${started.body.taskId}`)
      .buffer(true).parse((res, done) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        res.on("end", () => done(null, body));
      });
    expect(stream.body).toContain("event: room_posts");
    expect(stream.body).toContain('"messageId":75');
  });

  it("persists and replays only successful authoritative post receipts", async () => {
    const run = vi.fn(async (opts: { emit: (event: AgentEvent) => void }) => {
      opts.emit({ kind: "tool_result", payload: { tool: "room_post", ok: true, result: "posted", roomPost } });
      opts.emit({ kind: "tool_result", payload: { tool: "room_post", ok: false, result: "offline", roomPost: { ...roomPost, messageId: 99 } } });
      opts.emit({ kind: "final", payload: { text: "I posted it." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app, db } = setup(run);
    const started = await request(app).post("/api/chat").send({ text: "bring this to the dev room" }).expect(200);
    await settle();
    const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant")!;
    expect(assistant.metadata?.roomPosts).toEqual({ schemaVersion: 1, items: [roomPost] });

    const stream = await request(app).get(`/api/chat/${started.body.sessionId}/stream?taskId=${started.body.taskId}`)
      .buffer(true).parse((res, done) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        res.on("end", () => done(null, body));
      });
    expect(stream.body).toContain("event: room_posts");
    expect(stream.body).toContain('"messageId":75');
    expect(stream.body).not.toContain('"messageId":99');
    expect(stream.body.indexOf("event: room_posts")).toBeLessThan(stream.body.indexOf("event: done"));
  });

  it("injects unread room discussion as untrusted context without blocking ordinary chat", async () => {
    let prompt = "";
    const run = vi.fn(async (opts: { prompt: string; emit: (event: AgentEvent) => void }) => {
      prompt = opts.prompt;
      opts.emit({ kind: "final", payload: { text: "Understood." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const unreadContext = vi.fn().mockResolvedValue("[UNTRUSTED DEVELOPMENT ROOM DISCUSSION]\n#2 from Claude: review finished\n[/UNTRUSTED DEVELOPMENT ROOM DISCUSSION]");
    const { app } = setup(run, { unreadContext, toolsEnabled: () => false });
    await request(app).post("/api/chat").send({ text: "what changed?" }).expect(200);
    await settle();
    expect(unreadContext).toHaveBeenCalled();
    expect(prompt).toContain("UNTRUSTED DEVELOPMENT ROOM DISCUSSION");
    expect(prompt).toContain("what changed?");
  });

  it("continues when unread room retrieval fails", async () => {
    const run = vi.fn(async (opts: { emit: (event: AgentEvent) => void }) => {
      opts.emit({ kind: "final", payload: { text: "Normal reply." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app, db } = setup(run, { unreadContext: vi.fn().mockResolvedValue("") });
    const started = await request(app).post("/api/chat").send({ text: "hello there" }).expect(200);
    await settle();
    expect(listMessages(db, started.body.sessionId).some((message) => message.content === "Normal reply.")).toBe(true);
  });
});
