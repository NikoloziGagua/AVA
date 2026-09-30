import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { openDb } from "../state/db.js";
import { getExplorerTask } from "../explorer/store.js";
import { chatRoutes } from "./chat.js";

function setup(runAgentImpl: (opts: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "ava-explorer-chat-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-explorer-chat-memory-"));
  const db = openDb(join(dir, "state.db"));
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("test-device", "test-hash", "test", Date.now());
  const runs = new ActiveRuns();
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { deviceId?: string }, _res, next) => {
    req.deviceId = "test-device";
    next();
  });
  app.use("/api/chat", chatRoutes(
    db,
    runs,
    (_req, _res, next) => next(),
    {
      pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as any,
      fsRoots: [],
      memoryDir,
      dataDir: dir,
      getChrome: async () => ({} as any),
      provider: new MockLLMProvider({ scripts: [] }),
      runAgentImpl: runAgentImpl as never,
    },
    { anthropic: null, openai: null },
  ));
  return { app, db, runs };
}

async function waitForRun(runs: ActiveRuns, sessionId: string) {
  for (let attempt = 0; attempt < 50 && runs.get(sessionId); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("chat Explorer instrumentation", () => {
  it("returns a taskId and records persist:false voice handoffs without leaking secrets", async () => {
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const fake = vi.fn(async (opts: { emit: (event: any) => void }) => {
      opts.emit({
        kind: "tool_call",
        payload: { tool: "instagram_login", args: { username: "nika", password: "hunter2" } },
      });
      opts.emit({
        kind: "tool_result",
        payload: { tool: "instagram_login", ok: false, result: `failed with ${secret}` },
      });
      opts.emit({ kind: "final", payload: { text: "Login failed safely." } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app, db, runs } = setup(fake);

    const response = await request(app)
      .post("/api/chat")
      .send({ text: "log in to Instagram", persist: false })
      .expect(200);
    expect(response.body.taskId).toEqual(expect.any(String));
    await waitForRun(runs, response.body.sessionId);

    const task = getExplorerTask(db, response.body.taskId)!;
    expect(task.status).toBe("finished");
    expect(task.outcome).toBe("finished_with_errors_unverified");
    expect(task.toolCallCount).toBe(1);
    expect(task.events.some((event) => event.type === "tool_call_completed" && event.status === "error")).toBe(true);
    const serialised = JSON.stringify(task);
    expect(serialised).not.toContain("hunter2");
    expect(serialised).not.toContain("AbCdEf0123456789");
    db.close();
  });

  it("records an escaped run crash and closes the task", async () => {
    const { app, db, runs } = setup(async () => {
      throw new Error("provider exploded with password: do-not-store");
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ text: "do a thing" })
      .expect(200);
    await waitForRun(runs, response.body.sessionId);

    const task = getExplorerTask(db, response.body.taskId)!;
    expect(task.status).toBe("failed");
    expect(task.outcome).toBe("failed_safely");
    expect(task.events.some((event) => event.type === "error")).toBe(true);
    expect(JSON.stringify(task)).not.toContain("do-not-store");
    db.close();
  });
});
