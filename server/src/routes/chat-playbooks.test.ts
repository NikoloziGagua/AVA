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
function setup(over: { provider?: LLMProvider; runAgentImpl?: (opts: any) => Promise<void>; generatedPlaybooks?: any } = {}) {
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
    opts.emit({ kind: "tool_result", payload: {
      tool: "fs_write", ok: true, result: "written",
      verification: {
        state: "verified", scope: "task_outcome", method: "fixture_readback",
        summary: "The fixture file matched exactly.",
      },
    } });
    opts.emit({ kind: "final", payload: { text: "done" } });
  });
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "d"; next(); });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_q, _s, n) => n(),
    { pidfiles: { register() {}, unregister() {} } as any, fsRoots: [], memoryDir, dataDir: dir,
      getChrome: async () => ({} as any), provider, runAgentImpl, generatedPlaybooks: over.generatedPlaybooks },
    { anthropic: null, openai: null }));
  return { app, memoryDir, db, runAgentImpl };
}

describe("chat playbook capture", () => {
  it("captures a playbook only after a verified 2-tool run", async () => {
    const { app, memoryDir } = setup();
    await request(app).post("/api/chat").send({ text: "do the thing on my pc" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(listPlaybooks(memoryDir).length).toBe(1);
    expect(listPlaybooks(memoryDir)[0]!.learning?.verified).toBe(1);
  });

  it("does not turn a final reply plus executor ok into a learned procedure", async () => {
    const { app, memoryDir } = setup({
      runAgentImpl: async (opts) => {
        for (const tool of ["chrome_navigate", "fs_write"]) {
          opts.emit({ kind: "tool_call", payload: { tool, args: {} } });
          opts.emit({ kind: "tool_result", payload: { tool, ok: true, result: "ok" } });
        }
        opts.emit({ kind: "final", payload: { text: "done" } });
      },
    });
    await request(app).post("/api/chat").send({ text: "do the thing on my pc" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listPlaybooks(memoryDir)).toHaveLength(0);
  });

  it("counts one verified task once when recall and re-distillation meet", async () => {
    const { app, memoryDir } = setup();
    writePlaybook(memoryDir, {
      slug: "do-thing", trigger: "do thing", keywords: ["thing"],
      created: "2026-08-01", last_used: "2026-08-01", uses: 1,
      stakes: "routine", steps: ["a", "b"], version: 1,
      succ: 0, fail: 0, avg_secs: 0, lessons: [],
    });
    await request(app).post("/api/chat").send({ text: "please do thing now" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listPlaybooks(memoryDir)).toHaveLength(1);
    expect(listPlaybooks(memoryDir)[0]!.learning?.verified).toBe(1);
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
      version: 1, succ: 0, fail: 0, avg_secs: 0, lessons: [],
    });
    await request(app).post("/api/chat").send({ text: "do the seeded task" }).expect(200);
  });

  it("does NOT capture a playbook when a tool in the run failed", async () => {
    // Two tools, but the second FAILS. A failed procedure must not be learned.
    const { app, memoryDir } = setup({
      runAgentImpl: async (opts) => {
        opts.emit({ kind: "tool_call", payload: { tool: "chrome_navigate", args: {} } });
        opts.emit({ kind: "tool_result", payload: { tool: "chrome_navigate", ok: true, result: "" } });
        opts.emit({ kind: "tool_call", payload: { tool: "fs_write", args: { path: "C:/ai/x" } } });
        opts.emit({ kind: "tool_result", payload: { tool: "fs_write", ok: false, result: "EACCES" } });
        opts.emit({ kind: "final", payload: { text: "couldn't finish" } });
      },
    });
    await request(app).post("/api/chat").send({ text: "do the thing on my pc" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(listPlaybooks(memoryDir).length).toBe(0);
  });

  it("an empty final persists the graceful text, not a blank assistant turn", async () => {
    const { app, db } = setup({
      runAgentImpl: async (opts) => {
        opts.emit({ kind: "final", payload: { text: "   " } });
      },
    });
    await request(app).post("/api/chat").send({ text: "do something" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    const sid = (db.prepare("SELECT id FROM sessions LIMIT 1").get() as { id: string }).id;
    const assistant = listMessages(db, sid).find((m) => m.role === "assistant");
    expect(assistant).toBeTruthy();
    expect(assistant!.content.trim().length).toBeGreaterThan(0);
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

  it("offers only evidence-backed completed tool runs to automatic playbook observation", async () => {
    const observeVerifiedRun = vi.fn();
    const { app } = setup({
      generatedPlaybooks: { matchActive: () => null, observeVerifiedRun, list: () => [], active: () => [] },
      runAgentImpl: async (opts) => {
        opts.emit({ kind: "tool_call", payload: { tool: "instagram_open_chat", args: { person: "Lasha" } } });
        opts.emit({ kind: "tool_result", payload: { tool: "instagram_open_chat", ok: true, result: "opened", verification: {
          state: "verified", scope: "task_outcome", method: "instagram_thread_identity", summary: "Matched @\u005fprinci150",
        } } });
        opts.emit({ kind: "final", payload: { text: "Opened Lasha's chat." } });
        opts.emit({ kind: "done", payload: {} });
      },
    });
    await request(app).post("/api/chat").send({ text: "Open Lasha's Instagram chat" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observeVerifiedRun).toHaveBeenCalledTimes(1);
    expect(observeVerifiedRun).toHaveBeenCalledWith(expect.objectContaining({
      goal: "Open Lasha's Instagram chat", outcome: "verified",
      steps: [{ tool: "instagram_open_chat", args: { person: "Lasha" }, ok: true,
        verification: expect.objectContaining({ state: "verified", method: "instagram_thread_identity" }) }],
    }));
  });

  it("forwards per-step verification so heterogeneous procedures can compile safely", async () => {
    const observeVerifiedRun = vi.fn();
    const { app } = setup({
      generatedPlaybooks: { matchActive: () => null, observeVerifiedRun, list: () => [], active: () => [] },
      runAgentImpl: async (opts) => {
        opts.emit({ kind: "tool_call", payload: { tool: "chrome_google_search", args: { query: "AVA proof" } } });
        opts.emit({ kind: "tool_result", payload: { tool: "chrome_google_search", ok: true, result: "opened",
          verification: { state: "verified", scope: "task_outcome", method: "chrome_google_search_url",
            summary: "Exact Google query URL matched." } } });
        opts.emit({ kind: "tool_call", payload: { tool: "instagram_open_chat", args: { person: "Lasha" } } });
        opts.emit({ kind: "tool_result", payload: { tool: "instagram_open_chat", ok: true, result: "opened",
          verification: { state: "verified", scope: "task_outcome", method: "instagram_thread_identity",
            summary: "Exact profile identity matched." } } });
        opts.emit({ kind: "final", payload: { text: "Done." } });
        opts.emit({ kind: "done", payload: {} });
      },
    });
    await request(app).post("/api/chat").send({ text: "Search Google then open Lasha's Instagram chat" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(observeVerifiedRun).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "verified",
      steps: [
        expect.objectContaining({ tool: "chrome_google_search", verification: expect.objectContaining({
          method: "chrome_google_search_url" }) }),
        expect.objectContaining({ tool: "instagram_open_chat", verification: expect.objectContaining({
          method: "instagram_thread_identity" }) }),
      ],
    }));
  });

  it("injects an approved generated playbook hint for matching chat requests", async () => {
    const runAgentImpl = vi.fn(async (opts: any) => {
      opts.emit({ kind: "final", payload: { text: "done" } });
      opts.emit({ kind: "done", payload: {} });
    });
    const { app } = setup({
      runAgentImpl,
      generatedPlaybooks: {
        matchActive: () => ({ playbookId: "ava.learned.instagram-open-chat.fixture", displayName: "Open Lasha's Instagram chat" }),
        observeVerifiedRun: () => null, list: () => [], active: () => [],
      },
    });
    await request(app).post("/api/chat").send({ text: "Open Lasha's Instagram chat" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runAgentImpl).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Use automation_run_playbook with playbookId ava.learned.instagram-open-chat.fixture"),
    }));
  });
});
