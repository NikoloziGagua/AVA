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
  last_status: "ok" | "triggered" | "unclear" | "error" | "busy" | "dispatching" | "delivered" | "running" | "completed" | null;
  last_result: string | null;
  /** One-shot: fire once at/after this epoch-ms (reminders, "at 6pm today"). */
  run_at: number | null;
  /** Recurring daily: fire once per day at "HH:MM" local (morning briefing). */
  daily_at: string | null;
  /** "check" runs a full agent turn; "reminder" is a direct push at due time
   *  — zero agent cost, the prompt IS the notification text. */
  kind: "check" | "reminder" | "codex";
  target_thread_id: string | null;
  target_session_file: string | null;
  target_cwd: string | null;
  continue_cycle: number;
  parent_watch_id: string | null;
  delivery_marker: string | null;
  dispatch_offset: number | null;
  dispatch_turn_id: string | null;
  dispatch_pid: number | null;
  delivered_at: number | null;
  completed_at: number | null;
};

export function createWatch(db: Db, o: {
  prompt: string;
  /** Interval mode. Ignored when runAt or dailyAt is set. */
  intervalMinutes?: number;
  once?: boolean;
  runAt?: number;
  dailyAt?: string;            // "HH:MM" 24h local
  kind?: "check" | "reminder" | "codex";
  target?: { threadId: string; sessionFile: string; cwd: string };
  continueCycle?: boolean;
  parentWatchId?: string;
}): Watch {
  const id = nanoid(12);
  if (o.dailyAt && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(o.dailyAt)) {
    throw new Error(`invalid dailyAt "${o.dailyAt}" — expected HH:MM (24h)`);
  }
  // Interval is only meaningful in interval mode, but the column is NOT NULL —
  // store a day as an inert placeholder for run_at/daily_at watches.
  const interval = o.runAt || o.dailyAt ? 24 * 60 : Math.max(1, Math.round(o.intervalMinutes ?? 60));
  db.prepare(
    `INSERT INTO watches (
      id, prompt, interval_minutes, once, enabled, created_at, run_at, daily_at, kind,
      target_thread_id, target_session_file, target_cwd, continue_cycle, parent_watch_id
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, o.prompt, interval, o.once === false ? 0 : 1, Date.now(),
    o.runAt ?? null, o.dailyAt ?? null, o.kind === "reminder" ? "reminder" : o.kind === "codex" ? "codex" : "check",
    o.target?.threadId ?? null, o.target?.sessionFile ?? null, o.target?.cwd ?? null,
    o.continueCycle ? 1 : 0, o.parentWatchId ?? null,
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

export function getChildWatch(db: Db, parentWatchId: string): Watch | null {
  return (db.prepare("SELECT * FROM watches WHERE parent_watch_id = ?").get(parentWatchId) as Watch | undefined) ?? null;
}

export function recordCodexDispatch(db: Db, id: string, input: {
  marker: string;
  offset: number;
  turnId?: string | null;
  pid?: number | null;
  delivered?: boolean;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  db.prepare(`
    UPDATE watches
    SET delivery_marker = ?, dispatch_offset = ?, dispatch_turn_id = COALESCE(?, dispatch_turn_id),
        dispatch_pid = COALESCE(?, dispatch_pid), delivered_at = CASE WHEN ? = 1 THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
        last_run_at = ?, last_status = ?, last_result = ?
    WHERE id = ?
  `).run(
    input.marker, input.offset, input.turnId ?? null, input.pid ?? null,
    input.delivered ? 1 : 0, now, now,
    input.delivered ? "delivered" : "dispatching",
    input.delivered ? "instruction verified in pinned Codex thread" : "instruction staged; awaiting pinned-thread evidence",
    id,
  );
}

export function recordCodexCompleted(db: Db, id: string, now = Date.now()): void {
  db.prepare(`
    UPDATE watches
    SET completed_at = COALESCE(completed_at, ?), last_run_at = ?, last_status = 'completed',
        last_result = 'pinned Codex task reached a completed task boundary'
    WHERE id = ?
  `).run(now, now, id);
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
      // Codex delivery is a state machine, not a periodic condition check.
      // Once staged it must be inspected on every scheduler tick so a Stop
      // hook waiting at the clean boundary can receive its planned successor.
      if (w.kind === "codex" && w.delivery_marker !== null) return true;
      // Ordinary one-shots run once. A targeted delivery is multi-phase
      // (wait -> dispatch -> verify -> complete), so it remains due after its
      // start time until the scheduler explicitly completes/disables it.
      if (w.run_at !== null) return now >= w.run_at && (w.kind === "codex" || w.last_run_at === null);
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
