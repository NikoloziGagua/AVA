import "./net-tuning.js"; // MUST be first: happy-eyeballs for IPv6-only/NAT64 networks
import express from "express";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { buildLogger } from "./logs/logger.js";
import { openDb } from "./state/db.js";
import { purgeDeletedSessions } from "./state/sessions.js";
import { buildRealtimeProxy } from "./routes/voice-realtime.js";
import { issuePairingCode } from "./auth/pairing.js";
import { requireToken } from "./auth/middleware.js";
import { issueToken } from "./auth/tokens.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { healthRoutes } from "./routes/health.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { statusRoutes } from "./routes/status.js";
import { pushRoutes } from "./routes/push.js";
import { rulesRoutes } from "./routes/rules.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { voiceRoutes } from "./routes/voice.js";
import { chipsRoutes } from "./routes/chips.js";
import { reasoningRoutes } from "./routes/reasoning.js";
import { memoryRoutes } from "./routes/memory.js";
import { ActiveRuns } from "./orchestrator/active-runs.js";
import { startSystray } from "./systray/index.js";
import { PidfileRegistry } from "./process/pidfile.js";
import { killTree } from "./process/kill-tree.js";
import { runRecovery } from "./state/recovery.js";
import { buildChrome } from "./tools/chrome.js";
import { buildVoiceClients } from "./tools/voice-clients.js";
import { buildDeliverer } from "./push/deliver.js";
import { buildProvider } from "./orchestrator/llm/factory.js";
import { bootstrapMemoryDir } from "./memory/bootstrap.js";
import { buildClaudeCode } from "./tools/claude-code.js";
import { reflect } from "./self/reflect.js";
import { loadSelfKnowledge } from "./self/identity.js";
import { addWorktree, removeWorktree } from "./self/worktree.js";
import { headSha, swapTo, revertTo } from "./self/swap.js";
import { verify } from "./self/verify.js";
import { buildRunner } from "./self/verify-runner.js";
import { bootSmoke } from "./self/boot-smoke.js";
import { runImprovement, type ImproverDeps } from "./self/improver.js";
import { createIntent, getIntent, listIntents, failStaleIntents } from "./self/intents.js";
import { selfRoutes } from "./routes/self.js";

const startedAt = Date.now();
const cfg = loadConfig();
const log = await buildLogger({ level: cfg.logLevel, dir: cfg.logsDir });
const db = openDb(cfg.dbPath);
// Reconcile self-improvement intents orphaned by a previous restart: nothing is
// in flight at boot, so any non-terminal intent is dead — mark it failed so it
// doesn't report as forever-"implementing".
{
  const reconciled = failStaleIntents(db);
  if (reconciled > 0) log.info({ reconciled }, "self: failed stale intents orphaned by restart");
}
const purgedCount = purgeDeletedSessions(db, Date.now() - 24 * 60 * 60 * 1000);
if (purgedCount > 0) log.info({ purgedCount }, "purged soft-deleted sessions older than 24h");
const runs = new ActiveRuns();
const pidfiles = new PidfileRegistry(cfg.pidfileDir);

await runRecovery({ db, pidfiles, kill: (pid) => killTree(pid) });
bootstrapMemoryDir({ dir: cfg.memoryDir });

let chromePromise: ReturnType<typeof buildChrome> | null = null;
async function getChrome() {
  if (chromePromise) {
    try {
      const existing = await chromePromise;
      if (existing.isAlive()) return existing;
    } catch {
      // build previously rejected — fall through and rebuild
    }
    log.info("chrome window was closed/disconnected — rebuilding");
    chromePromise = null;
  }
  chromePromise = buildChrome({
    profileDir: cfg.chromeProfileDir,
    screenshotDir: cfg.screenshotDir,
  });
  return chromePromise;
}
// Single-tenant by design: the persistent chromium context is shared across all
// chat runs in this process. Concurrent runs would race on the same active page;
// chat.ts blocks a second run within a session at line 42, but cross-session
// concurrency is not currently guarded. Fine for one user, one phone.

const deliverer = (cfg.vapidPublicKey && cfg.vapidPrivateKey)
  ? buildDeliverer({
      db,
      vapid: {
        publicKey: cfg.vapidPublicKey!,
        privateKey: cfg.vapidPrivateKey!,
        subject: process.env.VAPID_SUBJECT ?? "mailto:nobody@example.com",
      },
    })
  : null;
const pushDeliver = deliverer
  ? (a: import("./state/approvals.js").Approval) => deliverer.deliverApprovalPush(a).then(() => undefined)
  : undefined;
// Fire-and-forget "task done" ping to Sir's phone when an action run finishes.
const notifyDone = deliverer
  ? (summary: string) => { void deliverer.deliverDonePush(summary).catch(() => { /* best-effort */ }); }
  : undefined;

const provider = buildProvider({
  preferred: cfg.llmProvider,
  openaiApiKey: cfg.openaiApiKey,
  anthropicApiKey: cfg.anthropicApiKey,
  log,
});

// ─── Self-improvement wiring ─────────────────────────────────────────────
// claude_code for self-edits runs in a git worktree under the OS temp dir, so
// its path allowlist must permit tmpdir (NOT the normal fsRoots). The worktree
// is a clean git checkout — .env is gitignored so it isn't present there.
const selfClaudeCode = buildClaudeCode({
  pidfiles,
  check: (p) => p.startsWith(tmpdir()) ? { ok: true } : { ok: false, reason: "self-improve cwd must be a worktree" },
});
const selfRunner = buildRunner();

function buildImproverDeps(): ImproverDeps {
  return {
    reflect: (goal, failureLog) =>
      provider
        ? reflect({ provider, goal, knowledge: loadSelfKnowledge({ repoRoot: cfg.repoRoot }), failureLog })
        : Promise.resolve("CHANGE: (no LLM provider configured)"),
    addWorktree: (id) => addWorktree(cfg.repoRoot, id),
    removeWorktree: (wt) => removeWorktree(cfg.repoRoot, wt),
    implement: async (brief, cwd) => {
      // The edit worker runs in a throwaway worktree (a new directory each run),
      // and Claude sessions are directory-scoped — so this step does NOT use the
      // persistent session (resuming it from a different worktree fails). Ava's
      // persistent chat lives in the stable-cwd advisory/planning conversation.
      const r = await selfClaudeCode.run({ prompt: brief, cwd, runId: nanoid(12) });
      return r.ok ? { ok: true, output: r.output } : { ok: false, output: r.reason };
    },
    verify: (cwd) => verify({ cwd, run: selfRunner, bootSmoke }),
    headSha: () => headSha(cfg.repoRoot),
    commitWorktree: (cwd, msg) => {
      execFileSync("git", ["add", "-A"], { cwd });
      // A no-op implement (the worker reported success but changed nothing) leaves
      // an empty index — surface that plainly instead of a cryptic git failure.
      const staged = execFileSync("git", ["status", "--porcelain"], { cwd }).toString().trim();
      if (!staged) throw new Error("implement produced no changes — the worker reported success but edited nothing");
      try {
        execFileSync("git", ["commit", "-m", msg], { cwd, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
        throw new Error(`git commit failed: ${stderr || (e instanceof Error ? e.message : String(e))}`);
      }
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
    },
    swapTo: (sha) => swapTo(cfg.repoRoot, sha),
    revertTo: (sha) => revertTo(cfg.repoRoot, sha),
    // Dev: tsx watch auto-reloads when swapTo rewrites the working tree. (pm2/prod restart is a follow-up.)
    restart: async () => {},
    // Detached watchdog: survives the reload and reverts if the new build never gets healthy.
    watch: (knownGood) => {
      const healthUrl = `http://127.0.0.1:${cfg.port}/api/health`;
      const entry = join(cfg.repoRoot, "server/src/self/watchdog-main.ts");
      try {
        const child = spawn("npx", ["tsx", entry, cfg.repoRoot, knownGood, healthUrl, "45000"],
          { cwd: cfg.repoRoot, detached: true, stdio: "ignore", shell: true });
        child.unref();
      } catch (e) {
        log.warn({ err: e instanceof Error ? e.message : String(e) }, "self: watchdog spawn failed");
      }
      return Promise.resolve();
    },
    emit: (e) => { log.info({ self: e }, "self-improvement step"); },
  };
}

function startImprovement(id: string): void {
  // Wrap the fire-and-forget loop so a thrown watch/await never becomes an unhandled rejection.
  void runImprovement(db, id, buildImproverDeps()).catch((e) =>
    log.error({ err: e instanceof Error ? e.message : String(e), id }, "self-improvement crashed"));
}
function queueSelfImprove(goal: string): string {
  const id = createIntent(db, { trigger: "explicit", goal });
  startImprovement(id);
  return id;
}

const agentDeps = {
  pidfiles,
  fsRoots: cfg.fsRoots,
  memoryDir: cfg.memoryDir,
  getChrome,
  pushDeliver,
  notifyDone,
  provider,  // LLMProvider | null
  logsDir: cfg.logsDir,
  queueSelfImprove,
  // Lets Ava report the live state of each self-improvement task (queued →
  // reflecting → implementing → verifying → swapped/failed/rolled_back).
  listSelfImprovements: () =>
    listIntents(db).map((r) => ({
      id: r.id, goal: r.goal, status: r.status, trigger: r.trigger,
      error: r.error, outcome: r.outcome, created_at: r.created_at,
      commit: r.commit_sha,
      // The reflect brief (what the change set out to do), trimmed for speech.
      detail: r.diff_summary
        ? r.diff_summary.replace(/^BRIEF:\s*/, "").split(/\n\nWORKER:/)[0]!.trim().slice(0, 500)
        : null,
    })),
};

const anthropic = cfg.anthropicApiKey ? new Anthropic({ apiKey: cfg.anthropicApiKey }) : null;
const openai = cfg.openaiApiKey ? new (await import("openai")).default({ apiKey: cfg.openaiApiKey }) : null;

const app = express();
app.use(express.json({ limit: "1mb" }));

app.use("/api", healthRoutes(startedAt));
app.use("/api/auth", authRoutes(db, requireToken(db)));
app.use("/api/chat", chatRoutes(db, runs, requireToken(db), agentDeps, { anthropic, openai }));
app.use("/api/sessions", sessionsRoutes(db, requireToken(db)));
app.use("/api/push", pushRoutes(db, requireToken(db), { vapidPublicKey: cfg.vapidPublicKey }));
app.use("/api/rules", rulesRoutes(db, requireToken(db), { provider, log }));
app.use("/api/approvals", approvalsRoutes(db, requireToken(db)));
app.use("/api/chips", chipsRoutes(db, requireToken(db), { memoryDir: cfg.memoryDir, provider }));
app.use("/api/reasoning", reasoningRoutes(db, requireToken(db), {
  supported: provider?.name === "openai",
}));
app.use("/api/memory", memoryRoutes(requireToken(db), { memoryDir: cfg.memoryDir }));
app.use("/api/self", selfRoutes(db, requireToken(db), {
  startImprovement,
  revert: (id) => { const row = getIntent(db, id); if (row?.last_known_good) revertTo(cfg.repoRoot, row.last_known_good); },
}));

const voiceClients = buildVoiceClients({ apiKey: cfg.openaiApiKey });
// STT (/transcribe) + TTS (/speak) primitives only. Voice conversations route
// through POST /api/chat (the full tool-using agent) via the realtime WS proxy.
app.use("/api", voiceRoutes({
  clients: voiceClients,
  requireToken: requireToken(db),
}));

app.use("/", statusRoutes({ db, runs, startedAt }));

const webDistDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
app.use("/", express.static(webDistDir));

let shuttingDown = false;
async function shutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ reason }, "shutting down");
  if (chromePromise) {
    try {
      const chrome = await chromePromise;
      await chrome.close();
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, "chrome close failed");
    }
  }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

const httpServer = app.listen(cfg.port, cfg.bindAddr, () => {
  log.info({ port: cfg.port, bind: cfg.bindAddr }, "ava server listening");
});

// Hybrid voice action handoff: the realtime model's do_on_computer tool runs the
// REAL /api/chat agent (full tools), reusing the exact text path. We call it over
// loopback with a dedicated internal token and read the run's final reply off the
// SSE stream so the realtime model can speak it.
const hybridVoice = !!process.env.REALTIME_HYBRID;
const voiceInternalToken = hybridVoice ? issueToken(db, { label: "voice-internal" }).secret : "";
async function runVoiceAction(
  sessionId: string | null,
  task: string,
  onStep?: (tool: string, args: unknown) => void,
): Promise<{ text: string; sessionId: string | null }> {
  const base = `http://127.0.0.1:${cfg.port}`;
  const auth = { authorization: `Bearer ${voiceInternalToken}` };
  try {
    const postChat = () => fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ sessionId, text: task }),
    });
    let post = await postChat();
    // A previous action may still hold this session (a long-running or stuck
    // run). A new spoken command must win: abort the in-flight run and retry
    // once, rather than silently dropping the new task — this is the
    // "I ran the first job and can't run the second" bug.
    if (post.status === 409 && sessionId) {
      await fetch(`${base}/api/chat/${sessionId}/kill`, { method: "POST", headers: auth }).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      post = await postChat();
    }
    const started = (await post.json()) as { sessionId?: string };
    const sid = started.sessionId ?? sessionId;
    if (!sid) return { text: "I couldn't start that, Sir.", sessionId };
    const res = await fetch(`${base}/api/chat/${sid}/stream`, { headers: auth });
    const reader = res.body?.getReader();
    if (!reader) return { text: "Done.", sessionId: sid };
    const decoder = new TextDecoder();
    let buf = "", curEvent = "", finalText = "", stop = false;
    while (!stop) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event:")) curEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (curEvent === "final") { try { finalText = (JSON.parse(data) as { text: string }).text; } catch { /* */ } stop = true; }
          else if (curEvent === "tool_call") { try { const p = JSON.parse(data) as { tool: string; args?: unknown }; onStep?.(p.tool, p.args); } catch { /* */ } }
          else if (curEvent === "error") { try { finalText = `That didn't work, Sir — ${(JSON.parse(data) as { message: string }).message}`; } catch { /* */ } stop = true; }
          else if (curEvent === "killed") stop = true;
          // approval_required no longer stalls voice: the policy auto-approves
          // after the 15s veto window, so we keep reading and speak the result.
        }
      }
    }
    try { await reader.cancel(); } catch { /* */ }
    return { text: finalText || "Done.", sessionId: sid };
  } catch (e) {
    return { text: `That didn't work, Sir — ${e instanceof Error ? e.message : String(e)}`, sessionId };
  }
}

// Realtime voice WebSocket proxy: /api/voice/realtime. HYBRID (model speaks +
// do_on_computer routes to the full agent) is OPT-IN via REALTIME_HYBRID — the
// matching client audio path must be live too, so until then the default stays
// the working transcribe-only path. (hybridVoice declared above with the token.)
const realtimeProxy = buildRealtimeProxy({
  db,
  apiKey: cfg.openaiApiKey,
  memoryDir: cfg.memoryDir,
  ...(hybridVoice ? { runAction: runVoiceAction, voice: process.env.REALTIME_VOICE || "alloy" } : {}),
  log,
});
realtimeProxy.attach(httpServer);
if (hybridVoice) log.info("realtime voice: HYBRID mode enabled (REALTIME_HYBRID)");

try {
  startSystray({
    onPair: () => issuePairingCode(db, cfg.pairingTtlMs),
    log,
  });
} catch (e) {
  log.warn(
    { err: e instanceof Error ? e.message : String(e) },
    "systray failed to start — server still running. Mint a pairing code with: npm -w server run pair",
  );
}
