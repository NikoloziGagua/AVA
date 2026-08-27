import type { Db } from "../state/db.js";
import {
  getIntent,
  updateIntent,
  type ImprovementCancellationSource,
  type Intent,
} from "./intents.js";
import type { SelfWorkerProvider, SelfWorkerSelection } from "./worker-selection.js";
import { buildSelfWorkerExecutionPrompt, sanitizeWorkerEvidence } from "./workers.js";

export type ImproverDeps = {
  reflect: (goal: string, failureLog: string | null, signal?: AbortSignal) => Promise<string>;
  /** Gate: when this returns true, the improvement PAUSES after the plan is drafted
   *  and waits for the user to approve it before any code is written. User-triggered
   *  improvements gate; the unattended overnight loop does not. */
  requireApproval?: (intent: Intent) => boolean;
  /** Fired when an improvement parks at awaiting_approval — used to push the user so
   *  they know a plan is waiting for review. `plan` is the drafted change brief. */
  onAwaitingApproval?: (id: string, plan: string) => void;
  addWorktree: (id: string) => { path: string; branch: string; baseSha?: string };
  removeWorktree: (wt: { path: string; branch: string; baseSha?: string }) => void;
  implement: (provider: SelfWorkerProvider, brief: string, cwd: string, signal?: AbortSignal) => Promise<{ ok: boolean; output: string }>;
  verify: (cwd: string, signal?: AbortSignal) => Promise<{ ok: boolean; log: string }>;
  headSha: () => string;
  commitWorktree: (cwd: string, msg: string, baseSha: string) => string;
  /** Move the live tree to the verified commit. `lastKnownGood` is the pre-swap
   *  HEAD; the binding uses it to refuse a swap whose diff touches
   *  safety-critical code (Ava must not hot-swap a weakening of its guardrails). */
  swapTo: (sha: string, lastKnownGood: string) => void;
  revertTo: (sha: string) => void;
  restart: () => Promise<void>;
  /** Watchdog: rolls back to `knownGood` if the new build never gets healthy.
   *  `swapped` is the commit the swap moved HEAD to, so the watchdog can SKIP the
   *  rollback if newer work was committed on top in the meantime. */
  watch: (knownGood: string, swapped: string) => Promise<void>;
  emit: (e: { intentId: string; step: string; ok?: boolean; provider?: SelfWorkerProvider }) => void;
  /** Fired after a successful swap — bindings append the self-changelog here so
   *  Ava keeps a cheap, durable record of how she has changed. */
  onSwapped?: (intent: Intent, sha: string) => void;
  /** Fired on a real failure (not a user cancel) — bindings record the friction
   *  ledger entry here so failures become grounded goals for future cycles. */
  onFailed?: (intent: Intent, error: string) => void;
};

// ─── Pause gate ──────────────────────────────────────────────────────────────
// A real pause (the UI toggle used to be cosmetic): while paused, intake points
// (POST /api/self/improve and the self_improve chat tool) refuse new work.
// Already-running improvements finish; Cancel exists for those.
let paused = false;
export function setImprovementsPaused(p: boolean): void { paused = p; }
export function improvementsPaused(): boolean { return paused; }

let inFlight = false; // single-flight lock — one improvement mutates the tree at a time
const pending: string[] = []; // intents waiting their turn (FIFO), drained on completion
// AbortController per RUNNING improvement, keyed by intent id, so an in-flight
// self-improvement can be cancelled from the outside (the Cancel button / the red
// Stop). A pending (not-yet-running) improvement has no controller — it's cancelled
// by removing it from `pending`.
const controllers = new Map<string, AbortController>();
const cancellationSources = new Map<string, ImprovementCancellationSource>();
// Resolver per improvement currently parked at awaiting_approval. approve/reject (or
// a cancel via the abort signal) settles the promise the run is blocked on.
type PlanDecision =
  | { approved: true; worker: SelfWorkerSelection }
  | { approved: false };
const planDecisions = new Map<string, (decision: PlanDecision) => void>();

/** True if any self-improvement is running or queued. */
export function hasActiveImprovement(): boolean {
  return inFlight || pending.length > 0;
}

/** Approve a plan parked at awaiting_approval → the run proceeds to implement.
 *  Returns true if an improvement was actually waiting for this id. */
export function approveImprovement(id: string, worker: SelfWorkerSelection): boolean {
  const decide = planDecisions.get(id);
  if (!decide) return false;
  decide({ approved: true, worker });
  return true;
}

/** Reject a plan parked at awaiting_approval → the run stops without writing code. */
export function rejectImprovement(id: string): boolean {
  const decide = planDecisions.get(id);
  if (!decide) return false;
  decide({ approved: false });
  return true;
}

function cancellationText(source: ImprovementCancellationSource): string {
  if (source === "self_stop") return "cancelled from Self";
  if (source === "global_stop") return "cancelled by global Stop";
  return "cancelled by the system";
}

/** Cancel one self-improvement by id — whether it's the running one (abort its
 *  signal, which propagates into reflect/implement/verify) or a queued one (drop
 *  it from the FIFO). Returns true if something was cancelled. */
export function cancelImprovement(
  db: Db,
  id: string,
  source: ImprovementCancellationSource = "self_stop",
): boolean {
  const ac = controllers.get(id);
  if (ac) {
    cancellationSources.set(id, source);
    try { ac.abort(); } catch { /* */ }
    return true;
  }
  const i = pending.indexOf(id);
  if (i >= 0) {
    pending.splice(i, 1);
    updateIntent(db, id, {
      status: "failed",
      outcome: "cancelled",
      cancellation_source: source,
      error: `${cancellationText(source)} before it started`,
    });
    return true;
  }
  return false;
}

/** Cancel EVERY running and queued self-improvement (the global Stop — what the red
 *  button reaches for). Returns how many were cancelled. */
export function cancelAllImprovements(
  db: Db,
  source: ImprovementCancellationSource = "global_stop",
): number {
  let n = 0;
  for (const [id, ac] of controllers) {
    cancellationSources.set(id, source);
    try { ac.abort(); } catch { /* */ }
    n++;
  }
  while (pending.length) {
    const id = pending.shift()!;
    updateIntent(db, id, {
      status: "failed",
      outcome: "cancelled",
      cancellation_source: source,
      error: cancellationText(source),
    });
    n++;
  }
  return n;
}

export async function runImprovement(db: Db, id: string, deps: ImproverDeps): Promise<void> {
  if (inFlight) {
    // A concurrent request must NOT fail — queue it and run it when the slot frees.
    // The intent keeps its "queued" status, so it stays visible to self_improve_status.
    if (!pending.includes(id)) { pending.push(id); deps.emit({ intentId: id, step: "queued" }); }
    return;
  }
  inFlight = true;
  // Per-improvement abort: cancel() flips this; it threads into the LLM reflect, the
  // claude_code worker, and the verify subprocess, and is checked between steps.
  const ac = new AbortController();
  controllers.set(id, ac);
  const signal = ac.signal;
  const throwIfAborted = () => { if (signal.aborted) throw new Error("cancelled"); };
  let intent = getIntent(db, id)!;
  let wt: { path: string; branch: string; baseSha?: string } | null = null;
  try {
    throwIfAborted();
    updateIntent(db, id, { status: "reflecting" }); deps.emit({ intentId: id, step: "reflecting" });
    const brief = await deps.reflect(intent.goal, null, signal);
    throwIfAborted();
    const approvalRequired = deps.requireApproval?.(intent) ?? false;

    // PLAN GATE: user-triggered improvements show the drafted plan and wait for the
    // user to approve it BEFORE any code is written — so nothing runs away unseen.
    // (The unattended overnight loop sets requireApproval=false and skips this.)
    if (approvalRequired) {
      const safePlan = sanitizeWorkerEvidence(brief, 3_990);
      updateIntent(db, id, { status: "awaiting_approval", diff_summary: `PLAN:\n${safePlan}`.slice(0, 4000) });
      deps.emit({ intentId: id, step: "awaiting_approval", provider: intent.worker_provider });
      deps.onAwaitingApproval?.(id, safePlan);
      const decision = await new Promise<PlanDecision>((resolve) => {
        planDecisions.set(id, resolve);
        // A cancel (abort) while parked counts as "do not proceed".
        signal.addEventListener("abort", () => resolve({ approved: false }), { once: true });
      });
      planDecisions.delete(id);
      if (!decision.approved) {
        const cancelled = signal.aborted;
        const cancellationSource = cancellationSources.get(id) ?? "system_abort";
        updateIntent(db, id, {
          status: "failed",
          outcome: cancelled ? "cancelled" : "rejected",
          cancellation_source: cancelled ? cancellationSource : null,
          error: cancelled ? cancellationText(cancellationSource) : "plan rejected by user",
        });
        deps.emit({ intentId: id, step: cancelled ? "cancelled" : "rejected", ok: false });
        return; // no worktree created yet; finally just frees the slot
      }
      // Approval is the authoritative worker lock. The user can change the
      // selector while AVA drafts the plan; the exact approved provider/version
      // is persisted before any worktree or provider process exists.
      updateIntent(db, id, {
        worker_provider: decision.worker.provider,
        worker_selection_version: decision.worker.version,
      });
      intent = getIntent(db, id)!;
    }

    const execution = buildSelfWorkerExecutionPrompt({
      intentId: id,
      approvedGoal: intent.goal,
      approvedPlan: brief,
      authorization: approvalRequired
        ? "explicit_user_approval"
        : "owner_configured_unattended_policy",
    });
    const safeBrief = sanitizeWorkerEvidence(brief, 2_000);
    updateIntent(db, id, {
      diff_summary: `APPROVED SCOPE SHA-256: ${execution.scopeSha256}\n\nBRIEF:\n${safeBrief}`.slice(0, 4000),
    });
    updateIntent(db, id, { status: "implementing" }); deps.emit({ intentId: id, step: "implementing", provider: intent.worker_provider });
    wt = deps.addWorktree(id);
    const impl = await deps.implement(intent.worker_provider, execution.prompt, wt.path, signal);
    // Record what the worker was told and what it produced, so a no-op or a bad
    // edit is diagnosable from the intent instead of vanishing.
    const safeOutput = sanitizeWorkerEvidence(impl.output ?? "", 1_900);
    updateIntent(db, id, { diff_summary: `APPROVED SCOPE SHA-256: ${execution.scopeSha256}\n\nBRIEF:\n${safeBrief}\n\nWORKER (${intent.worker_provider}):\n${safeOutput}`.slice(0, 4000) });
    if (!impl.ok) throw new Error(`implement failed: ${impl.output.slice(0, 500)}`);
    throwIfAborted();

    updateIntent(db, id, { status: "verifying" }); deps.emit({ intentId: id, step: "verifying", provider: intent.worker_provider });
    const v = await deps.verify(wt.path, signal);
    updateIntent(db, id, { verify_log: v.log });
    if (!v.ok) throw new Error(v.log);
    throwIfAborted();

    const knownGood = deps.headSha();
    const sha = deps.commitWorktree(wt.path, `self: ${intent.goal}`, wt.baseSha ?? knownGood);
    updateIntent(db, id, { last_known_good: knownGood, commit_sha: sha, branch: wt.branch });
    deps.swapTo(sha, knownGood);
    deps.emit({ intentId: id, step: "swapped", ok: true });
    updateIntent(db, id, { status: "swapped", outcome: "shipped" });
    try { deps.onSwapped?.(intent, sha); } catch { /* changelog is best-effort */ }

    void deps.watch(knownGood, sha); // transient watchdog; rolls back if unhealthy (skips if newer work landed)
    await deps.restart();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A cancel surfaces here (either the throwIfAborted, or a worker/subprocess that
    // was killed by the signal). Record it as cancelled, not a failure.
    if (signal.aborted) {
      const cancellationSource = cancellationSources.get(id) ?? "system_abort";
      updateIntent(db, id, {
        status: "failed",
        outcome: "cancelled",
        cancellation_source: cancellationSource,
        error: cancellationText(cancellationSource),
      });
      deps.emit({ intentId: id, step: "cancelled", ok: false });
    } else {
      updateIntent(db, id, { status: "failed", error: msg });
      deps.emit({ intentId: id, step: "failed", ok: false });
      try { deps.onFailed?.(intent, msg); } catch { /* ledger is best-effort */ }
    }
  } finally {
    controllers.delete(id);
    cancellationSources.delete(id);
    if (wt) deps.removeWorktree(wt);
    inFlight = false;
    // Hand the slot to the next waiting intent, if any.
    const next = pending.shift();
    if (next) void runImprovement(db, next, deps);
  }
}
