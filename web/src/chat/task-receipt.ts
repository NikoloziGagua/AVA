export type TaskReceiptLifecycle =
  | "running"
  | "awaiting_approval"
  | "finished"
  | "blocked"
  | "cancelled"
  | "failed";

export type TaskReceiptOutcome = "verified" | "partial" | "unverified" | "failed";
export type TaskReceiptRootCause = "known" | "likely" | "unknown" | "not_applicable";

export type TaskReceiptEvidence = {
  kind: "request" | "approval" | "tool_result" | "response" | "runtime";
  label: string;
  detail: string;
  strength: "verified" | "observed" | "reported";
};

export type TaskReceipt = {
  schemaVersion: 1;
  taskId: string;
  expected: string;
  actual: string;
  lifecycle: TaskReceiptLifecycle;
  outcome: TaskReceiptOutcome;
  verificationScope: "response_delivery" | "operational_steps" | "none";
  lastVerifiedStage: string;
  observationPoint: string | null;
  rootCause: TaskReceiptRootCause;
  recoveryAction: string | null;
  evidence: TaskReceiptEvidence[];
  toolCalls: number;
  successfulToolResults: number;
  uncertainToolResults: number;
  failedToolResults: number;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
};

export const RECEIPT_OUTCOME_LABEL: Record<TaskReceiptOutcome, string> = {
  verified: "Verified",
  partial: "Partial",
  unverified: "Unverified",
  failed: "Failed",
};

export const RECEIPT_LIFECYCLE_LABEL: Record<TaskReceiptLifecycle, string> = {
  running: "In progress",
  awaiting_approval: "Awaiting approval",
  finished: "Attempt finished",
  blocked: "Blocked",
  cancelled: "Stopped",
  failed: "Run failed",
};
