import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { ObservabilityService } from "../observability/store.js";
import type { RunOpts } from "../orchestrator/agent.js";
import { readPlaybook, writePlaybook } from "../playbooks/store.js";
import { chatRoutes } from "./chat.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-chat-route-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-chat-route-memory-"));
  const db = openDb(join(dir, "ava.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
    .run("route-fixture", "hash-route-fixture", "route fixture", Date.now());
  const calls: RunOpts[] = [];
  const memorySearch = vi.fn(async () => ({
    query: "",
    mode: "keyword" as const,
    semanticAvailable: false,
    notice: null,
    results: [],
  }));
  const observability = new ObservabilityService(db);
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { deviceId?: string }, _res, next) => {
    req.deviceId = "route-fixture";
    next();
  });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_req, _res, next) => next(), {
    pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
    fsRoots: [],
    memoryDir,
    memoryIndex: { search: memorySearch } as never,
    dataDir: dir,
    getChrome: async () => ({} as never),
    provider: new MockLLMProvider({ scripts: [] }),
    runAgentImpl: vi.fn(async (opts: RunOpts) => {
      calls.push(opts);
      opts.emit({ kind: "final", payload: { text: "route captured" } });
      opts.emit({ kind: "done", payload: {} });
    }),
    observability,
  }, { anthropic: null, openai: null }));
  return { app, calls, memoryDir, memorySearch, observability };
}

describe("chat computer execution routing", () => {
  it("selects the direct Google route from the literal turn and skips irrelevant memory", async () => {
    const fixture = setup();
    writePlaybook(fixture.memoryDir, {
      slug: "google-search",
      trigger: "Open Google and search",
      keywords: ["google", "search"],
      created: "2026-08-28",
      last_used: "",
      uses: 0,
      stakes: "routine",
      steps: ["Use a browser."],
      version: 1,
      succ: 0,
      fail: 0,
      avg_secs: 0,
      lessons: [],
    });
    const response = await request(fixture.app).post("/api/chat").send({
      text: "Open Google and search for AVA ROUTER TEST",
    }).expect(200);
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(1));

    expect(fixture.calls[0]!.computerExecutionPlan).toMatchObject({
      status: "execute",
      executor: "ava_chrome",
      toolName: "chrome_google_search",
      args: { query: "AVA ROUTER TEST" },
    });
    expect(fixture.memorySearch).not.toHaveBeenCalled();
    expect(readPlaybook(fixture.memoryDir, "google-search")?.uses).toBe(0);
    expect(fixture.observability.getEvents(response.body.taskId)
      .find((event) => event.type === "memory.retrieval.suppressed"))
      .toMatchObject({ status: "skipped" });
  });

  it("does not fast-route a compound research request", async () => {
    const fixture = setup();
    await request(fixture.app).post("/api/chat").send({
      text: "Open Google and search for AVA, then summarize the strongest three sources",
    }).expect(200);
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(1));

    expect(fixture.calls[0]!.computerExecutionPlan).toBeNull();
    expect(fixture.memorySearch).toHaveBeenCalledTimes(1);
  });

  it("uses the same direct route for a voice-originated action turn", async () => {
    const fixture = setup();
    await request(fixture.app).post("/api/chat").send({
      text: "Open Google and search for AVA VOICE ROUTER TEST",
      voice: true,
      persist: false,
    }).expect(200);
    await vi.waitFor(() => expect(fixture.calls).toHaveLength(1));

    expect(fixture.calls[0]!.mode).toBe("action");
    expect(fixture.calls[0]!.computerExecutionPlan).toMatchObject({
      status: "execute",
      executor: "ava_chrome",
      args: { query: "AVA VOICE ROUTER TEST" },
    });
    expect(fixture.memorySearch).not.toHaveBeenCalled();
  });
});
