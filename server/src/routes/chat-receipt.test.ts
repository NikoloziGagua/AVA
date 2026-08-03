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
import { chatRoutes } from "./chat.js";

function setup(script: AgentEvent[]) {
  const dir = mkdtempSync(join(tmpdir(), "ava-receipt-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-receipt-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("receipt-test", "hash-receipt-test", "receipt test", Date.now());
  const runs = new ActiveRuns();
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { deviceId?: string }, _res, next) => {
    req.deviceId = "receipt-test";
    next();
  });
  const runAgentImpl = vi.fn(async (opts: { emit: (event: AgentEvent) => void }) => {
    for (const event of script) opts.emit(event);
  });
  app.use("/api/chat", chatRoutes(
    db,
    runs,
    (_req, _res, next) => next(),
    {
      pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
      fsRoots: [],
      memoryDir,
      dataDir: dir,
      getChrome: async () => ({} as never),
      provider: new MockLLMProvider({ scripts: [] }),
      runAgentImpl: runAgentImpl as never,
    },
    { anthropic: null, openai: null },
  ));
  return { app };
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

    expect(result.events.map((event) => event.event)).toEqual(["final", "receipt", "done"]);
    expect(result.receipt).toMatchObject({
      schemaVersion: 1,
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
});
