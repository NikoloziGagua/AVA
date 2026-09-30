import type { TaskReceipt } from "../receipts/task-receipt.js";

export type PlaybookLearningOutcome =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "contradicted"
  | "failed"
  | "not_applicable";

export type PlaybookLearningEvidence = {
  taskId: string;
  method: string | null;
  observedAt: number;
};

/**
 * Translate the terminal, evidence-backed receipt into the only outcome grammar
 * playbooks are allowed to learn from. User stops and approval blocks remain
 * neutral: they do not prove the procedure good or bad.
 */
export function learningOutcomeFromReceipt(receipt: TaskReceipt): PlaybookLearningOutcome {
  if (receipt.lifecycle === "cancelled" || receipt.lifecycle === "blocked" ||
      receipt.lifecycle === "awaiting_approval" || receipt.lifecycle === "running") {
    return "unverified";
  }
  if (receipt.outcome === "verified") {
    return receipt.verificationScope === "task_outcome" ? "verified" : "not_applicable";
  }
  if (receipt.outcome === "partial") return "partially_verified";
  if (receipt.outcome === "contradicted") return "contradicted";
  if (receipt.outcome === "failed") return "failed";
  return "unverified";
}

export function learningEvidenceFromReceipt(receipt: TaskReceipt): PlaybookLearningEvidence {
  return {
    taskId: receipt.taskId,
    method: receipt.verificationMethod ?? null,
    observedAt: receipt.verificationObservedAt ?? receipt.updatedAt,
  };
}
