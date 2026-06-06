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
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { listPlaybooks, writePlaybook } from "../playbooks/store.js";
import { listMessages } from "../state/messages.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setup(over: { provider?: LLMProvider; runAgentImpl?: (opts: any) => Promise<void> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ava-pbwire-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-pbwire-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)").run("d", "h", "t", Date.now());
  const provider = over.provider ?? new MockLLMProvider({
    scripts: [[{ kind: "delta", text: JSON.stringify({ trigger: "do thing", keywords: ["thing"], steps: ["a", "b"] }) }, { kind: "done", stop_reason: "end_turn" }]],
  });
  // Fake agent loop: emit two tool calls + a final so the collector sees a >=2-tool success.
  const runAgentImpl = over.runAgentImpl ?? vi.fn(async (opts: any) => {
    opts.emit({ kind: "tool_call", payload: { tool: "chrome_navigate", args: {} } });
    opts.emit({ kind: "tool_result", payload: { tool: "chrome_navigate", ok: true, result: "" } });
    opts.emit({ kind: "tool_call", payload: { tool: "fs_write", args: { path: "C:/ai/x" } } });
    opts.emit({ kind: "tool_result", payload: { tool: "fs_write", ok: true, result: "" } });
    opts.emit({ kind: "final", payload: { text: "done" } });
  });
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "d"; next(); });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_q, _s, n) => n(),
    { pidfiles: { register() {}, unregister() {} } as any, fsRoots: [], memoryDir, dataDir: dir, getChrome: async () => ({} as any), provider, runAgentImpl },
    { anthropic: null, openai: null }));
  return { app, memoryDir, db };
}

describe("chat playbook capture", () => {
  it("captures a playbook after a successful 2-tool run", async () => {
    const { app, memoryDir } = setup();
    await request(app).post("/api/chat").send({ text: "do the thing on my pc" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(listPlaybooks(memoryDir).length).toBe(1);
  });

  it("survives a recall-match failure (best-effort, never breaks the turn)", async () => {
    // A provider with no scripts throws on stream — simulating the LLM timeout
    // that previously escaped the route handler and hung the turn.
    const bad = new MockLLMProvider({ scripts: [] });
    const { app, memoryDir } = setup({ provider: bad });
    // Seed a playbook so the recall path actually runs the (failing) matcher.
    writePlaybook(memoryDir, {
      slug: "seeded", trigger: "seeded task", keywords: [], created: "2026-06-02",
      last_used: "2026-06-02", uses: 1, stakes: "routine", steps: ["a", "b"],
    });
    await request(app).post("/api/chat").send({ text: "do the seeded task" }).expect(200);
  });

  it("persists an assistant message when the run errors (visible, not silent)", async () => {
    const { app, db } = setup({
      runAgentImpl: async (opts) => {
        opts.emit({ kind: "error", payload: { message: "You exceeded your current quota" } });
      },
    });
    await request(app).post("/api/chat").send({ text: "do something" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    const sid = (db.prepare("SELECT id FROM sessions LIMIT 1").get() as { id: string }).id;
    const msgs = listMessages(db, sid);
    const assistant = msgs.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("exceeded your current quota");
  });
});
