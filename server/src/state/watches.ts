import { nanoid } from "nanoid";
import type { Db } from "./db.js";

// Long-term monitoring: a watch is a standing instruction ("notify me if the
// RTX 5090 drops below $1800") that the scheduler re-checks on an interval.
// Every check runs as a normal agent turn inside the watch's own chat session,
// so Sir can open that session and see exactly what was checked and when.

export type Watch = {
  id: string;
  prompt: string;
  interval_minutes: number;
  once: number;      // 1 = disable after first trigger
  enabled: number;
  session_id: string | null;
  created_at: number;
  last_run_at: number | null;
  last_status: "ok" | "triggered" | "unclear" | "error" | null;
  last_result: string | null;
};

export function createWatch(db: Db, o: {
  prompt: string; intervalMinutes: number; once?: boolean;
}): Watch {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO watches (id, prompt, interval_minutes, once, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
  ).run(id, o.prompt, Math.max(1, Math.round(o.intervalMinutes)), o.once === false ? 0 : 1, Date.now());
  return getWatch(db, id)!;
}

export function getWatch(db: Db, id: string): Watch | null {
  return (db.prepare("SELECT * FROM watches WHERE id = ?").get(id) as Watch | undefined) ?? null;
}

export function listWatches(db: Db): Watch[] {
  return db.prepare("SELECT * FROM watches ORDER BY created_at DESC").all() as Watch[];
}

export function deleteWatch(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM watches WHERE id = ?").run(id).changes > 0;
}

export function setWatchEnabled(db: Db, id: string, enabled: boolean): void {
  db.prepare("UPDATE watches SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

/** Watches due for a check: enabled, and never run or past their interval. */
export function dueWatches(db: Db, now: number = Date.now()): Watch[] {
  return (db.prepare("SELECT * FROM watches WHERE enabled = 1").all() as Watch[])
    .filter((w) => w.last_run_at === null || now - w.last_run_at >= w.interval_minutes * 60_000);
}

export function recordWatchRun(db: Db, id: string, o: {
  status: NonNullable<Watch["last_status"]>;
  result: string;
  sessionId?: string;
  now?: number;
}): void {
  db.prepare(
    "UPDATE watches SET last_run_at = ?, last_status = ?, last_result = ?, session_id = COALESCE(?, session_id) WHERE id = ?",
  ).run(o.now ?? Date.now(), o.status, o.result.slice(0, 500), o.sessionId ?? null, id);
}
