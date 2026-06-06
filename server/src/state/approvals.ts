import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type Approval = {
  id: string;
  session_id: string;
  tool: string;
  args: string; // JSON
  summary: string;
  status: ApprovalStatus;
  created_at: number;
  decided_at: number | null;
};

type DecisionEvent = { id: string; status: ApprovalStatus };
export const approvalEvents = new EventEmitter();
// Bump default cap; one process can have many concurrent waiters.
approvalEvents.setMaxListeners(100);

export type CreateApprovalArgs = {
  sessionId: string;
  tool: string;
  args: unknown;
  summary: string;
};

export function createApproval(db: Db, args: CreateApprovalArgs): Approval {
  const id = nanoid(12);
  const now = Date.now();
  const argsJson = JSON.stringify(args.args);
  db.prepare(
    "INSERT INTO approvals (id, session_id, tool, args, summary, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, args.sessionId, args.tool, argsJson, args.summary, "pending", now, null);
  return {
    id, session_id: args.sessionId, tool: args.tool, args: argsJson, summary: args.summary,
    status: "pending", created_at: now, decided_at: null,
  };
}

export function getApproval(db: Db, id: string): Approval | null {
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Approval | undefined;
  return row ?? null;
}

export function listPendingForSession(db: Db, sessionId: string): Approval[] {
  return db.prepare(
    "SELECT * FROM approvals WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC",
  ).all(sessionId) as Approval[];
}

export function decide(db: Db, id: string, status: "approved" | "denied"): boolean {
  const r = db.prepare(
    "UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
  ).run(status, Date.now(), id);
  if (r.changes === 0) return false;
  approvalEvents.emit("decided", { id, status } satisfies DecisionEvent);
  return true;
}

export function expirePending(db: Db, olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  const r = db.prepare(
    "UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at < ?",
  ).run(Date.now(), cutoff);
  return r.changes;
}

export function waitForDecision(
  db: Db,
  id: string,
  timeoutMs: number = 600_000,
  /**
   * What an undecided approval becomes when the window elapses. "expire" =
   * treat as not-granted (block); "approve" = Sir didn't decline in time, so
   * proceed (the 15s veto-window behaviour).
   */
  onTimeout: "expire" | "approve" = "expire",
  /**
   * The run's abort signal. When the red Stop button fires mid-approval, resolve
   * immediately as "expired" (NOT approved) so a Stop during the veto window
   * cancels the tool instead of auto-approving and running it. Without this the
   * approve-on-timeout path blocks the full window and Stop is ignored.
   */
  signal?: AbortSignal,
): Promise<{ status: ApprovalStatus }> {
  return new Promise((resolve) => {
    // Resolve immediately if already decided.
    const cur = getApproval(db, id);
    if (cur && cur.status !== "pending") {
      resolve({ status: cur.status });
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      approvalEvents.off("decided", onDecided);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    const onDecided = (e: DecisionEvent) => {
      if (e.id !== id) return;
      cleanup();
      resolve({ status: e.status });
    };

    // Stop fired (before or during the wait): mark the pending approval expired
    // and resolve as expired regardless of onTimeout, so the tool does NOT run.
    const expireNow = () => {
      cleanup();
      const r = db.prepare(
        "UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'",
      ).run(Date.now(), id);
      if (r.changes > 0) approvalEvents.emit("decided", { id, status: "expired" } satisfies DecisionEvent);
      resolve({ status: "expired" });
    };
    const onAbort = () => expireNow();

    // Resolve immediately if Stop already fired before we started waiting.
    if (signal?.aborted) {
      expireNow();
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      const finalStatus: ApprovalStatus = onTimeout === "approve" ? "approved" : "expired";
      // Record the timeout outcome in DB; emit so any other waiter resolves too.
      const r = db.prepare(
        "UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      ).run(finalStatus, Date.now(), id);
      if (r.changes > 0) approvalEvents.emit("decided", { id, status: finalStatus } satisfies DecisionEvent);
      resolve({ status: finalStatus });
    }, timeoutMs);

    approvalEvents.on("decided", onDecided);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}
