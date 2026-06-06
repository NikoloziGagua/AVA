import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export type DiscussionStatus = "running" | "done" | "failed";

export type Discussion = {
  id: string;
  created_at: number;
  topic: string;
  status: DiscussionStatus;
  result: string | null;
  error: string | null;
  session_id: string | null;
};

export function createDiscussion(db: Db, o: { topic: string; sessionId: string | null }): string {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO discussions (id, created_at, topic, status, session_id) VALUES (?, ?, ?, 'running', ?)",
  ).run(id, Date.now(), o.topic, o.sessionId);
  return id;
}

export function getDiscussion(db: Db, id: string): Discussion | null {
  return (db.prepare("SELECT * FROM discussions WHERE id = ?").get(id) as Discussion) ?? null;
}

export function listDiscussions(db: Db, limit = 10): Discussion[] {
  return db
    .prepare("SELECT * FROM discussions ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(limit) as Discussion[];
}

export function updateDiscussion(db: Db, id: string, patch: Partial<Omit<Discussion, "id" | "created_at">>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE discussions SET ${set} WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), id);
}

/**
 * On boot, no consult is in flight (the runner is in-memory), so any discussion
 * left 'running' was orphaned by a restart. Mark them failed so they don't
 * report as forever-"running". Returns how many were reconciled.
 */
export function failStaleDiscussions(db: Db): number {
  const r = db
    .prepare(
      "UPDATE discussions SET status = 'failed', error = COALESCE(error, 'interrupted by a server restart') " +
        "WHERE status = 'running'",
    )
    .run();
  return r.changes;
}
