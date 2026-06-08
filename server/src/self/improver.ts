import type { Db } from "../state/db.js";
import { getIntent, updateIntent } from "./intents.js";

export type ImproverDeps = {
  reflect: (goal: string, failureLog: string | null, signal?: AbortSignal) => Promise<string>;
  addWorktree: (id: string) => { path: string; branch: string };
  removeWorktree: (wt: { path: string; branch: string }) => void;
  implement: (brief: string, cwd: string, signal?: AbortSignal) => Promise<{ ok: boolean; output: string }>;
  verify: (cwd: string, signal?: AbortSignal) => Promise<{ ok: boolean; log: string }>;
  headSha: () => string;
  commitWorktree: (cwd: string, msg: string) => string;
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
  emit: (e: { intentId: string; step: string; ok?: boolean }) => void;
};

let inFlight = false; // single-flight lock — one improvement mutates the tree at a time
const pending: string[] = []; // intents waiting their turn (FIFO), drained on completion
// AbortController per RUNNING improvement, keyed by intent id, so an in-flight
// self-improvement can be cancelled from the outside (the Cancel button / the red
// Stop). A pending (not-yet-running) improvement has no controller — it's cancelled
// by removing it from `pending`.
const controllers = new Map<string, AbortController>();

/** True if any self-improvement is running or queued. */
export function hasActiveImprovement(): boolean {
  return inFlight || pending.length > 0;
}

/** Cancel one self-improvement by id — whether it's the running one (abort its
 *  signal, which propagates into reflect/implement/verify) or a queued one (drop
 *  it from the FIFO). Returns true if something was cancelled. */
export function cancelImprovement(db: Db, id: string): boolean {
  const ac = controllers.get(id);
  if (ac) { try { ac.abort(); } catch { /* */ } return true; }
  const i = pending.indexOf(id);
  if (i >= 0) {
    pending.splice(i, 1);
    updateIntent(db, id, { status: "failed", outcome: "cancelled", error: "cancelled before it started" });
    return true;
  }
  return false;
}

/** Cancel EVERY running and queued self-improvement (the global Stop — what the red
 *  button reaches for). Returns how many were cancelled. */
export function cancelAllImprovements(db: Db): number {
  let n = 0;
  for (const ac of controllers.values()) { try { ac.abort(); } catch { /* */ } n++; }
  while (pending.length) {
    const id = pending.shift()!;
    updateIntent(db, id, { status: "failed", outcome: "cancelled", error: "cancelled" });
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
  const intent = getIntent(db, id)!;
  let wt: { path: string; branch: string } | null = null;
  try {
    throwIfAborted();
    updateIntent(db, id, { status: "reflecting" }); deps.emit({ intentId: id, step: "reflecting" });
    const brief = await deps.reflect(intent.goal, null, signal);
    throwIfAborted();

    updateIntent(db, id, { status: "implementing" }); deps.emit({ intentId: id, step: "implementing" });
    wt = deps.addWorktree(id);
    const impl = await deps.implement(brief, wt.path, signal);
    // Record what the worker was told and what it produced, so a no-op or a bad
    // edit is diagnosable from the intent instead of vanishing.
    updateIntent(db, id, { diff_summary: `BRIEF:\n${brief}\n\nWORKER:\n${impl.output ?? ""}`.slice(0, 4000) });
    if (!impl.ok) throw new Error(`implement failed: ${impl.output.slice(0, 500)}`);
    throwIfAborted();

    updateIntent(db, id, { status: "verifying" }); deps.emit({ intentId: id, step: "verifying" });
    const v = await deps.verify(wt.path, signal);
    updateIntent(db, id, { verify_log: v.log });
    if (!v.ok) throw new Error(v.log);
    throwIfAborted();

    const knownGood = deps.headSha();
    const sha = deps.commitWorktree(wt.path, `self: ${intent.goal}`);
    updateIntent(db, id, { last_known_good: knownGood, commit_sha: sha, branch: wt.branch });
    deps.swapTo(sha, knownGood);
    deps.emit({ intentId: id, step: "swapped", ok: true });
    updateIntent(db, id, { status: "swapped", outcome: "shipped" });

    void deps.watch(knownGood, sha); // transient watchdog; rolls back if unhealthy (skips if newer work landed)
    await deps.restart();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A cancel surfaces here (either the throwIfAborted, or a worker/subprocess that
    // was killed by the signal). Record it as cancelled, not a failure.
    if (signal.aborted) {
      updateIntent(db, id, { status: "failed", outcome: "cancelled", error: "cancelled by user" });
      deps.emit({ intentId: id, step: "cancelled", ok: false });
    } else {
      updateIntent(db, id, { status: "failed", error: msg });
      deps.emit({ intentId: id, step: "failed", ok: false });
    }
  } finally {
    controllers.delete(id);
    if (wt) deps.removeWorktree(wt);
    inFlight = false;
    // Hand the slot to the next waiting intent, if any.
    const next = pending.shift();
    if (next) void runImprovement(db, next, deps);
  }
}
