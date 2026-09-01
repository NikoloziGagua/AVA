import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { PidfileRegistry } from "../process/pidfile.js";
import { chatRoutes } from "./chat.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

// Capture every pid tree-kill is asked to kill, so we can assert the kill
// endpoint reaches the run's child PIDs (not just abort()).
const killed: number[] = [];
const cancelAllImprovements = vi.hoisted(() => vi.fn(() => 1));
vi.mock("tree-kill", () => ({
  default: (pid: number, _sig: string, cb: (e?: Error) => void) => {
    killed.push(pid);
    cb();
  },
}));
vi.mock("../self/improver.js", () => ({ cancelAllImprovements }));

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-kill-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-kill-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)").run("d", "h", "t", Date.now());
  const runs = new ActiveRuns();
  const pidfiles = new PidfileRegistry(join(dir, "pidfiles"));

  // Fake agent loop: simulate a running tool by registering two child PIDs
  // under the run's runId, then block until the run is aborted (Stop). This is
  // exactly the "tool already executing" state the kill must reach.
  const FAKE_PIDS = [424242, 424243];
  const runAgentImpl = vi.fn(async (opts: { runId: string; abort: AbortController }) => {
    for (const pid of FAKE_PIDS) pidfiles.add(opts.runId, pid);
    await new Promise<void>((resolve) => {
      if (opts.abort.signal.aborted) return resolve();
      opts.abort.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  });

  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { deviceId?: string }, _res, next) => { req.deviceId = "d"; next(); });
  app.use("/api/chat", chatRoutes(
    db, runs, (_q, _s, n) => n(),
    {
      pidfiles, fsRoots: [], memoryDir, dataDir: dir,
      getChrome: async () => ({} as never),
      provider: new MockLLMProvider({ scripts: [] }),
      runAgentImpl: runAgentImpl as never,
    },
    { anthropic: null, openai: null },
  ));
  return { app, runs, pidfiles, FAKE_PIDS, db };
}

describe("chat kill endpoint", () => {
  it("killTrees the run's child PIDs (not just abort) when Stop is pressed", async () => {
    killed.length = 0;
    cancelAllImprovements.mockClear();
    const { app, FAKE_PIDS, runs } = setup();

    // Start a run; the fake agent registers child PIDs and blocks on abort.
    const started = await request(app).post("/api/chat").send({ text: "do a long thing" }).expect(200);
    const sessionId = started.body.sessionId as string;

    // Give the fire-and-forget run a tick to register its child PIDs.
    await new Promise((r) => setTimeout(r, 30));

    const active = runs.get(sessionId);
    expect(active).toBeDefined();

    const res = await request(app).post(`/api/chat/${sessionId}/kill`).send().expect(200);
    expect(res.body.aborted).toBe(true);
    expect(res.body.cancelledImprovements).toBe(0);
    expect(cancelAllImprovements).not.toHaveBeenCalled();

    // The kill endpoint must have killed every child pid the run registered.
    for (const pid of FAKE_PIDS) expect(killed).toContain(pid);
    // Cancellation evidence is buffered before the route frees the run slot,
    // so an already-open stream sees Stop rather than a synthetic tool failure.
    expect(active!.buffer.since(0).events.map((event) => event.kind)).toEqual([
      "memory_context",
      "receipt",
      "killed",
    ]);
  });

  it("kill on a session with no active run is a no-op (no PIDs killed)", async () => {
    killed.length = 0;
    cancelAllImprovements.mockClear();
    const { app } = setup();
    const res = await request(app).post(`/api/chat/no-such-session/kill`).send().expect(200);
    expect(res.body.aborted).toBe(false);
    expect(res.body.cancelledImprovements).toBe(0);
    expect(cancelAllImprovements).not.toHaveBeenCalled();
    expect(killed).toEqual([]);
  });

  it("kill-all preserves the deliberate global Stop for self-development", async () => {
    killed.length = 0;
    cancelAllImprovements.mockClear();
    const { app } = setup();
    const res = await request(app).post("/api/chat/no-such-session/kill-all").send().expect(200);
    expect(res.body).toEqual({ aborted: false, cancelledImprovements: 1 });
    expect(cancelAllImprovements).toHaveBeenCalledWith(expect.anything(), "global_stop");
  });
});
