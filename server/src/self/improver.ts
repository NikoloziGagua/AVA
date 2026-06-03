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
  swapTo: (sha: string) => void;
  revertTo: (sha: string) => void;
  restart: () => Promise<void>;
  watch: (knownGood: string) => Promise<void>;
  emit: (e: { intentId: string; step: string; ok?: boolean }) => void;
};

let inFlight = false; // single-flight lock

export async function runImprovement(db: Db, id: string, deps: ImproverDeps): Promise<void> {
  if (inFlight) { updateIntent(db, id, { status: "failed", error: "another improvement is in progress" }); return; }
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
    deps.swapTo(sha);
    deps.emit({ intentId: id, step: "swapped", ok: true });
    updateIntent(db, id, { status: "swapped", outcome: "shipped" });

    void deps.watch(knownGood); // transient watchdog; rolls back if unhealthy
    await deps.restart();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateIntent(db, id, { status: "failed", error: msg });
    deps.emit({ intentId: id, step: "failed", ok: false });
  } finally {
    if (wt) deps.removeWorktree(wt);
    inFlight = false;
  }
}
