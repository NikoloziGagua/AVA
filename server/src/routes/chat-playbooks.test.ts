import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { chatRoutes } from "./chat.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { listPlaybooks } from "../playbooks/store.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-pbwire-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-pbwire-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)").run("d", "h", "t", Date.now());
  const provider = new MockLLMProvider({
    scripts: [[{ kind: "delta", text: JSON.stringify({ trigger: "do thing", keywords: ["thing"], steps: ["a", "b"] }) }, { kind: "done", stop_reason: "end_turn" }]],
  });
  // Fake agent loop: emit two tool calls + a final so the collector sees a >=2-tool success.
  const runAgentImpl = vi.fn(async (opts: any) => {
    opts.emit({ kind: "tool_call", payload: { tool: "chrome_navigate", args: {} } });
    opts.emit({ kind: "tool_result", payload: { tool: "chrome_navigate", ok: true, result: "" } });
    opts.emit({ kind: "tool_call", payload: { tool: "fs_write", args: { path: "C:/ai/x" } } });
    opts.emit({ kind: "tool_result", payload: { tool: "fs_write", ok: true, result: "" } });
    opts.emit({ kind: "final", payload: { text: "done" } });
  });
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "d"; next(); });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_q, _s, n) => n(),
    { pidfiles: { register() {}, unregister() {} } as any, fsRoots: [], memoryDir, getChrome: async () => ({} as any), provider, runAgentImpl },
    { anthropic: null, openai: null }));
  return { app, memoryDir };
}

describe("chat playbook capture", () => {
  it("captures a playbook after a successful 2-tool run", async () => {
    const { app, memoryDir } = setup();
    await request(app).post("/api/chat").send({ text: "do the thing on my pc" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(listPlaybooks(memoryDir).length).toBe(1);
  });
});
