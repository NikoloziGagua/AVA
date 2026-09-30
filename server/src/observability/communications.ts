import type { ObservabilityService } from "./store.js";
import type { ObservabilityRun, ObservabilityRunStatus } from "./types.js";

export const COMMUNICATION_RUN_KIND = "agent_communication";

export type CommunicationSource = "codex_watcher" | "provider_discussion";
export type CommunicationRuntime = "codex" | "claude_code";
export type CommunicationResponseAvailability =
  | "pending"
  | "sanitized_recorded"
  | "not_recorded"
  | "unavailable";

export type WatcherCommunicationEvidence =
  | { availability: "available"; runId: string }
  | { availability: "unavailable" };

export type StartCommunicationInput = {
  source: CommunicationSource;
  sourceId: string;
  runtimeType: CommunicationRuntime;
  title: string;
  requestSummary: string;
  sessionId?: string | null;
  parentRunId?: string | null;
  startedAt?: number;
};

export type CommunicationEventInput = {
  phase: string;
  status: string;
  title: string;
  summary?: string | null;
  responseSummary?: string | null;
  responseAvailability?: CommunicationResponseAvailability;
  responseEvidenceProvenance?: "provider_result_boundary" | "exact_thread_terminal_result" | null;
  error?: string | null;
  runStatus?: ObservabilityRunStatus;
  terminal?: boolean;
  verificationStatus?: ObservabilityRun["verificationStatus"];
  outcome?: string | null;
  occurredAt?: number;
  durationMs?: number | null;
  dedupSuffix?: string;
};

const REQUEST_LIMIT = 2_000;
const RESPONSE_LIMIT = 4_000;
const ERROR_LIMIT = 2_000;

function bounded(value: string | null | undefined, limit: number): string | null {
  if (value == null) return null;
  const compact = value.trim();
  if (!compact) return null;
  return compact.length <= limit
    ? compact
    : `${compact.slice(0, limit)}\n[truncated by communication boundary]`;
}

export function communicationRunId(source: CommunicationSource, sourceId: string): string {
  const safe = sourceId.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 160) || "unknown";
  return `communication:${source}:${safe}`;
}

const WATCHER_SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolve the reverse Watches -> Mission Control bridge without interpreting
 * presentation text. The deterministic run ID locates the candidate, while a
 * retained normalized source envelope proves its identity. A compact run with
 * expired detail is deliberately insufficient evidence.
 */
export function resolveWatcherCommunicationEvidence(
  observability: ObservabilityService,
  sourceId: string,
): WatcherCommunicationEvidence {
  if (!WATCHER_SOURCE_ID.test(sourceId)) return { availability: "unavailable" };
  const runId = communicationRunId("codex_watcher", sourceId);
  const run = observability.getRun(runId);
  if (
    !run ||
    run.runKind !== COMMUNICATION_RUN_KIND ||
    run.runtimeType !== "codex" ||
    run.ownerId !== "codex"
  ) {
    return { availability: "unavailable" };
  }

  const identities = observability.getEvents(runId).flatMap((event) => {
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const record = payload as Record<string, unknown>;
    if (typeof record.communicationSource !== "string") return [];
    return [{ source: record.communicationSource, sourceId: record.sourceId }];
  });
  if (
    identities.length === 0 ||
    identities.some((identity) => identity.source !== "codex_watcher" || identity.sourceId !== sourceId)
  ) {
    return { availability: "unavailable" };
  }
  return { availability: "available", runId };
}

/**
 * Provider-neutral recorder for AVA-authorized external communications.
 *
 * The authoritative task/discussion/watch stores continue to own their state;
 * this class only publishes a sanitized, idempotent read model into AVA's
 * existing Mission Control stream. A stable source ID maps to exactly one run.
 */
export class CommunicationObservabilityRecorder {
  constructor(private readonly observability: ObservabilityService | null | undefined) {}

  ensureStarted(input: StartCommunicationInput): ObservabilityRun | null {
    if (!this.observability) return null;
    const runId = communicationRunId(input.source, input.sourceId);
    const existing = this.observability.getRun(runId);
    if (existing) return existing;

    const requestedParent = input.parentRunId
      ? this.observability.getRun(input.parentRunId)
      : null;
    const parentRunId = requestedParent?.id ?? null;
    const request = bounded(input.requestSummary, REQUEST_LIMIT);
    try {
      const run = this.observability.startRun({
        id: runId,
        parentRunId,
        traceId: requestedParent?.traceId,
        rootTaskId: requestedParent?.rootTaskId ?? requestedParent?.id ?? runId,
        sessionId: input.sessionId ?? requestedParent?.sessionId ?? null,
        runKind: COMMUNICATION_RUN_KIND,
        runtimeId: `${input.runtimeType}:communication`,
        runtimeType: input.runtimeType,
        hostRuntimeId: "ava:server",
        ownerType: "agent",
        ownerId: input.runtimeType,
        ownerRole: "external-executor",
        title: input.title,
        objective: request,
        privacyLevel: "source_sensitive",
        staleAfterMs: 10 * 60_000,
        startedAt: input.startedAt,
      });
      this.record(input.source, input.sourceId, {
        phase: "queued",
        status: "queued",
        title: "Communication queued",
        summary: "AVA accepted the communication request and recorded its external execution boundary.",
        responseAvailability: "pending",
        runStatus: "queued",
        occurredAt: input.startedAt,
      });
      return this.observability.getRun(run.id);
    } catch {
      // Observability must never prevent the underlying discussion or watcher.
      return this.observability.getRun(runId);
    }
  }

  record(
    source: CommunicationSource,
    sourceId: string,
    input: CommunicationEventInput,
  ): void {
    if (!this.observability) return;
    const runId = communicationRunId(source, sourceId);
    if (!this.observability.getRun(runId)) return;
    const response = bounded(input.responseSummary, RESPONSE_LIMIT);
    const error = bounded(input.error, ERROR_LIMIT);
    try {
      this.observability.record(runId, {
        producerId: `ava:communication:${source}`,
        producerEventId: `${sourceId}:${input.dedupSuffix ?? input.phase}`,
        type: `communication.${input.phase}`,
        status: input.status,
        title: input.title,
        summary: input.summary ?? null,
        visibility: response || error ? "sensitive_collapsed" : "detail",
        privacyLevel: "source_sensitive",
        payload: {
          communicationSource: source,
          sourceId,
          requestAvailability: "sanitized_recorded",
          responseAvailability: input.responseAvailability ?? (response ? "sanitized_recorded" : "pending"),
          response,
          responseEvidenceProvenance: input.responseEvidenceProvenance ?? null,
          usageAvailability: "not_reported",
          costAvailability: "not_reported",
          providerModelAvailability: "not_reported",
          providerRequestIdAvailability: "not_reported",
          evidenceProvenance: "ava_observed_boundary",
          trustBoundary: {
            from: "ava_orchestrator",
            to: "external_executor",
          },
        },
        error,
        durationMs: input.durationMs ?? null,
        occurredAt: input.occurredAt,
        terminal: input.terminal,
        runStatus: input.runStatus,
        outcome: input.outcome,
        verificationStatus: input.verificationStatus,
        compactSummary: input.terminal ? (response ?? input.summary ?? error) : null,
        dedupKey: `communication:${source}:${sourceId}:${input.dedupSuffix ?? input.phase}`,
      });
    } catch {
      // The communication remains authoritative even if its read model fails.
    }
  }
}
