import type { Db } from "../state/db.js";
import { getIntent, updateIntent } from "./intents.js";

export type ImproverDeps = {
  reflect: (goal: string, failureLog: string | null) => Promise<string>;
  addWorktree: (id: string) => { path: string; branch: string };
  removeWorktree: (wt: { path: string; branch: string }) => void;
  implement: (brief: string, cwd: string) => Promise<{ ok: boolean; output: string }>;
  verify: (cwd: string) => Promise<{ ok: boolean; log: string }>;
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

export async function runImprovement(db: Db, id: string, deps: ImproverDeps): Promise<void> {
  if (inFlight) {
    // A concurrent request must NOT fail — queue it and run it when the slot frees.
    // The intent keeps its "queued" status, so it stays visible to self_improve_status.
    if (!pending.includes(id)) { pending.push(id); deps.emit({ intentId: id, step: "queued" }); }
    return;
  }
  inFlight = true;
  const intent = getIntent(db, id)!;
  let wt: { path: string; branch: string } | null = null;
  try {
    updateIntent(db, id, { status: "reflecting" }); deps.emit({ intentId: id, step: "reflecting" });
    const brief = await deps.reflect(intent.goal, null);

    updateIntent(db, id, { status: "implementing" }); deps.emit({ intentId: id, step: "implementing" });
    wt = deps.addWorktree(id);
    const impl = await deps.implement(brief, wt.path);
    // Record what the worker was told and what it produced, so a no-op or a bad
    // edit is diagnosable from the intent instead of vanishing.
    updateIntent(db, id, { diff_summary: `BRIEF:\n${brief}\n\nWORKER:\n${impl.output ?? ""}`.slice(0, 4000) });
    if (!impl.ok) throw new Error(`implement failed: ${impl.output.slice(0, 500)}`);

    updateIntent(db, id, { status: "verifying" }); deps.emit({ intentId: id, step: "verifying" });
    const v = await deps.verify(wt.path);
    updateIntent(db, id, { verify_log: v.log });
    if (!v.ok) throw new Error(v.log);

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
    updateIntent(db, id, { status: "failed", error: msg });
    deps.emit({ intentId: id, step: "failed", ok: false });
  } finally {
    if (wt) deps.removeWorktree(wt);
    inFlight = false;
    // Hand the slot to the next waiting intent, if any.
    const next = pending.shift();
    if (next) void runImprovement(db, next, deps);
  }
}
