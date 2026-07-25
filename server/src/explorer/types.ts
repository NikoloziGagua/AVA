export type ExplorerTaskStatus =
  | "running"
  | "finished"
  /** Legacy value from the first instrumentation draft. */
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ExplorerTaskOutcome =
  | "running"
  | "finished_unverified"
  | "finished_with_errors_unverified"
  /** Legacy value from the first instrumentation draft. */
  | "completed_without_verification"
  | "failed_safely"
  | "cancelled_by_user"
  | "interrupted"
  | "ended_without_result";

export type ExplorerEvidence = {
  source: "instrumented_runtime";
  label: "observed";
};

export type ExplorerEventEvidence = {
  source: "instrumented_runtime";
  proves: string;
  verification: "not_independently_verified";
};

export type ExplorerEventStatus =
  | "running"
  | "success"
  | "error"
  | "waiting"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export type ExplorerEvent = {
  id: number;
  taskId: string;
  sequence: number;
  type: string;
  title: string;
  status: ExplorerEventStatus;
  occurredAt: number;
  durationMs: number | null;
  toolName: string | null;
  capabilityIds: string[];
  input: unknown;
  output: unknown;
  error: string | null;
  privacyLevel: "personal";
  evidence: ExplorerEventEvidence;
};

export type ExplorerTaskSummary = {
  id: string;
  sessionId: string | null;
  sessionTitle: string | null;
  status: ExplorerTaskStatus;
  outcome: ExplorerTaskOutcome;
  mode: "conversation" | "action";
  verification: {
    status: "not_recorded";
    reason: string;
  };
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  capabilityIds: string[];
  evidence: ExplorerEvidence;
};

export type ExplorerTaskDetail = ExplorerTaskSummary & {
  originalRequest: string;
  finalResponse: string | null;
  error: string | null;
  events: ExplorerEvent[];
};

export type ExplorerCoverage = {
  source: "instrumented_runtime";
  historicalBackfill: false;
  note: string;
};

export const EXPLORER_COVERAGE: ExplorerCoverage = {
  source: "instrumented_runtime",
  historicalBackfill: false,
  note:
    "Only chat-agent lifecycle and tool events recorded after Explorer instrumentation was enabled are shown. " +
    "Legacy conversations, direct realtime voice turns, session persistence, memory side effects, and detached subsystem internals are not reconstructed as complete traces.",
};
