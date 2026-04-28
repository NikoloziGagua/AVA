import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { openDb } from "../server/src/state/db.js";
import { ActiveRuns } from "../server/src/orchestrator/active-runs.js";
import { PidfileRegistry } from "../server/src/process/pidfile.js";
import { issueToken } from "../server/src/auth/tokens.js";
import { requireToken } from "../server/src/auth/middleware.js";
import { healthRoutes } from "../server/src/routes/health.js";
import { authRoutes } from "../server/src/routes/auth.js";
import { chatRoutes } from "../server/src/routes/chat.js";
import { sessionsRoutes } from "../server/src/routes/sessions.js";
import { pushRoutes } from "../server/src/routes/push.js";
import { rulesRoutes } from "../server/src/routes/rules.js";
import { approvalsRoutes } from "../server/src/routes/approvals.js";
import { statusRoutes } from "../server/src/routes/status.js";
import { buildPolicyHook } from "../server/src/policy/runtime.js";
import type { RunOpts, AgentEvent } from "../server/src/orchestrator/agent.js";

export type TestServer = {
  url: string;
  token: string;
  db: ReturnType<typeof openDb>;
  close: () => Promise<void>;
};

/**
 * Build a fake runAgent that uses the real policy hook so the approval flow
 * persists rows + emits events the same way production does. The fake
 * inspects the prompt for "rm -rf" to pick a high-risk shell call (which
 * the classifier sees as "high" → ask), otherwise a benign one (low → allow).
 */
async function fakeRunAgent(opts: RunOpts): Promise<void> {
  const { prompt, abort, emit, db, sessionId } = opts;
  const policy = buildPolicyHook({
    db,
    sessionId,
    emit: (e) => emit(e as AgentEvent),
  });

  const command = prompt.includes("rm -rf") ? "rm -rf C:/tmp/x" : "echo hi";
  emit({ kind: "tool_call", payload: { tool: "shell", args: { command } } });
  const result = await policy("shell", { command });
  if (abort.signal.aborted) {
    emit({ kind: "killed", payload: {} });
    return;
  }
  if (result.allow) {
    emit({ kind: "tool_result", payload: { tool: "shell", ok: true, result: "ok" } });
    emit({ kind: "final", payload: { text: "ok" } });
  } else {
    emit({ kind: "tool_result", payload: { tool: "shell", ok: false, result: result.message } });
    emit({ kind: "final", payload: { text: "denied" } });
  }
  emit({ kind: "done", payload: {} });
}

/**
 * Spin up a real express server in-process with a stubbed runAgent + a stub
 * Chrome (the fake never touches it). Returns the bound url + a fresh token.
 */
export async function startTestServer(): Promise<TestServer> {
  // Fresh data dir so each test starts with a blank state.db.
  const dataDir = mkdtempSync(join(tmpdir(), "ava-e2e-"));
  process.env.LOG_LEVEL = "warn";
  delete process.env.ANTHROPIC_API_KEY; // forces metered.anthropic = null → no auto-title network call

  const db = openDb(join(dataDir, "state.db"));
  const runs = new ActiveRuns();
  const pidfiles = new PidfileRegistry(join(dataDir, "pidfiles"));

  // The real runAgent is replaced via runAgentImpl. The stub Chrome is
  // never actually used by the fake, but agentDeps.getChrome is awaited
  // unconditionally before invoking the impl.
  const stubChrome = {} as never;
  const agentDeps = {
    pidfiles,
    fsRoots: [resolve(dataDir, "fs-root")],
    getChrome: async () => stubChrome,
    runAgentImpl: fakeRunAgent,
  };

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const startedAt = Date.now();
  app.use("/api", healthRoutes(startedAt));
  app.use("/api/auth", authRoutes(db, requireToken(db)));
  app.use("/api/chat", chatRoutes(db, runs, requireToken(db), agentDeps, { anthropic: null }));
  app.use("/api/sessions", sessionsRoutes(db, requireToken(db)));
  app.use("/api/push", pushRoutes(db, requireToken(db), { vapidPublicKey: null }));
  app.use("/api/rules", rulesRoutes(db, requireToken(db), { anthropic: null }));
  app.use("/api/approvals", approvalsRoutes(db, requireToken(db)));
  app.use("/", statusRoutes({ db, runs, startedAt }));

  // Static PWA bundle.
  const webDistDir = fileURLToPath(new URL("../web/dist/", import.meta.url));
  app.use("/", express.static(webDistDir));

  const { id: _id, secret } = issueToken(db, { label: "e2e" });

  const server: Server = await new Promise((resolveListen) => {
    const s = app.listen(0, "127.0.0.1", () => resolveListen(s));
  });
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const close = async () => {
    await new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res())));
    try { db.close(); } catch { /* ignore */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  return { url, token: secret, db, close };
}
