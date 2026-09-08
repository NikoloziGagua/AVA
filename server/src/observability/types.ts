export const OBSERVABILITY_SCHEMA_VERSION = 1;
export const DETAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const COMPACT_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

export type ObservabilityRunStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_for_agent"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "retrying"
  | "verifying"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "stale"
  | "orphaned";

export const TERMINAL_RUN_STATUSES = new Set<ObservabilityRunStatus>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "orphaned",
]);

export type ObservabilityVerificationStatus =
  | "verified"
  | "partially_verified"
  | "not_verified"
  | "not_recorded";

export type ObservabilityPrivacyLevel =
  | "normal"
  | "personal"
  | "source_sensitive"
  | "credential_sensitive"
  | "secret_redacted"
  | "system_only";

export type ObservabilityVisibility =
  | "summary"
  | "detail"
  | "sensitive_collapsed"
  | "system_only";

export type RuntimeType =
  | "ava"
  | "forge"
  | "codex"
  | "claude_code"
  | "external_adapter";

/**
 * Canonical role families are useful for filters and visual grouping. `role`
 * itself remains an arbitrary string so Forge/Codex can add stations without an
 * AVA release or falsely map a specialist to the wrong job.
 */
export type AgentRoleFamily =
  | "orchestration"
  | "analysis"
  | "specification"
  | "architecture"
  | "implementation"
  | "testing"
  | "review"
  | "safety"
  | "verification"
  | "documentation"
  | "integration"
  | "release"
  | "general";

export type ObservabilityRun = {
  id: string;
  traceId: string;
  parentRunId: string | null;
  rootTaskId: string | null;
  sessionId: string | null;
  runKind: string;
  runtimeId: string;
  runtimeType: RuntimeType | string;
  hostRuntimeId: string | null;
  ownerType: "ava" | "agent" | "forge" | "human" | "system" | string;
  ownerId: string | null;
  ownerRole: string | null;
  title: string;
  objective: string | null;
  status: ObservabilityRunStatus;
  outcome: string | null;
  verificationStatus: ObservabilityVerificationStatus;
  privacyLevel: ObservabilityPrivacyLevel;
  retentionClass: string;
  compactSummary: string | null;
  version: number;
  startedAt: number;
  updatedAt: number;
  lastEventAt: number;
  completedAt: number | null;
  staleAfterMs: number;
  detailedExpiresAt: number;
  compactExpiresAt: number;
  stale: boolean;
  controlAvailable: boolean;
  directCostMicrousd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  eventCount: number;
  errorCount: number;
  retryCount: number;
};

export type ObservabilityEvent = {
  seq: number;
  eventId: string;
  schemaVersion: number;
  runId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  causationEventId: string | null;
  producerId: string;
  producerEventId: string | null;
  producerSequence: number | null;
  runtimeId: string;
  runtimeType: RuntimeType | string;
  hostRuntimeId: string | null;
  actorType: string;
  actorId: string | null;
  actorRole: string | null;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  visibility: ObservabilityVisibility;
  privacyLevel: ObservabilityPrivacyLevel;
  payload: unknown;
  error: string | null;
  actionId: string | null;
  actionOwner: "executor" | "observer" | "router" | null;
  actionCounted: boolean;
  providerRequestId: string | null;
  costKind: "actual_provider" | "infrastructure_estimate" | "derived_rollup" | null;
  costMicrousd: number | null;
  accountingApplied: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  durationMs: number | null;
  occurredAt: number;
  receivedAt: number;
  terminal: boolean;
  late: boolean;
  projectionApplied: boolean;
  dedupKey: string;
};

export type StartRunInput = {
  id?: string;
  traceId?: string;
  parentRunId?: string | null;
  rootTaskId?: string | null;
  sessionId?: string | null;
  runKind: string;
  runtimeId?: string;
  runtimeType: RuntimeType | string;
  hostRuntimeId?: string | null;
  ownerType: ObservabilityRun["ownerType"];
  ownerId?: string | null;
  ownerRole?: string | null;
  title: string;
  objective?: string | null;
  privacyLevel?: ObservabilityPrivacyLevel;
  retentionClass?: string;
  staleAfterMs?: number;
  startedAt?: number;
};

export type RecordEventInput = {
  eventId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  causationEventId?: string | null;
  producerId?: string;
  producerEventId?: string | null;
  producerSequence?: number | null;
  runtimeId?: string;
  runtimeType?: RuntimeType | string;
  hostRuntimeId?: string | null;
  actorType?: string;
  actorId?: string | null;
  actorRole?: string | null;
  type: string;
  status: string;
  title: string;
  summary?: string | null;
  visibility?: ObservabilityVisibility;
  privacyLevel?: ObservabilityPrivacyLevel;
  payload?: unknown;
  error?: string | null;
  actionId?: string | null;
  actionOwner?: "executor" | "observer" | "router" | null;
  providerRequestId?: string | null;
  costKind?: ObservabilityEvent["costKind"];
  costMicrousd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedTokens?: number | null;
  durationMs?: number | null;
  occurredAt?: number;
  terminal?: boolean;
  runStatus?: ObservabilityRunStatus;
  outcome?: string | null;
  verificationStatus?: ObservabilityVerificationStatus;
  compactSummary?: string | null;
  dedupKey?: string;
};

export type ObservabilityParentContext = {
  traceId: string;
  parentRunId: string;
  parentSpanId?: string | null;
  causationEventId?: string | null;
};

export type RecordEventResult = {
  inserted: boolean;
  duplicate: boolean;
  event: ObservabilityEvent | null;
  run: ObservabilityRun | null;
};

export type StopRequestResult =
  | { ok: true; run: ObservabilityRun; event: ObservabilityEvent }
  | { ok: false; reason: "not_found" | "stale_version" | "not_running"; run: ObservabilityRun | null };
