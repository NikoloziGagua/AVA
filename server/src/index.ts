import "./net-tuning.js"; // MUST be first: happy-eyeballs for IPv6-only/NAT64 networks
import express from "express";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { nanoid } from "nanoid";
import { loadConfig } from "./config.js";
import { buildLogger } from "./logs/logger.js";
import { openDb } from "./state/db.js";
import { purgeDeletedSessions } from "./state/sessions.js";
import { buildRealtimeProxy } from "./routes/voice-realtime.js";
import { resolveVoiceProvider } from "./routes/voice-provider-config.js";
import { issuePairingCode } from "./auth/pairing.js";
import { requireToken } from "./auth/middleware.js";
import { rotateInternalTokens } from "./auth/internal-tokens.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { healthRoutes } from "./routes/health.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { statusRoutes } from "./routes/status.js";
import { pushRoutes } from "./routes/push.js";
import { rulesRoutes } from "./routes/rules.js";
import { approvalsRoutes } from "./routes/approvals.js";
import { voiceRoutes } from "./routes/voice.js";
import { voiceEngineRoutes } from "./routes/voice-engine.js";
import { chipsRoutes } from "./routes/chips.js";
import { reasoningRoutes } from "./routes/reasoning.js";
import { memoryRoutes } from "./routes/memory.js";
import { notesRoutes } from "./routes/notes.js";
import { visualExplanationRoutes } from "./routes/visual-explanations.js";
import {
  buildCapabilitySnapshot,
  capabilityRoutes,
  type BrowserReadiness,
  type CapabilityRouteDeps,
} from "./routes/capabilities.js";
import { explorerRoutes } from "./routes/explorer.js";
import { missionControlRoutes } from "./routes/mission-control.js";
import { strategyRoutes } from "./routes/strategy.js";
import { apiNotFound } from "./routes/api-fallback.js";
import { markStaleExplorerTasksInterrupted } from "./explorer/store.js";
import { ObservabilityService } from "./observability/store.js";
import type { ObservabilityParentContext } from "./observability/types.js";
import { playbooksRoutes } from "./routes/playbooks.js";
import { watchesRoutes } from "./routes/watches.js";
import { peopleRoutes } from "./routes/people.js";
import { startWatchScheduler } from "./watches/scheduler.js";
import { buildCodexDispatcher } from "./watches/codex-dispatch.js";
import { ActiveRuns } from "./orchestrator/active-runs.js";
import { startSystray } from "./systray/index.js";
import { PidfileRegistry } from "./process/pidfile.js";
import { acquireServerLock } from "./process/server-lock.js";
import { killTree } from "./process/kill-tree.js";
import { runRecovery } from "./state/recovery.js";
import { buildChrome } from "./tools/chrome.js";
import { buildVoiceClients } from "./tools/voice-clients.js";
import { DEFAULT_VOICE } from "./routes/voice-defaults.js";
import { buildDeliverer } from "./push/deliver.js";
import { buildProvider } from "./orchestrator/llm/factory.js";
import { bootstrapMemoryDir } from "./memory/bootstrap.js";
import { buildClaudeCode } from "./tools/claude-code.js";
import { reflect } from "./self/reflect.js";
import { loadSelfKnowledge } from "./self/identity.js";
import { addWorktree, removeWorktree, pruneOrphanWorktrees } from "./self/worktree.js";
import { headSha, swapTo, revertTo } from "./self/swap.js";
import { assertSwapSafe } from "./self/safety-guard.js";
import { verify } from "./self/verify.js";
import { flightcheck } from "./self/flightcheck.js";
import { buildRunner } from "./self/verify-runner.js";
import { bootSmoke } from "./self/boot-smoke.js";
import { runImprovement, cancelImprovement, approveImprovement, rejectImprovement, improvementsPaused, type ImproverDeps } from "./self/improver.js";
import { appendChangelog } from "./self/changelog.js";
import { recordMistake } from "./self/friction.js";
import { createIntent, getIntent, listIntents, failStaleIntents } from "./self/intents.js";
import { createDiscussion, getDiscussion, listDiscussions, failStaleDiscussions } from "./state/discussions.js";
import { runDiscussion } from "./self/discuss.js";
import { appendMessage } from "./state/messages.js";
import { selfRoutes } from "./routes/self.js";
import { StrategyRoomStore } from "./strategy/store.js";
import { StrategyRoomCoordinator } from "./strategy/coordinator.js";
import { buildCodexConsultant } from "./strategy/codex-consultant.js";

function loadRuntimeBuildId(): string {
  try {
    // Read once at process boot. Rebuilding files underneath a live process
    // must not let that stale process impersonate the newly installed build.
    return readFileSync(fileURLToPath(new URL("./build-id.txt", import.meta.url)), "utf8").trim() || "unknown";
  } catch {
    // `tsx src/index.ts` intentionally has no generated production build ID.
    return "dev";
  }
}

const startedAt = Date.now();
const runtimeBuildId = loadRuntimeBuildId();
const cfg = loadConfig();
// Claim the singleton before opening shared runtime state. On Windows a second
// listener can briefly reach its callback before EADDRINUSE; the file lock is
// the authoritative boundary that keeps a losing boot away from live tokens.
const serverLock = acquireServerLock(join(cfg.dataDir, "ava-server.lock"));
const log = await buildLogger({ level: cfg.logLevel, dir: cfg.logsDir });
const db = openDb(cfg.dbPath);
let voiceInternalToken = "";
let watchInternalToken = "";
const codexDispatcher = buildCodexDispatcher({ repoRoot: cfg.repoRoot, logsDir: cfg.logsDir });
const observability = new ObservabilityService(db);
const strategyStore = new StrategyRoomStore(db);
const interruptedStrategyRooms = strategyStore.failInterruptedRooms();
if (interruptedStrategyRooms > 0) {
  log.info({ interruptedStrategyRooms }, "strategy: paused rooms orphaned by restart");
}
const orphanedMissionRuns = observability.store.markOrphanedRuns();
const purgedMissionDetails = observability.store.purgeExpiredDetails();
if (
  orphanedMissionRuns > 0 ||
  purgedMissionDetails.compactedRuns > 0 ||
  purgedMissionDetails.deletedRuns > 0
) {
  log.info(
    { orphanedMissionRuns, purgedMissionDetails },
    "mission-control: reconciled persisted observability state",
  );
}
const missionRetentionTimer = setInterval(() => {
  try {
    const result = observability.store.purgeExpiredDetails();
    if (result.compactedRuns > 0 || result.deletedRuns > 0) {
      log.info({ result }, "mission-control: applied retention policy");
    }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "mission-control: retention pass failed",
    );
  }
}, 6 * 60 * 60 * 1_000);
missionRetentionTimer.unref?.();
const interruptedExplorerTasks = markStaleExplorerTasksInterrupted(db);
if (interruptedExplorerTasks > 0) {
  log.info(
    { interruptedExplorerTasks },
    "explorer: closed tasks orphaned by restart",
  );
}
// Reconcile self-improvement intents orphaned by a previous restart: nothing is
// in flight at boot, so any non-terminal intent is dead — mark it failed so it
// doesn't report as forever-"implementing".
{
  const reconciled = failStaleIntents(db);
  if (reconciled > 0) log.info({ reconciled }, "self: failed stale intents orphaned by restart");
}
// Prune git worktrees/branches leaked by a crash mid-improvement (failStaleIntents
// only reconciles DB rows; the temp worktree dir + self/<id> branch are left
// behind, showing as "prunable"). Best-effort — never crash boot on it.
try {
  const prunedBranches = pruneOrphanWorktrees(cfg.repoRoot);
  if (prunedBranches.length > 0) log.info({ prunedBranches }, "self: pruned orphaned self-improve worktrees/branches");
} catch (e) {
  log.warn({ err: e instanceof Error ? e.message : String(e) }, "self: worktree prune failed (non-fatal)");
}
// Same for background Claude consults: none is in flight at boot, so any left
// 'running' was orphaned by a restart — mark them failed.
{
  const reconciled = failStaleDiscussions(db);
  if (reconciled > 0) log.info({ reconciled }, "discuss: failed stale discussions orphaned by restart");
}
const purgedCount = purgeDeletedSessions(db, Date.now() - 24 * 60 * 60 * 1000);
if (purgedCount > 0) log.info({ purgedCount }, "purged soft-deleted sessions older than 24h");
const runs = new ActiveRuns();
const pidfiles = new PidfileRegistry(cfg.pidfileDir);

await runRecovery({ db, pidfiles, kill: (pid) => killTree(pid) });
bootstrapMemoryDir({ dir: cfg.memoryDir });

let chromePromise: ReturnType<typeof buildChrome> | null = null;
let chromeLauncherPromise: Promise<void> | null = null;
let lastChromeEndpointSuccessAt = 0;
const CHROME_READINESS_GRACE_MS = 15_000;
const chromeLauncherPath = fileURLToPath(
  new URL("../../scripts/start-ava-browser.ps1", import.meta.url),
);

/**
 * Run the same visible-browser launcher the owner could double-click. It is
 * idempotent: when AVA Chrome is already listening, it verifies and foregrounds
 * the window; otherwise it creates the dedicated profile window.
 */
async function runChromeLauncher(): Promise<void> {
  if (process.platform !== "win32") return;
  if (chromeLauncherPromise) return chromeLauncherPromise;
  chromeLauncherPromise = new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        chromeLauncherPath,
      ],
      { timeout: 30_000, windowsHide: true },
      (error) => error ? reject(error) : resolve(),
    );
  }).finally(() => {
    chromeLauncherPromise = null;
  });
  return chromeLauncherPromise;
}

async function chromeEndpointAlive(
  cdpUrl: string,
  timeoutMs = 1_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = new URL("/json/version", cdpUrl).toString();
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) return false;
    const body = await response.json() as { webSocketDebuggerUrl?: unknown };
    const alive =
      typeof body.webSocketDebuggerUrl === "string" &&
      body.webSocketDebuggerUrl.length > 0;
    if (alive) lastChromeEndpointSuccessAt = Date.now();
    return alive;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function chromeEndpointReachable(
  cdpUrl: string,
  timeoutMs = 400,
): Promise<boolean> {
  let endpoint: URL;
  try {
    endpoint = new URL(cdpUrl);
  } catch {
    return false;
  }
  const port = Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
  const host = endpoint.hostname.replace(/^\[(.*)\]$/, "$1");

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = createConnection({ host, port });
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function getChrome() {
  if (chromePromise) {
    try {
      const existing = await chromePromise;
      const endpointReady =
        !cfg.chromeCdpUrl || await chromeEndpointAlive(cfg.chromeCdpUrl, 1_500);
      if (existing.isAlive() && endpointReady) return existing;
    } catch {
      // build previously rejected — fall through and rebuild
    }
    log.info("chrome window was closed/disconnected — rebuilding");
    chromePromise = null;
  }
  // A fresh Chrome request runs AVA's launcher herself, creating the dedicated
  // logged-in CDP window before Playwright attaches.
  if (cfg.chromeCdpUrl) {
    try {
      await runChromeLauncher();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(
        { err: message },
        "AVA Chrome launcher failed",
      );
      throw new Error(`AVA Chrome launcher failed: ${message}`);
    }
  }
  chromePromise = buildChrome({
    profileDir: cfg.chromeProfileDir,
    screenshotDir: cfg.screenshotDir,
    executablePath: cfg.chromeExecutablePath,
    cdpUrl: cfg.chromeCdpUrl,
  });
  return chromePromise;
}

/**
 * Read-only browser health for the Capability Center. Never launches Chrome:
 * it checks an already-built context, then the configured local CDP helper.
 */
async function browserReadiness(): Promise<BrowserReadiness> {
  // The PWA's initial WebGL render can briefly delay Chrome's DevTools HTTP
  // endpoint. Preserve a very recent successful probe so opening Explorer
  // cannot turn a known-live browser into a false red status while it renders.
  if (
    lastChromeEndpointSuccessAt > 0 &&
    Date.now() - lastChromeEndpointSuccessAt <= CHROME_READINESS_GRACE_MS
  ) {
    return { ready: true, mode: "attached" };
  }
  if (chromePromise) {
    try {
      const existing = await Promise.race([
        chromePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
      ]);
      const endpointReady =
        !cfg.chromeCdpUrl || await chromeEndpointAlive(cfg.chromeCdpUrl);
      if (existing?.isAlive() && endpointReady) {
        return { ready: true, mode: "attached" };
      }
    } catch {
      // A rejected prior launch is the state the Capability Center should show.
    }
  }
  const cdp = cfg.chromeCdpUrl?.replace(/\/+$/, "");
  if (cdp) {
    // Chrome's DevTools HTTP endpoint can briefly take over a second to answer
    // while the AVA interface and its WebGL shell are loading. A 900 ms probe
    // produced false "Chrome unavailable" cards even though the endpoint was
    // healthy. This remains bounded, but allows a busy local browser to answer.
    if (await chromeEndpointAlive(cdp, 1_200)) {
      return { ready: true, mode: "attached" };
    }
    // A busy renderer can delay /json/version even while Chrome's dedicated
    // CDP listener is accepting connections. Preserve that weaker distinction
    // instead of displaying the browser and every account workflow as offline.
    if (await chromeEndpointReachable(cdp)) {
      return { ready: true, mode: "reachable" };
    }
  }
  return { ready: false, mode: "offline" };
}

// The desktop runtime starts AVA Chrome before Node. Warm the short-lived
// readiness evidence before accepting UI traffic, when the browser is idle.
if (cfg.chromeCdpUrl) {
  await chromeEndpointAlive(cfg.chromeCdpUrl, 2_500);
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
const strategyCoordinator = new StrategyRoomCoordinator({
  store: strategyStore,
  provider,
  codex: buildCodexConsultant({ pidfiles }),
  repoRoot: cfg.repoRoot,
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
    // User-triggered self-improvements pause for plan approval; the unattended
    // overnight loop (trigger "schedule") runs without a human in the loop.
    requireApproval: (intent) => intent.trigger === "explicit",
    onAwaitingApproval: (_id, plan) => {
      const first = plan.split("\n").find((l) => l.trim().length > 0)?.slice(0, 140) ?? "a change";
      notifyDone?.(`A self-improvement plan is ready for your review: ${first}`);
    },
    reflect: (goal, failureLog, signal) =>
      provider
        ? reflect({ provider, goal, knowledge: loadSelfKnowledge({ repoRoot: cfg.repoRoot }), failureLog, abort: signal })
        : Promise.resolve("CHANGE: (no LLM provider configured)"),
    addWorktree: (id) => addWorktree(cfg.repoRoot, id),
    removeWorktree: (wt) => removeWorktree(cfg.repoRoot, wt),
    implement: async (brief, cwd, signal) => {
      // The edit worker runs in a throwaway worktree (a new directory each run),
      // and Claude sessions are directory-scoped — so this step does NOT use the
      // persistent session (resuming it from a different worktree fails). Ava's
      // persistent chat lives in the stable-cwd advisory/planning conversation.
      // `signal` lets a Stop/Cancel kill the claude worker mid-edit.
      const r = await selfClaudeCode.run({ prompt: brief, cwd, runId: nanoid(12), signal });
      return r.ok ? { ok: true, output: r.output } : { ok: false, output: r.reason };
    },
    verify: async (cwd, signal) => {
      const v = await verify({ cwd, run: selfRunner, bootSmoke, signal });
      let fcLine = "";
      try {
        const fc = await flightcheck({ cwd });
        log.info({ flightcheck: fc.ok ? "passed report-only" : "failed report-only" }, "flightcheck");
        fcLine = `\n\n[flightcheck ${fc.ok ? "PASSED" : "FAILED"} report-only]\n${fc.report}`;
      } catch (e) {
        fcLine = `\n\n[flightcheck ERROR report-only] ${e instanceof Error ? e.message : String(e)}`;
      }
      return { ok: v.ok, log: v.log + fcLine };   // v.ok UNCHANGED — flightcheck NEVER gates the swap
    },
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
    swapTo: (sha, lastKnownGood) => {
      // HARD GUARD: never hot-swap a change that touches safety-critical code
      // (security/policy/auth, self-improve machinery, approval flow, path
      // allowlist, scrub). Throws → runImprovement marks the intent failed.
      assertSwapSafe(cfg.repoRoot, lastKnownGood, sha);
      swapTo(cfg.repoRoot, sha);
    },
    revertTo: (sha) => revertTo(cfg.repoRoot, sha),
    // Dev: tsx watch auto-reloads when swapTo rewrites the working tree. (pm2/prod restart is a follow-up.)
    restart: async () => {},
    // Detached watchdog: survives the reload and reverts if the new build never gets healthy.
    // `swapped` is passed through so the rollback is skipped if newer work landed on top.
    watch: (knownGood, swapped) => {
      const healthUrl = `http://127.0.0.1:${cfg.port}/api/health`;
      const entry = join(cfg.repoRoot, "server/src/self/watchdog-main.ts");
      try {
        const child = spawn("npx", ["tsx", entry, cfg.repoRoot, knownGood, healthUrl, "45000", swapped],
          { cwd: cfg.repoRoot, detached: true, stdio: "ignore", shell: true });
        child.unref();
      } catch (e) {
        log.warn({ err: e instanceof Error ? e.message : String(e) }, "self: watchdog spawn failed");
      }
      return Promise.resolve();
    },
    emit: (e) => { log.info({ self: e }, "self-improvement step"); },
    // Every shipped change appends one changelog line — Ava stays aware of how
    // she has evolved without re-reading her own code, and Claude gets recent
    // history so it doesn't undo past fixes.
    onSwapped: (intent, sha) => {
      appendChangelog(cfg.memoryDir, { summary: intent.goal, commit: sha });
    },
    // Real failures land in the friction ledger — the overnight loop mines it
    // for grounded goals before inventing new ideas.
    onFailed: (intent, error) => {
      recordMistake(cfg.memoryDir, {
        surface: "tool",
        summary: `self-improvement failed: ${intent.goal.slice(0, 120)}`,
        detail: error.slice(0, 1000),
      });
    },
  };
}

function startImprovement(id: string): void {
  // Wrap the fire-and-forget loop so a thrown watch/await never becomes an unhandled rejection.
  void runImprovement(db, id, buildImproverDeps()).catch((e) =>
    log.error({ err: e instanceof Error ? e.message : String(e), id }, "self-improvement crashed"));
}
function queueSelfImprove(goal: string): string {
  if (improvementsPaused()) {
    throw new Error("self-improvement is paused — Sir can resume it from the Self screen");
  }
  const id = createIntent(db, { trigger: "explicit", goal });
  startImprovement(id);
  return id;
}

// ─── Discuss-with-Claude wiring ──────────────────────────────────────────
// A READ-ONLY claude instance for consults. The default (defaultClaudeArgs)
// adds `--permission-mode acceptEdits`, which would let Claude edit files; here
// we pass only `-p` so the consult can READ the repo but never modify it (Sir
// said "discuss, don't change anything"). It runs in the real repo, so the
// allowlist permits cfg.repoRoot.
const consultClaude = buildClaudeCode({
  pidfiles,
  check: (p) => p.startsWith(cfg.repoRoot) ? { ok: true } : { ok: false, reason: "consult must run in the repo" },
  claudeArgs: (prompt) => ["-p", prompt],   // NO acceptEdits → read-only
});

async function consult(topic: string, id: string): Promise<{ ok: boolean; text: string }> {
  const prompt = `Sir asked Ava to discuss this with you (Claude): "${topic}". Read the repo as needed and give your honest, concrete input — concise: a short list of specific ideas/tradeoffs and a recommendation. DO NOT modify any files; this is analysis only.`;
  const r = await consultClaude.run({ prompt, cwd: cfg.repoRoot, runId: `discuss-${id}`, timeoutMs: 5 * 60 * 1000 });
  return { ok: r.ok, text: r.ok ? r.output : (r.reason || "consult failed") };
}

// When a consult finishes, relay it back HONESTLY (Claude's input credited to
// Claude): append Ava's relay into the session it was started from, and push Sir.
function deliverDiscussion(o: { sessionId: string | null; topic: string; ok: boolean; result: string }): void {
  const msg = o.ok
    ? `I checked with Claude about "${o.topic}", Sir. Here's what he came back with:\n\n${o.result}`
    : `I tried to confer with Claude about "${o.topic}", Sir, but it didn't complete — ${o.result}`;
  if (o.sessionId) appendMessage(db, { sessionId: o.sessionId, role: "assistant", content: msg });
  notifyDone?.(`Claude and I finished discussing: ${o.topic}`);
}

function queueDiscussion(topic: string, sessionId: string | null): string {
  const id = createDiscussion(db, { topic, sessionId });
  // Fire-and-forget: the consult runs in the background so Ava keeps talking.
  void runDiscussion(db, id, { consult: (t) => consult(t, id), deliver: deliverDiscussion })
    .catch((e) => log.error({ err: e instanceof Error ? e.message : String(e), id }, "discussion crashed"));
  return id;
}

const agentDeps = {
  pidfiles,
  fsRoots: cfg.fsRoots,
  memoryDir: cfg.memoryDir,
  dataDir: cfg.dataDir,
  getChrome,
  pushDeliver,
  notifyDone,
  provider,  // LLMProvider | null
  observability,
  logsDir: cfg.logsDir,
  // Reliable API integrations — wired only when BOTH/the needed creds are set in .env.
  shopify: cfg.shopifyStore && cfg.shopifyAdminToken
    ? { store: cfg.shopifyStore, token: cfg.shopifyAdminToken } : null,
  googlePlacesApiKey: cfg.googlePlacesApiKey,
  resolveCodexWatchTarget: codexDispatcher.resolveTarget,
  queueSelfImprove,
  // Discuss-with-Claude: queue a background consult, and read past ones back.
  queueDiscussion,
  listDiscussions: () => listDiscussions(db),
  getDiscussion: (id: string) => getDiscussion(db, id),
  openStrategyRoomFromSession: (sessionId: string) => strategyCoordinator.createFromSession(sessionId),
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

const capabilityRouteDeps: CapabilityRouteDeps = {
  db,
  startedAt,
  provider: provider?.name ?? null,
  memoryDir: cfg.memoryDir,
  browserReadiness,
  brainModel: provider?.defaultOrchestratorModel ?? "not configured",
  voiceModel: process.env.REALTIME_MODEL || "gpt-realtime-2.1",
  voiceName: process.env.REALTIME_VOICE || DEFAULT_VOICE,
  voiceReady: !!(cfg.openaiApiKey || process.env.HUME_API_KEY),
  shopifyReady: !!(cfg.shopifyStore && cfg.shopifyAdminToken),
  googlePlacesReady: !!cfg.googlePlacesApiKey,
  screenVisionReady: !!cfg.openaiApiKey,
  pushReady: !!(cfg.vapidPublicKey && cfg.vapidPrivateKey),
};

app.use("/api", healthRoutes(startedAt, {
  provider: provider?.name ?? null,
  buildId: runtimeBuildId,
}));
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
app.use("/api/notes", notesRoutes(db, requireToken(db), { queueSelfImprove }));
app.use("/api/visual-explanations", visualExplanationRoutes(db, requireToken(db)));
app.use("/api/capabilities", capabilityRoutes(requireToken(db), capabilityRouteDeps));
app.use("/api/explorer", explorerRoutes(requireToken(db), {
  db,
  runs,
  startedAt,
  memoryDir: cfg.memoryDir,
  capabilitySnapshot: () => buildCapabilitySnapshot(capabilityRouteDeps),
}));
app.use("/api/mission-control", missionControlRoutes(requireToken(db), observability));
app.use("/api/strategy", strategyRoutes(requireToken(db), strategyCoordinator));
app.use("/api/playbooks", playbooksRoutes(requireToken(db), { memoryDir: cfg.memoryDir }));
app.use("/api/watches", watchesRoutes(db, requireToken(db)));
app.use("/api/people", peopleRoutes(requireToken(db), { memoryDir: cfg.memoryDir }));
app.use("/api/self", selfRoutes(db, requireToken(db), {
  startImprovement,
  revert: (id) => { const row = getIntent(db, id); if (row?.last_known_good) revertTo(cfg.repoRoot, row.last_known_good); },
  cancel: (id) => cancelImprovement(db, id),
  approve: (id) => approveImprovement(id),
  reject: (id) => rejectImprovement(id),
}));

const voiceClients = buildVoiceClients({ apiKey: cfg.openaiApiKey });
// STT (/transcribe) + TTS (/speak) primitives only. Voice conversations route
// through POST /api/chat (the full tool-using agent) via the realtime WS proxy.
app.use("/api", voiceRoutes({
  clients: voiceClients,
  requireToken: requireToken(db),
  db,
  log,
}));
// Get/set how Ava's voice is produced (openai | hume).
app.use("/api/voice/engine", voiceEngineRoutes(db, requireToken(db)));
// API misses must stay JSON. Without this, a stale/mismatched frontend receives
// Express's HTML 404 and can only report an opaque JSON parse error.
app.use("/api", apiNotFound());

app.use("/", statusRoutes({
  db,
  runs,
  startedAt,
  provider: provider?.name ?? null,
  memoryDir: cfg.memoryDir,
  bindAddr: cfg.bindAddr,
  port: cfg.port,
}));

const webDistDir = fileURLToPath(new URL("../../web/dist/", import.meta.url));
app.use("/", express.static(webDistDir));

let shuttingDown = false;
async function shutdown(reason: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ reason }, "shutting down");
  strategyCoordinator.shutdown();
  // Stop accepting new connections first so the port frees promptly for the
  // next process (tsx watch / self-dev restart) instead of racing EADDRINUSE.
  try { httpServer.close(); } catch { /* may not be listening yet */ }
  if (chromePromise) {
    try {
      const chrome = await chromePromise;
      await chrome.close();
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, "chrome close failed");
    }
  }
  // Pino buffers asynchronously — flush so the shutdown reason actually lands
  // in the log file instead of dying with the process.
  try { (log as unknown as { flush?: () => void }).flush?.(); } catch { /* best-effort */ }
  serverLock.release();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Crash guards: a stray rejection (e.g. a fire-and-forget write failing) used to
// take down the whole server mid-task — Node's default is process death. For a
// personal agent, log-and-continue beats losing every in-flight run; state after
// an uncaughtException may be degraded, so it's logged loudly for diagnosis.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  log.error({ err }, "unhandledRejection — continuing");
});
process.on("uncaughtException", (err) => {
  log.error({ err: err.stack ?? err.message }, "uncaughtException — continuing (state may be degraded)");
});

const httpServer = app.listen(cfg.port, cfg.bindAddr, () => {
  // Rotate only after this process successfully owns the port. A losing hot-
  // reload process must not revoke the live server's loopback credentials.
  const internalTokens = rotateInternalTokens(db);
  voiceInternalToken = internalTokens.voice;
  watchInternalToken = internalTokens.watch;
  if (internalTokens.retiredVoice > 0) {
    log.info({ retired: internalTokens.retiredVoice }, "auth: revoked stale voice-internal tokens at boot");
  }
  if (internalTokens.retiredWatch > 0) {
    log.info({ retired: internalTokens.retiredWatch }, "auth: revoked stale watch-internal tokens at boot");
  }
  log.info({ port: cfg.port, bind: cfg.bindAddr }, "ava server listening");
  // Long-term monitoring: re-checks standing watches through this server's own
  // /api/chat (full toolset + audit trail in each watch's session). Started
  // only once the port is live, since checks call back over HTTP.
  if (provider) {
    startWatchScheduler({
      db,
      baseUrl: `http://127.0.0.1:${cfg.port}`,
      token: () => watchInternalToken,
      notify: (text) => notifyDone?.(text),
      log,
      dispatchCodex: codexDispatcher.dispatch,
      inspectCodex: codexDispatcher.inspect,
    });
  } else {
    log.warn({}, "watch scheduler disabled — no LLM provider");
  }
});
// Without this handler a bind failure (EADDRINUSE from a half-dead prior
// process — the documented self-dev restart collision) crash-looped with a raw
// stack. Exit once with a readable reason; the supervisor (tsx watch) retries.
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    log.error({ port: cfg.port }, "port already in use — is another Ava server still running? exiting");
  } else {
    log.error({ err: err.stack ?? err.message }, "http server error — exiting");
  }
  try { (log as unknown as { flush?: () => void }).flush?.(); } catch { /* best-effort */ }
  serverLock.release();
  process.exit(1);
});

// Hybrid voice action handoff: the realtime model's do_on_computer tool runs the
// REAL /api/chat agent (full tools), reusing the exact text path. We call it over
// loopback with a dedicated internal token and read the run's final reply off the
// SSE stream so the realtime model can speak it.
//
// REALTIME_HYBRID is a legacy no-op kept only for old .env files; it no longer
// gates anything. The action handoff is wired UNCONDITIONALLY — harmless when
// the model never calls do_on_computer — and the persisted engine value
// (openai | hume, read at connect via getVoiceEngine) picks the realtime
// upstream. The chatterbox/hybrid engine values were retired in 777ecc0; the
// realtime model always speaks for the OpenAI engine. The internal token must
// therefore always exist.
const hybridVoice = !!process.env.REALTIME_HYBRID;
async function runVoiceAction(
  sessionId: string | null,
  task: string,
  onStep?: (tool: string, args: unknown) => void,
  signal?: AbortSignal,
  observabilityContext?: ObservabilityParentContext,
): Promise<{ text: string; sessionId: string | null }> {
  if (!voiceInternalToken) throw new Error("voice loopback authentication is not ready");
  const base = `http://127.0.0.1:${cfg.port}`;
  const auth = { authorization: `Bearer ${voiceInternalToken}` };
  const cancelled = () => {
    const error = new Error("voice action cancelled");
    error.name = "AbortError";
    return error;
  };
  const responseFailure = async (response: Response, stage: string) => {
    let detail = "";
    try {
      const body = await response.json() as { error?: string; message?: string };
      detail = body.error || body.message || "";
    } catch { /* status is still enough */ }
    return new Error(`${stage} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
  };
  // If the voice connection already dropped before we started, don't run at all.
  if (signal?.aborted) throw cancelled();
  try {
    const postChat = () => fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      // persist:false — the realtime proxy already stores the spoken user turn and
      // the spoken result, so this internal run executes tools but persists nothing
      // (single source of truth for voice turns; no double-store). Independent of
      // `voice` (do NOT overload it): this flag only gates message storage.
      body: JSON.stringify({
        sessionId,
        text: task,
        persist: false,
        observability: observabilityContext,
      }),
      signal,
    });
    let post = await postChat();
    // A previous action may still hold this session (a long-running or stuck
    // run). A new spoken command must win: abort the in-flight run and retry
    // once, rather than silently dropping the new task — this is the
    // "I ran the first job and can't run the second" bug.
    if (post.status === 409 && sessionId) {
      await fetch(`${base}/api/chat/${sessionId}/kill`, { method: "POST", headers: auth }).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      if (signal?.aborted) throw cancelled();
      post = await postChat();
    }
    if (!post.ok) throw await responseFailure(post, "action start");
    const started = (await post.json()) as { sessionId?: string };
    const sid = started.sessionId ?? sessionId;
    if (!sid) throw new Error("action start returned no session");
    // If the voice connection drops mid-run, kill the loopback run so it stops
    // executing tools (and frees the shared browser) instead of finishing into a
    // dead socket — the zombie-run fix.
    const killOnAbort = () => { void fetch(`${base}/api/chat/${sid}/kill`, { method: "POST", headers: auth }).catch(() => {}); };
    signal?.addEventListener("abort", killOnAbort, { once: true });
    const res = await fetch(`${base}/api/chat/${sid}/stream`, { headers: auth, signal });
    if (!res.ok) throw await responseFailure(res, "action stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("action stream returned no readable body");
    const decoder = new TextDecoder();
    let buf = "", curEvent = "", finalText = "", stop = false;
    let terminal: "completed" | "failed" | "cancelled" | null = null;
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
          if (curEvent === "final") {
            try { finalText = (JSON.parse(data) as { text: string }).text; } catch { /* */ }
            terminal = "completed";
            stop = true;
          }
          else if (curEvent === "tool_call") { try { const p = JSON.parse(data) as { tool: string; args?: unknown }; onStep?.(p.tool, p.args); } catch { /* */ } }
          else if (curEvent === "error") {
            try { finalText = `That didn't work, Sir — ${(JSON.parse(data) as { message: string }).message}`; } catch { /* */ }
            terminal = "failed";
            stop = true;
          }
          else if (curEvent === "killed") {
            terminal = "cancelled";
            stop = true;
          }
          // approval_required no longer stalls voice: the policy auto-approves
          // after the 15s veto window, so we keep reading and speak the result.
        }
      }
    }
    try { await reader.cancel(); } catch { /* */ }
    signal?.removeEventListener("abort", killOnAbort); // ran to completion — don't kill on a later close
    if (signal?.aborted || terminal === "cancelled") throw cancelled();
    if (terminal === "failed") {
      return {
        text: finalText || "That didn't work, Sir — the action stream failed without an error message.",
        sessionId: sid,
      };
    }
    if (terminal !== "completed" || !finalText.trim()) {
      throw new Error("action ended without a final, verifiable result");
    }
    return { text: finalText, sessionId: sid };
  } catch (e) {
    if (signal?.aborted || (e instanceof Error && e.name === "AbortError")) {
      throw cancelled();
    }
    return { text: `That didn't work, Sir — ${e instanceof Error ? e.message : String(e)}`, sessionId };
  }
}

// Realtime voice WebSocket proxy: /api/voice/realtime. The action handoff
// (runAction → the full /api/chat agent via do_on_computer) is provided
// UNCONDITIONALLY: it's inert unless the realtime model actually calls the tool.
// The persisted engine value (getVoiceEngine, read at connect: openai | hume)
// picks the upstream; the realtime model always speaks (hybrid is the only mode
// since 777ecc0 — the transcribe-only client path is unreachable).
// AVA_VOICE_PROVIDER selects the realtime upstream (openai default | hume). Hume
// is used only when fully configured; otherwise the proxy falls back to OpenAI.
const realtimeProxy = buildRealtimeProxy({
  db,
  apiKey: cfg.openaiApiKey,
  memoryDir: cfg.memoryDir,
  runAction: runVoiceAction,
  observability,
  voice: process.env.REALTIME_VOICE || undefined,
  providerConfig: resolveVoiceProvider(),
  log,
});
realtimeProxy.attach(httpServer);
if (hybridVoice) log.info("realtime voice: REALTIME_HYBRID set (legacy default-seed; engine value now drives speak/transcribe)");

try {
  startSystray({
    onPair: () => issuePairingCode(db, cfg.pairingTtlMs),
    log,
  });
} catch (e) {
  log.warn(
    { err: e instanceof Error ? e.message : String(e) },
    "systray failed to start — server still running. Mint a pairing code with: npm.cmd -w server run pair",
  );
}
