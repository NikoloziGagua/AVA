import { describe, expect, it } from "vitest";
import { createSession } from "./sessions.js";
import { openInMemoryDb } from "./db.js";
import { getTaskReceipt, pruneTaskReceipts, saveTaskReceipt, TASK_RECEIPT_RETENTION_MS } from "./task-receipts.js";
import type { TaskReceipt } from "../receipts/task-receipt.js";

function receipt(taskId: string): TaskReceipt {
  return {
    schemaVersion: 1,
    taskId,
    expected: "Read the report",
    actual: "The report was read.",
    lifecycle: "finished",
    outcome: "verified",
    verificationScope: "response_delivery",
    lastVerifiedStage: "The final response reached this conversation.",
    observationPoint: null,
    rootCause: "not_applicable",
    recoveryAction: null,
    evidence: [],
    toolCalls: 0,
    successfulToolResults: 0,
    uncertainToolResults: 0,
    failedToolResults: 0,
    startedAt: 1,
    updatedAt: 2,
    durationMs: 1,
  };
}

describe("durable task receipts", () => {
  it("replays the newest sanitized snapshot by session or exact task", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "receipt" });
    saveTaskReceipt(db, session.id, receipt("task-1"), 100);
    saveTaskReceipt(db, session.id, receipt("task-2"), 200);

    expect(getTaskReceipt(db, { sessionId: session.id, now: 300 })?.taskId).toBe("task-2");
    expect(getTaskReceipt(db, { sessionId: session.id, taskId: "task-1", now: 300 })?.taskId).toBe("task-1");
  });

  it("expires and prunes detailed receipt snapshots after 30 days", () => {
    const db = openInMemoryDb();
    const session = createSession(db, { title: "receipt" });
    saveTaskReceipt(db, session.id, receipt("task-expired"), 100);

    const expiredAt = 100 + TASK_RECEIPT_RETENTION_MS;
    expect(getTaskReceipt(db, { sessionId: session.id, now: expiredAt })).toBeNull();
    expect(pruneTaskReceipts(db, expiredAt)).toBe(1);
  });
});
