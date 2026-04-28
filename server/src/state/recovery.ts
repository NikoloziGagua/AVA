import type { Db } from "./db.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { listByStatus, setStatus } from "./sessions.js";
import { appendMessage } from "./messages.js";

export type RecoveryArgs = {
  db: Db;
  pidfiles: PidfileRegistry;
  kill: (pid: number) => Promise<boolean>;
};

export async function runRecovery({ db, pidfiles, kill }: RecoveryArgs): Promise<void> {
  // 1. Kill orphaned worker pids.
  const all = pidfiles.listAll();
  await Promise.all(
    all.map(async ({ pid }) => {
      try { await kill(pid); } catch { /* ignore — we still clear */ }
    }),
  );
  const seenRuns = new Set(all.map((x) => x.runId));
  for (const runId of seenRuns) pidfiles.clear(runId);

  // 2. Mark active sessions as interrupted with a system message.
  const active = listByStatus(db, "active");
  for (const s of active) {
    setStatus(db, s.id, "interrupted");
    appendMessage(db, {
      sessionId: s.id,
      role: "system",
      content: "Server restarted; this task may have been interrupted. Send a new message to continue.",
    });
  }
}
