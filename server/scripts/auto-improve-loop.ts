import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/state/db.js";
import { createIntent, getIntent } from "../src/self/intents.js";
import { runImprovement, type ImproverDeps } from "../src/self/improver.js";
import { reflect } from "../src/self/reflect.js";
import { loadSelfKnowledge } from "../src/self/identity.js";
import { addWorktree, removeWorktree } from "../src/self/worktree.js";
import { headSha, swapTo, revertTo } from "../src/self/swap.js";
import { SAFETY_RE, assertSwapSafe } from "../src/self/safety-guard.js";
import { verify } from "../src/self/verify.js";
import { buildRunner } from "../src/self/verify-runner.js";
import { bootSmoke } from "../src/self/boot-smoke.js";
import { buildClaudeCode } from "../src/tools/claude-code.js";
import { buildProvider } from "../src/orchestrator/llm/factory.js";
import { getClaudeSession, markClaudeSessionStarted } from "../src/self/claude-session.js";
import { suggestImprovement } from "../src/self/suggest.js";

// Ava's overnight autonomous self-improvement loop. Ava suggests its own ideas
// via its persistent Claude chat, then runs the gated pipeline (reflect ->
// implement-in-worktree -> verify -> swap -> watchdog). It stops when Claude
// credits run out, after too many consecutive failures, or at a hard cap.
// HARD SAFETY GUARD: a swap that touches safety/verification/approval/sandbox
// code is refused — Ava cannot weaken its own guardrails this way.

const LOG = join(tmpdir(), "ava-overnight.log");
function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try { appendFileSync(LOG, line + "\n"); } catch { /* */ }
}

// SAFETY_RE is imported from the shared safety-guard module (single source of
// truth shared with the live interactive path in src/index.ts).

const MAX_ITERS = Number(process.env.MAX_ITERS ?? 60);
const MAX_CONSEC_FAILS = Number(process.env.MAX_CONSEC_FAILS ?? 6);
const DELAY_MS = Number(process.env.DELAY_MS ?? 8000);

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const quietLog = { info() {}, warn() {}, error() {}, debug() {}, child() { return quietLog; } } as never;
const provider = buildProvider({
  preferred: cfg.llmProvider, openaiApiKey: cfg.openaiApiKey, anthropicApiKey: cfg.anthropicApiKey, log: quietLog,
});

const noopPidfiles = { add() {}, remove() {} } as never;
// Edit worker: restricted to worktrees under the OS temp dir.
const selfClaudeCode = buildClaudeCode({
  pidfiles: noopPidfiles,
  check: (p) => (p.startsWith(tmpdir()) ? { ok: true } : { ok: false, reason: "self-improve cwd must be a worktree" }),
});
// Advisor worker (self-suggest): runs in the stable repo dir so the persistent
// session resumes correctly.
const advisor = buildClaudeCode({
  pidfiles: noopPidfiles,
  check: (p) => (p.startsWith(cfg.repoRoot) ? { ok: true } : { ok: false, reason: "advisor cwd must be the repo" }),
});
const selfRunner = buildRunner();

const deps: ImproverDeps = {
  reflect: (goal, failureLog) =>
    provider
      ? reflect({ provider, goal, knowledge: loadSelfKnowledge({ repoRoot: cfg.repoRoot }), failureLog })
      : Promise.resolve("CHANGE: (no provider)"),
  addWorktree: (id) => addWorktree(cfg.repoRoot, id),
  removeWorktree: (wt) => removeWorktree(cfg.repoRoot, wt),
  implement: async (brief, cwd) => {
    const r = await selfClaudeCode.run({ prompt: brief, cwd, runId: nanoid(12) });
    return r.ok ? { ok: true, output: r.output } : { ok: false, output: r.reason };
  },
  verify: (cwd) => verify({ cwd, run: selfRunner, bootSmoke }),
  headSha: () => headSha(cfg.repoRoot),
  commitWorktree: (cwd, msg) => {
    execFileSync("git", ["add", "-A"], { cwd });
    const staged = execFileSync("git", ["status", "--porcelain"], { cwd }).toString().trim();
    if (!staged) throw new Error("implement produced no changes");
    execFileSync("git", ["commit", "-m", msg], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
  },
  swapTo: (sha, lastKnownGood) => {
    // HARD GUARD: never ship a change that touches safety-critical code.
    // Diff the candidate against last-known-good (shared guard, single source).
    assertSwapSafe(cfg.repoRoot, lastKnownGood, sha);
    swapTo(cfg.repoRoot, sha);
  },
  revertTo: (sha) => revertTo(cfg.repoRoot, sha),
  restart: async () => {},
  watch: (knownGood, swapped) => {
    const healthUrl = `http://127.0.0.1:${cfg.port}/api/health`;
    const entry = join(cfg.repoRoot, "server/src/self/watchdog-main.ts");
    try {
      const c = spawn("npx", ["tsx", entry, cfg.repoRoot, knownGood, healthUrl, "45000", swapped],
        { cwd: cfg.repoRoot, detached: true, stdio: "ignore", shell: true });
      c.unref();
    } catch { /* */ }
    return Promise.resolve();
  },
  emit: (e) => log(`  step: ${e.step}${e.ok === false ? " (FAIL)" : ""}`),
};

async function main(): Promise<void> {
  const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: cfg.repoRoot }).toString().trim();
  log("=== AVA OVERNIGHT SELF-IMPROVEMENT LOOP START ===");
  log(`repo=${cfg.repoRoot} branch=${branch} provider=${provider ? "ok" : "MISSING"}`);
  if (!provider) { log("no LLM provider — aborting."); return; }

  let consecFails = 0;
  let shipped = 0;
  for (let i = 1; i <= MAX_ITERS; i++) {
    log(`--- iteration ${i}/${MAX_ITERS} (shipped ${shipped}) ---`);
    const session = getClaudeSession(cfg.memoryDir);
    let goal: string | null = null;
    try {
      goal = await suggestImprovement(advisor, { cwd: cfg.repoRoot, session });
      markClaudeSessionStarted(cfg.memoryDir);
    } catch (e) { log(`suggest error: ${e instanceof Error ? e.message : e}`); }

    if (!goal) { log("Ava suggested no further goal — stopping."); break; }
    log(`GOAL: ${goal}`);
    if (SAFETY_RE.test(goal)) { log("goal targets a safety-critical area — skipping."); continue; }

    const id = createIntent(db, { trigger: "schedule", goal });
    try { await runImprovement(db, id, deps); }
    catch (e) { log(`runImprovement threw: ${e instanceof Error ? e.message : e}`); }

    const it = getIntent(db, id);
    const status = it?.status ?? "unknown";
    const err = it?.error ?? "";
    log(`result: ${status}${err ? " — " + err.slice(0, 220) : ""}`);

    if (/credit balance is too low|credit balance too low|insufficient.*credit/i.test(err)) {
      log("CLAUDE CREDITS EXHAUSTED — stopping the loop, as requested.");
      break;
    }
    if (status === "swapped") { shipped++; consecFails = 0; log(`SHIPPED #${shipped}: ${it?.commit_sha?.slice(0, 12)}`); }
    else {
      consecFails++;
      if (consecFails >= MAX_CONSEC_FAILS) { log(`${consecFails} consecutive failures — stopping to avoid spinning.`); break; }
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  log(`=== LOOP END — shipped ${shipped} verified self-improvements ===`);
}

main().catch((e) => log(`FATAL: ${e instanceof Error ? e.stack : e}`));
