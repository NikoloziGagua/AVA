import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";

export type IntentTrigger = "explicit" | "failure" | "friction" | "schedule";
export type IntentStatus =
  | "queued" | "reflecting" | "implementing" | "verifying"
  | "swapped" | "failed" | "rolled_back";

export type Intent = {
  id: string; created_at: number; trigger: IntentTrigger; goal: string;
  status: IntentStatus; branch: string | null; commit_sha: string | null;
  last_known_good: string | null; diff_summary: string | null;
  verify_log: string | null; outcome: string | null; error: string | null;
};

export function createIntent(db: Db, o: { trigger: IntentTrigger; goal: string }): string {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO self_improvements (id, created_at, trigger, goal, status) VALUES (?, ?, ?, ?, 'queued')",
  ).run(id, Date.now(), o.trigger, o.goal);
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
  const r = db
    .prepare(
      "UPDATE self_improvements SET status = 'failed', error = COALESCE(error, 'interrupted by a server restart') " +
        "WHERE status IN ('queued','reflecting','implementing','verifying')",
    )
    .run();
  return r.changes;
}

export function updateIntent(db: Db, id: string, patch: Partial<Omit<Intent, "id" | "created_at">>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE self_improvements SET ${set} WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), id);
}
