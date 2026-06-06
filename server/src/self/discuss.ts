import type { Db } from "../state/db.js";
import { getDiscussion, updateDiscussion } from "../state/discussions.js";

export type DiscussDeps = {
  /** Runs claude about the topic, READ-ONLY (no edits). */
  consult: (topic: string) => Promise<{ ok: boolean; text: string }>;
  /** Push Sir + append Ava's relay into the session it was started from. */
  deliver: (o: { sessionId: string | null; topic: string; ok: boolean; result: string }) => void;
};

/**
 * Background consult orchestration: ask Claude about the topic, persist the
 * outcome, then ALWAYS deliver (push + transcript relay) so Sir hears back even
 * when the consult fails. Fire-and-forget by the caller; never throws.
 */
export async function runDiscussion(db: Db, id: string, deps: DiscussDeps): Promise<void> {
  const row = getDiscussion(db, id);
  if (!row) return;

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
  deps.deliver({ sessionId: row.session_id, topic: row.topic, ok, result });
}
