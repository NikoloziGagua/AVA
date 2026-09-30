import type { Db } from "./db.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { appendMessage } from "./messages.js";

export type InterruptedConversationTask = { runId: string; sessionId: string };

/** Capture before Mission Control terminalizes orphaned runs. A connected
 * voice session or a session.active flag is not evidence of unfinished work. */
export function snapshotInterruptedConversationTasks(db: Db): InterruptedConversationTask[] {
  return db.prepare(`
    SELECT r.id AS runId, r.session_id AS sessionId FROM observability_runs r
    JOIN sessions s ON s.id = r.session_id AND s.deleted_at IS NULL
    WHERE r.run_kind IN ('chat_agent', 'voice_action')
      AND r.status NOT IN ('completed', 'failed', 'cancelled', 'timed_out', 'orphaned')
    ORDER BY r.started_at, r.id
  `).all() as InterruptedConversationTask[];
}

/** Call in the same startup transaction as terminal recovery projection so a
 * second crash cannot lose the notice between snapshot and reconciliation. */
export function recordInterruptedConversationTasks(db: Db, tasks: InterruptedConversationTask[]): void {
  db.transaction(() => {
    for (const task of tasks) {
      if (!/^[A-Za-z0-9:_-]{1,160}$/.test(task.runId)) continue;
      if (!db.prepare('SELECT id FROM sessions WHERE id = ? AND deleted_at IS NULL').get(task.sessionId)) continue;
      const exists = db.prepare(`SELECT id FROM messages WHERE session_id = ? AND role = 'system'
        AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END, '$.interruptedTaskId') = ? LIMIT 1
      `).get(task.sessionId, task.runId);
      if (exists) continue;
      // Preserve human recency, timestamps, and explicitly archived history.
      db.prepare("UPDATE sessions SET status = 'interrupted' WHERE id = ? AND status != 'archived'").run(task.sessionId);
      appendMessage(db, {
        sessionId: task.sessionId, role: 'system',
        content: 'Server restarted before this task recorded a completion status. Any saved result is still above; check it before deciding whether to retry.',
        metadata: { interruptedTaskId: task.runId },
      });
    }
  })();
}

export type RecoveryArgs = {
  db: Db;
  pidfiles: PidfileRegistry;
  kill: (pid: number) => Promise<boolean>;
  interruptedTasks?: InterruptedConversationTask[];
};

export async function runRecovery({ db, pidfiles, kill, interruptedTasks }: RecoveryArgs): Promise<void> {
  recordInterruptedConversationTasks(db, interruptedTasks ?? snapshotInterruptedConversationTasks(db));
  // 1. Kill orphaned worker pids.
  const all = pidfiles.listAll();
  await Promise.all(
    all.map(async ({ pid }) => {
      try { await kill(pid); } catch { /* ignore — we still clear */ }
    }),
  );
  const seenRuns = new Set(all.map((x) => x.runId));
  for (const runId of seenRuns) pidfiles.clear(runId);

}
