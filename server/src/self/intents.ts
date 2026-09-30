import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { getSelfWorkerSelection, type SelfWorkerProvider, type SelfWorkerSelection } from "./worker-selection.js";

export type IntentTrigger = "explicit" | "failure" | "friction" | "schedule";
export type IntentStatus =
  | "queued" | "reflecting" | "awaiting_approval" | "implementing" | "verifying"
  | "recovering" | "blocked" | "swapped" | "failed" | "rolled_back";
export type ImprovementCancellationSource = "self_stop" | "global_stop" | "system_abort";

export type Intent = {
  id: string; created_at: number; trigger: IntentTrigger; goal: string;
  status: IntentStatus; branch: string | null; commit_sha: string | null;
  last_known_good: string | null; diff_summary: string | null;
  verify_log: string | null; outcome: string | null; error: string | null;
  worker_provider: SelfWorkerProvider; worker_selection_version: number;
  cancellation_source: ImprovementCancellationSource | null;
};

export function createIntent(
  db: Db,
  o: { trigger: IntentTrigger; goal: string; worker?: SelfWorkerSelection },
): string {
  const id = nanoid(12);
  const worker = o.worker ?? getSelfWorkerSelection(db);
  db.prepare(
    `INSERT INTO self_improvements
      (id, created_at, trigger, goal, status, worker_provider, worker_selection_version)
     VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(id, Date.now(), o.trigger, o.goal, worker.provider, worker.version);
  return id;
}

export function getIntent(db: Db, id: string): Intent | null {
  return (db.prepare("SELECT * FROM self_improvements WHERE id = ?").get(id) as Intent) ?? null;
}

export function listIntents(db: Db): Intent[] {
  return db.prepare("SELECT * FROM self_improvements ORDER BY created_at DESC, rowid DESC").all() as Intent[];
}

/**
 * On boot, no improvement loop is in flight (the lock is in-memory), so any
 * intent left in a non-terminal state was orphaned by a restart. Mark them
 * failed so they don't report as forever-"implementing" and don't mislead
 * self_improve_status. Returns how many were reconciled.
 */
export function failStaleIntents(db: Db): number {
  const reconcile = db.transaction(() => {
    // A restart during recovery does not invalidate the preserved, previously
    // approved candidate. Return it to the explicit retry boundary.
    const recovering = db.prepare(
      "UPDATE self_improvements SET status = 'blocked', outcome = 'verified candidate preserved', " +
        "error = 'Recovery was interrupted by a server restart; retry safe installation.' " +
        "WHERE status = 'recovering' AND commit_sha IS NOT NULL",
    ).run().changes;
    const active = db.prepare(
      "UPDATE self_improvements SET status = 'failed', error = COALESCE(error, 'interrupted by a server restart') " +
        "WHERE status IN ('queued','reflecting','awaiting_approval','implementing','verifying')",
    ).run().changes;
    // Compatibility for verified candidates created by the old build, which
    // misclassified a dirty-tree installation refusal as terminal failure.
    const legacyBlocked = db.prepare(
      "UPDATE self_improvements SET status = 'blocked', outcome = 'verified candidate preserved' " +
        "WHERE status = 'failed' AND commit_sha IS NOT NULL AND verify_log IS NOT NULL " +
        "AND (error LIKE 'refusing swap:%' OR error LIKE 'refusing non-fast-forward swap:%')",
    ).run().changes;
    return recovering + active + legacyBlocked;
  });
  return reconcile();
}

export function updateIntent(db: Db, id: string, patch: Partial<Omit<Intent, "id" | "created_at">>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE self_improvements SET ${set} WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), id);
}
