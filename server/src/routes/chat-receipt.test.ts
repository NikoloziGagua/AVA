import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import type { AgentEvent } from "../orchestrator/agent.js";
import type { TaskReceipt } from "../receipts/task-receipt.js";
import type { AutoMemoryCapture } from "../memory-index/auto-capture.js";
import { chatRoutes } from "./chat.js";

function setup(script: AgentEvent[], memoryAutoCapture?: AutoMemoryCapture) {
  const dir = mkdtempSync(join(tmpdir(), "ava-receipt-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-receipt-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("receipt-test", "hash-receipt-test", "receipt test", Date.now());
  const runAgentImpl = vi.fn(async (opts: { emit: (event: AgentEvent) => void }) => {
    for (const event of script) opts.emit(event);
  });
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req: express.Request & { deviceId?: string }, _res, next) => {
      req.deviceId = "receipt-test";
      next();
    });
    app.use("/api/chat", chatRoutes(
      db,
      new ActiveRuns(),
      (_req, _res, next) => next(),
      {
        pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
        fsRoots: [],
        memoryDir,
        dataDir: dir,
        getChrome: async () => ({} as never),
        provider: new MockLLMProvider({ scripts: [] }),
        runAgentImpl: runAgentImpl as never,
        memoryAutoCapture,
      },
      { anthropic: null, openai: null },
    ));
    return app;
  };
  return { app: buildApp(), restart: buildApp };
}

function parseSse(body: string): Array<{ event: string; data: unknown }> {
  const parsed: Array<{ event: string; data: unknown }> = [];
  for (const block of body.replace(/\r\n/g, "\n").split("\n\n")) {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (event && data) parsed.push({ event, data: JSON.parse(data) });
  }
  return parsed;
}

async function startAndReplay(app: express.Express, text: string) {
  const started = await request(app).post("/api/chat").send({ text });
  if (started.status !== 200) {
    throw new Error(`chat start failed (${started.status}): ${started.text}`);
  }
  // The fake runtime is intentionally faster than the EventSource connection.
  // The route's short-lived in-memory replay must preserve the receipt anyway.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stream = await request(app)
    .get(`/api/chat/${started.body.sessionId}/stream?taskId=${started.body.taskId}`)
    .expect(200);
  const events = parseSse(stream.text);
  return {
    events,
    receipt: events.find((event) => event.event === "receipt")?.data as TaskReceipt | undefined,
    taskId: started.body.taskId as string,
  };
}

describe("chat task receipt SSE", () => {
  it("replays a fast conversation receipt with the authoritative task ID", async () => {
    const { app } = setup([
      { kind: "final", payload: { text: "Hello, Sir." } },
      { kind: "done", payload: {} },
    ]);
    const result = await startAndReplay(app, "hello");

    expect(result.events.map((event) => event.event)).toEqual([
      "memory_context",
      "final",
      "receipt",
      "done",
    ]);
    expect(result.receipt).toMatchObject({
      schemaVersion: 2,
      taskId: result.taskId,
      lifecycle: "finished",
      outcome: "verified",
      verificationScope: "response_delivery",
    });
  });

  it("surfaces an isolated tool failure without persisting raw secrets in the receipt", async () => {
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
    const { app } = setup([
      { kind: "tool_call", payload: { tool: "shell", args: { command: "fixture only" } } },
      { kind: "tool_result", payload: { tool: "shell", ok: false, result: `fixture failed ${secret}` } },
      { kind: "final", payload: { text: "The isolated fixture failed." } },
      { kind: "done", payload: {} },
    ]);
    const result = await startAndReplay(app, `Run the isolated fixture using ${secret}`);

    expect(result.receipt).toMatchObject({
      lifecycle: "finished",
      outcome: "failed",
      failedToolResults: 1,
      rootCause: "likely",
    });
    expect(result.receipt?.observationPoint).toContain("shell returned an error");
    expect(JSON.stringify(result.receipt)).not.toContain(secret);
    expect(JSON.stringify(result.receipt)).toContain("sk-***");
  });

  it("does not replay a prior receipt when the client asks for a different task ID", async () => {
    const { app } = setup([
      { kind: "final", payload: { text: "Hello." } },
      { kind: "done", payload: {} },
    ]);
    const started = await request(app).post("/api/chat").send({ text: "hello" });
    if (started.status !== 200) throw new Error(`chat start failed (${started.status}): ${started.text}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stream = await request(app)
      .get(`/api/chat/${started.body.sessionId}/stream?taskId=another-task`)
      .expect(200);
    expect(parseSse(stream.text).some((event) => event.event === "receipt")).toBe(false);
  });

  it("replays the sanitized receipt after the route is recreated", async () => {
    const { app, restart } = setup([
      { kind: "final", payload: { text: "Durable reply." } },
      { kind: "done", payload: {} },
    ]);
    const started = await request(app).post("/api/chat").send({ text: "hello" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A new chatRoutes instance has an empty five-minute memory cache, exactly
    // like a process restart, but shares the authoritative SQLite state.
    const stream = await request(restart())
      .get(`/api/chat/${started.body.sessionId}/stream?taskId=${started.body.taskId}`)
      .expect(200);
    const receipt = parseSse(stream.text).find((event) => event.event === "receipt")?.data as TaskReceipt;
    expect(receipt).toMatchObject({ taskId: started.body.taskId, lifecycle: "finished" });
  });

  it("replays an exact older task even when the memory cache holds a newer receipt", async () => {
    const { app } = setup([
      { kind: "final", payload: { text: "Done." } },
      { kind: "done", payload: {} },
    ]);
    const first = await request(app).post("/api/chat").send({ text: "first task" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app).post("/api/chat").send({
      sessionId: first.body.sessionId,
      text: "second task",
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const stream = await request(app)
      .get(`/api/chat/${first.body.sessionId}/stream?taskId=${first.body.taskId}`)
      .expect(200);
    const receipt = parseSse(stream.text)
      .find((event) => event.event === "receipt")?.data as TaskReceipt;
    expect(receipt).toMatchObject({ taskId: first.body.taskId, expected: "first task" });
  });

  it("shows the parent objective when a terse retry continues an earlier task", async () => {
    const { app } = setup([
      { kind: "final", payload: { text: "Attempt complete." } },
      { kind: "done", payload: {} },
    ]);
    const first = await request(app).post("/api/chat").send({
      text: "Read and compare the five research articles.",
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const retried = await request(app).post("/api/chat").send({
      sessionId: first.body.sessionId,
      text: "try agin",
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stream = await request(app)
      .get(`/api/chat/${retried.body.sessionId}/stream?taskId=${retried.body.taskId}`)
      .expect(200);
    const receipt = parseSse(stream.text)
      .find((event) => event.event === "receipt")?.data as TaskReceipt;

    expect(receipt.expected).toBe(
      "Continue previous objective: Read and compare the five research articles.",
    );
  });

  it("offers one clean persisted turn to automatic memory with exact source IDs", async () => {
    const memoryAutoCapture = vi.fn<AutoMemoryCapture>(async () => ({
      status: "captured", reason: "fixture", entryId: "memory-fixture",
    }));
    const { app } = setup([
      { kind: "final", payload: { text: "The completed research answer is ready." } },
      { kind: "done", payload: {} },
    ], memoryAutoCapture);
    const started = await request(app).post("/api/chat").send({ text: "Research source-verified memory." }).expect(200);
    await vi.waitFor(() => expect(memoryAutoCapture).toHaveBeenCalledTimes(1));
    expect(memoryAutoCapture).toHaveBeenCalledWith({
      sessionId: started.body.sessionId,
      userMessageId: expect.any(Number),
      assistantMessageId: expect.any(Number),
      channel: "chat",
    });
    const input = memoryAutoCapture.mock.calls[0]![0];
    expect(input.userMessageId).toBeLessThan(input.assistantMessageId);
  });

  it("marks a persisted voice-origin turn with voice provenance", async () => {
    const memoryAutoCapture = vi.fn<AutoMemoryCapture>(async () => ({
      status: "captured", reason: "fixture", entryId: "memory-voice-fixture",
    }));
    const { app } = setup([
      { kind: "final", payload: { text: "The voice research answer is complete." } },
      { kind: "done", payload: {} },
    ], memoryAutoCapture);
    await request(app).post("/api/chat").send({
      text: "Research voice continuity.", voice: true,
    }).expect(200);
    await vi.waitFor(() => expect(memoryAutoCapture).toHaveBeenCalledTimes(1));
    expect(memoryAutoCapture.mock.calls[0]![0]).toMatchObject({ channel: "voice" });
  });

  it("does not offer failed or non-persisted action turns to automatic memory", async () => {
    const failedCapture = vi.fn<AutoMemoryCapture>(async () => ({
      status: "captured", reason: "should not run", entryId: "wrong",
    }));
    const failed = setup([
      { kind: "tool_call", payload: { tool: "shell", args: {} } },
      { kind: "tool_result", payload: { tool: "shell", ok: false, result: "failed" } },
      { kind: "final", payload: { text: "The operation failed." } },
      { kind: "done", payload: {} },
    ], failedCapture);
    await request(failed.app).post("/api/chat").send({ text: "Research after this failure." }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(failedCapture).not.toHaveBeenCalled();

    const actionCapture = vi.fn<AutoMemoryCapture>(async () => ({
      status: "captured", reason: "should not run", entryId: "wrong",
    }));
    const action = setup([
      { kind: "final", payload: { text: "Voice action done." } },
      { kind: "done", payload: {} },
    ], actionCapture);
    await request(action.app).post("/api/chat").send({
      text: "Research through delegated voice action.", voice: true, persist: false,
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(actionCapture).not.toHaveBeenCalled();
  });

  it("allows completed read/research turns whose executor evidence is honest but not independently verified", async () => {
    const memoryAutoCapture = vi.fn<AutoMemoryCapture>(async () => ({
      status: "captured", reason: "fixture", entryId: "memory-read-fixture",
    }));
    const { app } = setup([
      { kind: "tool_call", payload: { tool: "chrome_read_page", args: {} } },
      { kind: "tool_result", payload: { tool: "chrome_read_page", ok: true, result: "source text" } },
      { kind: "final", payload: { text: "The research synthesis is complete with its evidence limitations stated." } },
      { kind: "done", payload: {} },
    ], memoryAutoCapture);
    await request(app).post("/api/chat").send({ text: "Research a bounded topic." }).expect(200);
    await vi.waitFor(() => expect(memoryAutoCapture).toHaveBeenCalledTimes(1));
  });
});
