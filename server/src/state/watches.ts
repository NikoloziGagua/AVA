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
  /** One-shot: fire once at/after this epoch-ms (reminders, "at 6pm today"). */
  run_at: number | null;
  /** Recurring daily: fire once per day at "HH:MM" local (morning briefing). */
  daily_at: string | null;
  /** "check" runs a full agent turn; "reminder" is a direct push at due time
   *  — zero agent cost, the prompt IS the notification text. */
  kind: "check" | "reminder";
};

export function createWatch(db: Db, o: {
  prompt: string;
  /** Interval mode. Ignored when runAt or dailyAt is set. */
  intervalMinutes?: number;
  once?: boolean;
  runAt?: number;
  dailyAt?: string;            // "HH:MM" 24h local
  kind?: "check" | "reminder";
}): Watch {
  const id = nanoid(12);
  if (o.dailyAt && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(o.dailyAt)) {
    throw new Error(`invalid dailyAt "${o.dailyAt}" — expected HH:MM (24h)`);
  }
  // Interval is only meaningful in interval mode, but the column is NOT NULL —
  // store a day as an inert placeholder for run_at/daily_at watches.
  const interval = o.runAt || o.dailyAt ? 24 * 60 : Math.max(1, Math.round(o.intervalMinutes ?? 60));
  db.prepare(
    "INSERT INTO watches (id, prompt, interval_minutes, once, enabled, created_at, run_at, daily_at, kind) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)",
  ).run(
    id, o.prompt, interval, o.once === false ? 0 : 1, Date.now(),
    o.runAt ?? null, o.dailyAt ?? null, o.kind === "reminder" ? "reminder" : "check",
  );
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

/** Today's occurrence of an "HH:MM" local time, epoch ms. */
export function todaysOccurrence(dailyAt: string, now: number): number {
  const [h, m] = dailyAt.split(":").map(Number);
  const d = new Date(now);
  d.setHours(h!, m!, 0, 0);
  return d.getTime();
}

/**
 * Watches due right now. Three schedule modes:
 *  - run_at set   → one-shot: due once `now` passes it (never run before)
 *  - daily_at set → due once per day after the HH:MM local occurrence
 *  - otherwise    → interval: never run, or interval elapsed since last run
 */
export function dueWatches(db: Db, now: number = Date.now()): Watch[] {
  return (db.prepare("SELECT * FROM watches WHERE enabled = 1").all() as Watch[])
    .filter((w) => {
      if (w.run_at !== null) return now >= w.run_at && w.last_run_at === null;
      if (w.daily_at) {
        const occ = todaysOccurrence(w.daily_at, now);
        return now >= occ && (w.last_run_at === null || w.last_run_at < occ);
      }
      return w.last_run_at === null || now - w.last_run_at >= w.interval_minutes * 60_000;
    });
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
