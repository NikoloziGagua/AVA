import { sanitiseExplorerValue } from "../explorer/redaction.js";
import {
  COMPACT_RETENTION_MS,
  DETAIL_RETENTION_MS,
  OBSERVABILITY_SCHEMA_VERSION,
  TERMINAL_RUN_STATUSES,
  type ObservabilityEvent,
  type ObservabilityRun,
} from "./types.js";
import {
  type ObservabilityExportScope,
  type ObservabilityStore,
} from "./store.js";

export const MISSION_CONTROL_EXPORT_SCHEMA_VERSION = 1;
export const MISSION_CONTROL_EXPORT_MAX_ROWS = 1_000;
export const MISSION_CONTROL_EXPORT_MAX_BYTES = 1_000_000;
export const MISSION_CONTROL_EXPORT_MAX_TIME_RANGE_MS = DETAIL_RETENTION_MS;

export type MissionControlExportDocument = {
  service: "ava-mission-control";
  format: "json";
  apiVersion: number;
  exportSchemaVersion: number;
  observabilitySchemaVersion: number;
  generatedAt: number;
  scope: {
    type: ObservabilityExportScope;
    anchorRunId: string;
    traceId: string;
  };
  snapshot: {
    highWaterEventSeq: number;
    oldestRetainedEventSeq: number | null;
    newestRetainedEventSeq: number | null;
    rule: "events_at_or_before_high_water";
  };
  appliedFilters: {
    format: "json";
    content: "operational_summaries_and_bounded_detail";
    throughEventSeq: number;
  };
  bounds: {
    maxRows: number;
    maxBytes: number;
    maxTimeRangeMs: number;
    rows: { runs: number; events: number; total: number };
    timeRangeMs: number;
  };
  completeness: {
    evidence: "complete_at_snapshot" | "partial_due_to_retention";
    partial: boolean;
    truncated: false;
    reasons: string[];
    activeRunIdsAtSnapshot: string[];
  };
  retention: {
    detailedDays: 30;
    compactDays: 365;
    detailedCutoffAt: number;
    compactCutoffAt: number;
  };
  redaction: {
    reappliedAtExport: true;
    policy: "ava_operational_sanitizer_v1";
    notice: string;
    collapsedContent: string;
  };
  runs: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

export type MissionControlExportBuildResult =
  | { status: "not_found" }
  | {
      status: "too_many_rows";
      runCount: number;
      eventCount: number;
      totalRows: number;
    }
  | { status: "time_range_exceeded"; timeRangeMs: number }
  | { status: "ok"; document: MissionControlExportDocument };

const PROHIBITED_EXPORT_FIELD = /^(?:audio|rawAudio|raw_audio|audioBytes|audio_bytes|responseAudio|response_audio|screenshot|screenshotData|screenshot_data|rawProviderPayload|raw_provider_payload|providerPayload|provider_payload|chainOfThought|chain_of_thought|hiddenReasoning|hidden_reasoning|reasoningContent|reasoning_content)$/i;

function removeProhibitedExportContent(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular export value omitted]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => removeProhibitedExportContent(item, seen));
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = PROHIBITED_EXPORT_FIELD.test(key)
      ? "[excluded from Mission Control export]"
      : removeProhibitedExportContent(child, seen);
  }
  return output;
}

function exportRun(run: ObservabilityRun): Record<string, unknown> {
  return {
    id: run.id,
    traceId: run.traceId,
    parentRunId: run.parentRunId,
    rootTaskId: run.rootTaskId,
    runKind: run.runKind,
    runtimeId: run.runtimeId,
    runtimeType: run.runtimeType,
    hostRuntimeId: run.hostRuntimeId,
    ownerType: run.ownerType,
    ownerId: run.ownerId,
    ownerRole: run.ownerRole,
    title: run.title,
    objective: {
      availableInRetainedRecord: run.objective !== null,
      disclosure: run.objective === null
        ? "not_retained_or_not_recorded"
        : "collapsed_not_included_in_default_export",
    },
    status: run.status,
    outcome: run.outcome,
    verificationStatus: run.verificationStatus,
    privacyLevel: run.privacyLevel,
    retentionClass: run.retentionClass,
    compactSummary: run.compactSummary,
    version: run.version,
    startedAt: run.startedAt,
    lastEventAt: run.lastEventAt,
    completedAt: run.completedAt,
    detailedExpiresAt: run.detailedExpiresAt,
    compactExpiresAt: run.compactExpiresAt,
    directCostMicrousd: run.directCostMicrousd,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    cachedTokens: run.cachedTokens,
    eventCount: run.eventCount,
    errorCount: run.errorCount,
    retryCount: run.retryCount,
  };
}

function exportEvent(event: ObservabilityEvent): Record<string, unknown> {
  const includePayload = event.visibility === "detail";
  return {
    seq: event.seq,
    eventId: event.eventId,
    schemaVersion: event.schemaVersion,
    runId: event.runId,
    traceId: event.traceId,
    spanId: event.spanId,
    parentSpanId: event.parentSpanId,
    causationEventId: event.causationEventId,
    producer: {
      id: event.producerId,
      eventId: event.producerEventId,
      sequence: event.producerSequence,
    },
    runtime: {
      id: event.runtimeId,
      type: event.runtimeType,
      hostId: event.hostRuntimeId,
    },
    actor: {
      type: event.actorType,
      id: event.actorId,
      role: event.actorRole,
    },
    type: event.type,
    status: event.status,
    title: event.title,
    summary: event.summary,
    visibility: event.visibility,
    privacyLevel: event.privacyLevel,
    evidence: {
      payload: includePayload ? event.payload : null,
      payloadDisclosure: event.payload == null
        ? "none_recorded"
        : includePayload
          ? "sanitized_bounded_detail"
          : "collapsed_not_included_in_default_export",
      error: event.error,
    },
    action: {
      id: event.actionId,
      owner: event.actionOwner,
      counted: event.actionCounted,
    },
    providerRequestId: event.providerRequestId,
    accounting: {
      costKind: event.costKind,
      costMicrousd: event.costMicrousd,
      applied: event.accountingApplied,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cachedTokens: event.cachedTokens,
    },
    durationMs: event.durationMs,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    terminal: event.terminal,
    late: event.late,
    projectionApplied: event.projectionApplied,
  };
}

/**
 * Build a privacy-minimised immutable evidence package from one durable SQLite
 * snapshot. The final whole-document sanitization is intentional: storage read
 * paths already sanitize, and export repeats that boundary independently.
 */
export function buildMissionControlExport(input: {
  store: ObservabilityStore;
  anchorRunId: string;
  scope: ObservabilityExportScope;
  apiVersion: number;
  generatedAt?: number;
}): MissionControlExportBuildResult {
  const generatedAt = input.generatedAt ?? Date.now();
  const selection = input.store.selectExportSnapshot(
    input.anchorRunId,
    input.scope,
    MISSION_CONTROL_EXPORT_MAX_ROWS,
  );
  if (selection.status !== "ok") return selection;

  const { snapshot } = selection;
  const firstAt = Math.min(...snapshot.runs.map((run) => run.startedAt));
  const lastAt = Math.max(
    ...snapshot.runs.map((run) => run.completedAt ?? run.lastEventAt),
  );
  const timeRangeMs = Math.max(0, lastAt - firstAt);
  if (timeRangeMs > MISSION_CONTROL_EXPORT_MAX_TIME_RANGE_MS) {
    return { status: "time_range_exceeded", timeRangeMs };
  }

  const compactedRunIds = snapshot.runs
    .filter((run) => run.retentionClass === "compact_outcome_365d")
    .map((run) => run.id);
  const partial = compactedRunIds.length > 0;
  const activeRunIdsAtSnapshot = snapshot.runs
    .filter((run) => !TERMINAL_RUN_STATUSES.has(run.status))
    .map((run) => run.id);
  const document: MissionControlExportDocument = {
    service: "ava-mission-control",
    format: "json",
    apiVersion: input.apiVersion,
    exportSchemaVersion: MISSION_CONTROL_EXPORT_SCHEMA_VERSION,
    observabilitySchemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    generatedAt,
    scope: {
      type: input.scope,
      anchorRunId: snapshot.anchorRun.id,
      traceId: snapshot.anchorRun.traceId,
    },
    snapshot: {
      highWaterEventSeq: snapshot.highWaterSeq,
      oldestRetainedEventSeq: snapshot.retainedEventBounds.min,
      newestRetainedEventSeq: snapshot.retainedEventBounds.max,
      rule: "events_at_or_before_high_water",
    },
    appliedFilters: {
      format: "json",
      content: "operational_summaries_and_bounded_detail",
      throughEventSeq: snapshot.highWaterSeq,
    },
    bounds: {
      maxRows: MISSION_CONTROL_EXPORT_MAX_ROWS,
      maxBytes: MISSION_CONTROL_EXPORT_MAX_BYTES,
      maxTimeRangeMs: MISSION_CONTROL_EXPORT_MAX_TIME_RANGE_MS,
      rows: {
        runs: snapshot.runs.length,
        events: snapshot.events.length,
        total: snapshot.totalRows,
      },
      timeRangeMs,
    },
    completeness: {
      evidence: partial ? "partial_due_to_retention" : "complete_at_snapshot",
      partial,
      truncated: false,
      reasons: partial
        ? [`Detailed events were already compacted for ${compactedRunIds.length} run(s).`]
        : [],
      activeRunIdsAtSnapshot,
    },
    retention: {
      detailedDays: 30,
      compactDays: 365,
      detailedCutoffAt: generatedAt - DETAIL_RETENTION_MS,
      compactCutoffAt: generatedAt - COMPACT_RETENTION_MS,
    },
    redaction: {
      reappliedAtExport: true,
      policy: "ava_operational_sanitizer_v1",
      notice: "AVA re-sanitized this export. Secrets, raw provider payloads, raw audio, screenshots, hidden reasoning and authorization material are excluded.",
      collapsedContent: "Objectives and non-detail payload bodies are represented by availability references, not copied into the default export.",
    },
    runs: snapshot.runs.map(exportRun),
    events: snapshot.events.map(exportEvent),
  };

  return {
    status: "ok",
    document: sanitiseExplorerValue(
      removeProhibitedExportContent(document),
    ) as MissionControlExportDocument,
  };
}
