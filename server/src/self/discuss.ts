import type { Db } from "../state/db.js";
import { getDiscussion, updateDiscussion, type Discussion } from "../state/discussions.js";

export type DiscussionObservation = {
  running?: (discussion: Discussion, at: number) => void;
  completed?: (discussion: Discussion, result: string, at: number, durationMs: number) => void;
  failed?: (discussion: Discussion, error: string, at: number, durationMs: number) => void;
};

export type DiscussDeps = {
  /** Runs claude about the topic, READ-ONLY (no edits). */
  consult: (topic: string) => Promise<{ ok: boolean; text: string }>;
  /** Push Sir + append Ava's relay into the session it was started from. */
  deliver: (o: { sessionId: string | null; topic: string; ok: boolean; result: string }) => void;
  /** Best-effort normalized Mission Control boundary; never owns execution. */
  observe?: DiscussionObservation;
};

function observeSafely(action: (() => void) | undefined): void {
  if (!action) return;
  try { action(); } catch { /* communication work wins over its read model */ }
}

/**
 * Background consult orchestration: ask Claude about the topic, persist the
 * outcome, then ALWAYS deliver (push + transcript relay) so Sir hears back even
 * when the consult fails. Fire-and-forget by the caller; never throws.
 */
export async function runDiscussion(db: Db, id: string, deps: DiscussDeps): Promise<void> {
  const row = getDiscussion(db, id);
  if (!row) return;

  const startedAt = Date.now();
  observeSafely(deps.observe?.running
    ? () => deps.observe!.running!(row, startedAt)
    : undefined);
  let ok = false;
  let result = "";
  try {
    const r = await deps.consult(row.topic);
    ok = r.ok;
    result = r.text;
    if (ok) updateDiscussion(db, id, { status: "done", result });
    else updateDiscussion(db, id, { status: "failed", error: result });
  } catch (e) {
    ok = false;
    result = e instanceof Error ? e.message : String(e);
    updateDiscussion(db, id, { status: "failed", error: result });
  }
  const completedAt = Date.now();
  const durationMs = Math.max(0, completedAt - startedAt);
  observeSafely(ok
    ? deps.observe?.completed
      ? () => deps.observe!.completed!(row, result, completedAt, durationMs)
      : undefined
    : deps.observe?.failed
      ? () => deps.observe!.failed!(row, result, completedAt, durationMs)
      : undefined);
  deps.deliver({ sessionId: row.session_id, topic: row.topic, ok, result });
}
