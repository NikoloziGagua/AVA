import type { TaskReceipt } from "../receipts/task-receipt.js";
import type { Db } from "./db.js";

export const TASK_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type ReceiptRow = {
  task_id: string;
  receipt_json: string;
};

export function saveTaskReceipt(
  db: Db,
  sessionId: string,
  receipt: TaskReceipt,
  now = Date.now(),
): void {
  db.prepare(`
    INSERT INTO task_receipts (task_id, session_id, receipt_json, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      session_id = excluded.session_id,
      receipt_json = excluded.receipt_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).run(
    receipt.taskId,
    sessionId,
    JSON.stringify(receipt),
    now,
    now + TASK_RECEIPT_RETENTION_MS,
  );
}

export function getTaskReceipt(
  db: Db,
  input: { sessionId: string; taskId?: string | null; now?: number },
): TaskReceipt | null {
  const now = input.now ?? Date.now();
  const row = input.taskId
    ? db.prepare(`
        SELECT task_id, receipt_json
        FROM task_receipts
        WHERE session_id = ? AND task_id = ? AND expires_at > ?
      `).get(input.sessionId, input.taskId, now) as ReceiptRow | undefined
    : db.prepare(`
        SELECT task_id, receipt_json
        FROM task_receipts
        WHERE session_id = ? AND expires_at > ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(input.sessionId, now) as ReceiptRow | undefined;
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.receipt_json) as Partial<TaskReceipt>;
    if (parsed.schemaVersion !== 1 || parsed.taskId !== row.task_id ||
        typeof parsed.expected !== "string" || typeof parsed.actual !== "string" ||
        !Array.isArray(parsed.evidence)) {
      return null;
    }
    return parsed as TaskReceipt;
  } catch {
    return null;
  }
}

export function pruneTaskReceipts(db: Db, now = Date.now()): number {
  return db.prepare("DELETE FROM task_receipts WHERE expires_at <= ?").run(now).changes;
}
