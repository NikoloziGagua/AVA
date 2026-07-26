import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import {
  sanitiseExplorerText,
  sanitiseExplorerValue,
} from "../explorer/redaction.js";
import {
  COMPACT_RETENTION_MS,
  DETAIL_RETENTION_MS,
  OBSERVABILITY_SCHEMA_VERSION,
  TERMINAL_RUN_STATUSES,
  type ObservabilityEvent,
  type ObservabilityRun,
  type ObservabilityRunStatus,
  type RecordEventInput,
  type RecordEventResult,
  type StartRunInput,
  type StopRequestResult,
} from "./types.js";

type RunRow = {
  id: string;
  trace_id: string;
  parent_run_id: string | null;
  root_task_id: string | null;
  session_id: string | null;
  run_kind: string;
  runtime_id: string;
  runtime_type: string;
  host_runtime_id: string | null;
  owner_type: string;
  owner_id: string | null;
  owner_role: string | null;
  title: string;
  objective: string | null;
  status: ObservabilityRunStatus;
  outcome: string | null;
  verification_status: ObservabilityRun["verificationStatus"];
  privacy_level: ObservabilityRun["privacyLevel"];
  retention_class: string;
  compact_summary: string | null;
  version: number;
  started_at: number;
  updated_at: number;
  last_event_at: number;
  completed_at: number | null;
  stale_after_ms: number;
  detailed_expires_at: number;
  compact_expires_at: number;
  event_count?: number;
  error_count?: number;
  retry_count?: number;
  direct_cost_microusd?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
};

type EventRow = {
  seq: number;
  event_id: string;
  run_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  causation_event_id: string | null;
  producer_id: string;
  producer_event_id: string | null;
  producer_sequence: number | null;
  runtime_id: string;
  runtime_type: string;
  host_runtime_id: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_role: string | null;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  visibility: ObservabilityEvent["visibility"];
  privacy_level: ObservabilityEvent["privacyLevel"];
  sanitised_payload: string | null;
  error_message: string | null;
  action_id: string | null;
  action_owner: ObservabilityEvent["actionOwner"];
  action_counted: number;
  provider_request_id: string | null;
  cost_kind: ObservabilityEvent["costKind"];
  cost_microusd: number | null;
  accounting_applied: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  duration_ms: number | null;
  occurred_at: number;
  received_at: number;
  is_terminal: number;
  is_late: number;
  projection_applied: number;
  dedup_key: string;
};

const RUN_SELECT = `
  SELECT
    r.*,
    COUNT(e.seq) AS event_count,
    COALESCE(SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
    COALESCE(SUM(CASE WHEN e.type LIKE '%.retry%' OR e.status = 'retrying' THEN 1 ELSE 0 END), 0) AS retry_count,
    COALESCE(SUM(CASE WHEN e.accounting_applied = 1 THEN COALESCE(e.cost_microusd, 0) ELSE 0 END), 0)
      AS direct_cost_microusd,
    COALESCE(SUM(CASE WHEN e.accounting_applied = 1 THEN COALESCE(e.input_tokens, 0) ELSE 0 END), 0)
      AS input_tokens,
    COALESCE(SUM(CASE WHEN e.accounting_applied = 1 THEN COALESCE(e.output_tokens, 0) ELSE 0 END), 0)
      AS output_tokens,
    COALESCE(SUM(CASE WHEN e.accounting_applied = 1 THEN COALESCE(e.cached_tokens, 0) ELSE 0 END), 0)
      AS cached_tokens
  FROM observability_runs r
  LEFT JOIN observability_events e ON e.run_id = r.id
`;

function safeText(value: string | null | undefined): string | null {
  return sanitiseExplorerText(value ?? null);
}

function encode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(sanitiseExplorerValue(value));
  } catch {
    return JSON.stringify("[Mission Control could not serialise this value]");
  }
}

function decode(value: string | null): unknown {
  if (value === null) return null;
  try {
    return sanitiseExplorerValue(JSON.parse(value));
  } catch {
    return safeText(value);
  }
}

function runFromRow(row: RunRow, now = Date.now()): ObservabilityRun {
  const terminal = TERMINAL_RUN_STATUSES.has(row.status);
  return {
    id: row.id,
    traceId: row.trace_id,
    parentRunId: row.parent_run_id,
    rootTaskId: row.root_task_id,
    sessionId: row.session_id,
    runKind: row.run_kind,
    runtimeId: row.runtime_id,
    runtimeType: row.runtime_type,
    hostRuntimeId: row.host_runtime_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    ownerRole: row.owner_role,
    title: safeText(row.title) ?? "",
    objective: safeText(row.objective),
    status: row.status,
    outcome: safeText(row.outcome),
    verificationStatus: row.verification_status,
    privacyLevel: row.privacy_level,
    retentionClass: row.retention_class,
    compactSummary: safeText(row.compact_summary),
    version: Number(row.version),
    startedAt: Number(row.started_at),
    updatedAt: Number(row.updated_at),
    lastEventAt: Number(row.last_event_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    staleAfterMs: Number(row.stale_after_ms),
    detailedExpiresAt: Number(row.detailed_expires_at),
    compactExpiresAt: Number(row.compact_expires_at),
    stale: !terminal && now - Number(row.last_event_at) > Number(row.stale_after_ms),
    controlAvailable: false,
    directCostMicrousd: Number(row.direct_cost_microusd ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cachedTokens: Number(row.cached_tokens ?? 0),
    eventCount: Number(row.event_count ?? 0),
    errorCount: Number(row.error_count ?? 0),
    retryCount: Number(row.retry_count ?? 0),
  };
}

function eventFromRow(row: EventRow): ObservabilityEvent {
  return {
    seq: Number(row.seq),
    eventId: row.event_id,
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    runId: row.run_id,
    traceId: row.trace_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    causationEventId: row.causation_event_id,
    producerId: row.producer_id,
    producerEventId: row.producer_event_id,
    producerSequence: row.producer_sequence === null ? null : Number(row.producer_sequence),
    runtimeId: row.runtime_id,
    runtimeType: row.runtime_type,
    hostRuntimeId: row.host_runtime_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    type: row.type,
    status: row.status,
    title: safeText(row.title) ?? "",
    summary: safeText(row.summary),
    visibility: row.visibility,
    privacyLevel: row.privacy_level,
    payload: decode(row.sanitised_payload),
    error: safeText(row.error_message),
    actionId: row.action_id,
    actionOwner: row.action_owner,
    actionCounted: row.action_counted === 1,
    providerRequestId: row.provider_request_id,
    costKind: row.cost_kind,
    costMicrousd: row.cost_microusd === null ? null : Number(row.cost_microusd),
    accountingApplied: row.accounting_applied === 1,
    inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
    cachedTokens: row.cached_tokens === null ? null : Number(row.cached_tokens),
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    occurredAt: Number(row.occurred_at),
    receivedAt: Number(row.received_at),
    terminal: row.is_terminal === 1,
    late: row.is_late === 1,
    projectionApplied: row.projection_applied === 1,
    dedupKey: row.dedup_key,
  };
}

function plainRun(db: Db, runId: string): RunRow | null {
  return (db.prepare(
    "SELECT * FROM observability_runs WHERE id = ?",
  ).get(runId) as RunRow | undefined) ?? null;
}

export class ObservabilityStore {
  constructor(readonly db: Db) {}

  startRun(input: StartRunInput): { run: ObservabilityRun; event: ObservabilityEvent } {
    const at = input.startedAt ?? Date.now();
    const id = input.id ?? `run_${nanoid(12)}`;
    const parent = input.parentRunId ? plainRun(this.db, input.parentRunId) : null;
    if (input.parentRunId && !parent) {
      throw new Error(`observability parent run does not exist: ${input.parentRunId}`);
    }
    // AVA owns correlation. A nested adapter cannot fork the trace identity by
    // supplying a different value while claiming an AVA parent.
    const traceId = parent?.trace_id ?? input.traceId ?? `trace_${nanoid(14)}`;
    const rootTaskId = parent
      ? parent.root_task_id ?? parent.id
      : input.rootTaskId ?? id;
    const sessionId = input.sessionId && this.db.prepare(
      "SELECT 1 FROM sessions WHERE id = ?",
    ).get(input.sessionId)
      ? input.sessionId
      : null;
    const runtimeId = input.runtimeId ?? `${input.runtimeType}:ava`;
    const title = safeText(input.title) ?? "Untitled run";
    const objective = safeText(input.objective);

    return this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO observability_runs (
          id, trace_id, parent_run_id, root_task_id, session_id, run_kind,
          runtime_id, runtime_type, host_runtime_id, owner_type, owner_id,
          owner_role, title, objective, status, outcome, verification_status,
          privacy_level, retention_class, compact_summary, version, started_at,
          updated_at, last_event_at, completed_at, stale_after_ms,
          detailed_expires_at, compact_expires_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL,
          'not_recorded', ?, ?, NULL, 1, ?, ?, ?, NULL, ?, ?, ?
        )
      `).run(
        id,
        traceId,
        input.parentRunId ?? null,
        rootTaskId,
        sessionId,
        input.runKind,
        runtimeId,
        input.runtimeType,
        input.hostRuntimeId ?? null,
        input.ownerType,
        input.ownerId ?? null,
        input.ownerRole ?? null,
        title,
        objective,
        input.privacyLevel ?? "personal",
        input.retentionClass ?? "detail_30d",
        at,
        at,
        at,
        input.staleAfterMs ?? 60_000,
        at + DETAIL_RETENTION_MS,
        at + COMPACT_RETENTION_MS,
      );
      const recorded = this.recordEventInTransaction(id, {
        producerId: runtimeId,
        producerEventId: `run-created:${id}`,
        spanId: id,
        type: "run.created",
        status: "running",
        title: "Run created",
        summary: title,
        payload: {
          runKind: input.runKind,
          parentRunId: input.parentRunId ?? null,
          objective,
        },
        occurredAt: at,
      });
      if (!recorded.event || !recorded.run) throw new Error("failed to create observability run event");
      return { run: recorded.run, event: recorded.event };
    })();
  }

  updateRunContext(
    runId: string,
    input: {
      sessionId?: string | null;
      title?: string;
      objective?: string | null;
      compactSummary?: string | null;
    },
  ): ObservabilityRun | null {
    const current = plainRun(this.db, runId);
    if (!current || TERMINAL_RUN_STATUSES.has(current.status)) return this.getRun(runId);
    const title = input.title === undefined ? current.title : safeText(input.title) ?? current.title;
    const objective = input.objective === undefined ? current.objective : safeText(input.objective);
    const summary = input.compactSummary === undefined
      ? current.compact_summary
      : safeText(input.compactSummary);
    const requestedSessionId = input.sessionId === undefined ? current.session_id : input.sessionId;
    const sessionId = requestedSessionId && this.db.prepare(
      "SELECT 1 FROM sessions WHERE id = ?",
    ).get(requestedSessionId)
      ? requestedSessionId
      : null;
    this.db.prepare(`
      UPDATE observability_runs
      SET session_id = ?, title = ?, objective = ?, compact_summary = ?,
          updated_at = ?, version = version + 1
      WHERE id = ?
    `).run(sessionId, title, objective, summary, Date.now(), runId);
    return this.getRun(runId);
  }

  recordEvent(runId: string, input: RecordEventInput): RecordEventResult {
    return this.db.transaction(() => this.recordEventInTransaction(runId, input))();
  }

  private recordEventInTransaction(runId: string, input: RecordEventInput): RecordEventResult {
    const run = plainRun(this.db, runId);
    if (!run) return { inserted: false, duplicate: false, event: null, run: null };

    const eventId = input.eventId ?? `evt_${nanoid(16)}`;
    const producerId = input.producerId ?? run.runtime_id;
    const producerEventId = input.producerEventId ?? null;
    const dedupKey = input.dedupKey ??
      `${producerId}:${producerEventId ?? eventId}`;
    const occurredAt = input.occurredAt ?? Date.now();
    const receivedAt = Date.now();

    const maxProducer = input.producerSequence === undefined || input.producerSequence === null
      ? null
      : this.db.prepare(`
          SELECT MAX(producer_sequence) AS value
          FROM observability_events
          WHERE run_id = ? AND producer_id = ? AND producer_sequence IS NOT NULL
        `).get(runId, producerId) as { value: number | null };
    const lateByProducer =
      input.producerSequence !== undefined &&
      input.producerSequence !== null &&
      maxProducer?.value !== null &&
      Number(maxProducer?.value) >= input.producerSequence;
    const runAlreadyTerminal = TERMINAL_RUN_STATUSES.has(run.status);
    const late = lateByProducer || runAlreadyTerminal;
    const projectionApplied = !late;

    let actionCounted = 0;
    if (input.actionId && input.actionOwner === "executor" && input.terminal) {
      const existing = this.db.prepare(`
        SELECT 1
        FROM observability_events
        WHERE action_id = ? AND action_counted = 1
        LIMIT 1
      `).get(input.actionId);
      actionCounted = existing ? 0 : 1;
    }

    let accountingApplied = 0;
    if (input.costKind && input.costKind !== "derived_rollup") {
      if (input.costKind === "actual_provider" && input.providerRequestId) {
        const existing = this.db.prepare(`
          SELECT 1
          FROM observability_events
          WHERE provider_request_id = ?
            AND cost_kind = 'actual_provider'
            AND accounting_applied = 1
          LIMIT 1
        `).get(input.providerRequestId);
        accountingApplied = existing ? 0 : 1;
      } else {
        accountingApplied = 1;
      }
    } else if (
      input.inputTokens !== undefined ||
      input.outputTokens !== undefined ||
      input.cachedTokens !== undefined
    ) {
      // Provider usage can be reported before AVA has a price table. Count the
      // tokens exactly once even when monetary cost is unavailable.
      accountingApplied = input.providerRequestId
        ? (this.db.prepare(`
            SELECT 1 FROM observability_events
            WHERE provider_request_id = ? AND accounting_applied = 1 LIMIT 1
          `).get(input.providerRequestId) ? 0 : 1)
        : 1;
    }

    let insertedId: number;
    try {
      const result = this.db.prepare(`
        INSERT INTO observability_events (
          event_id, run_id, trace_id, span_id, parent_span_id,
          causation_event_id, producer_id, producer_event_id,
          producer_sequence, runtime_id, runtime_type, host_runtime_id,
          actor_type, actor_id, actor_role, type, status, title, summary,
          visibility, privacy_level, sanitised_payload, error_message,
          action_id, action_owner, action_counted, provider_request_id,
          cost_kind, cost_microusd, accounting_applied, input_tokens,
          output_tokens, cached_tokens, duration_ms, occurred_at, received_at,
          is_terminal, is_late, projection_applied, dedup_key
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        eventId,
        runId,
        run.trace_id,
        input.spanId ?? `span_${nanoid(14)}`,
        input.parentSpanId ?? null,
        input.causationEventId ?? null,
        producerId,
        producerEventId,
        input.producerSequence ?? null,
        input.runtimeId ?? run.runtime_id,
        input.runtimeType ?? run.runtime_type,
        input.hostRuntimeId ?? run.host_runtime_id,
        input.actorType ?? run.owner_type,
        input.actorId ?? run.owner_id,
        input.actorRole ?? run.owner_role,
        input.type,
        input.status,
        safeText(input.title) ?? "Event",
        safeText(input.summary),
        input.visibility ?? "summary",
        input.privacyLevel ?? run.privacy_level,
        encode(input.payload),
        safeText(input.error),
        input.actionId ?? null,
        input.actionOwner ?? null,
        actionCounted,
        input.providerRequestId ?? null,
        input.costKind ?? null,
        input.costMicrousd ?? null,
        accountingApplied,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.cachedTokens ?? null,
        input.durationMs ?? null,
        occurredAt,
        receivedAt,
        input.terminal ? 1 : 0,
        late ? 1 : 0,
        projectionApplied ? 1 : 0,
        dedupKey,
      );
      insertedId = Number(result.lastInsertRowid);
    } catch (error) {
      let duplicate = this.db.prepare(`
        SELECT * FROM observability_events
        WHERE event_id = ? OR dedup_key = ?
        ORDER BY seq ASC LIMIT 1
      `).get(eventId, dedupKey) as EventRow | undefined;
      if (!duplicate && producerEventId !== null) {
        duplicate = this.db.prepare(`
          SELECT * FROM observability_events
          WHERE producer_id = ? AND producer_event_id = ?
          ORDER BY seq ASC LIMIT 1
        `).get(producerId, producerEventId) as EventRow | undefined;
      }
      if (duplicate) {
        return {
          inserted: false,
          duplicate: true,
          event: eventFromRow(duplicate),
          run: this.getRun(runId),
        };
      }
      throw error;
    }

    if (projectionApplied) {
      const nextStatus = input.runStatus ?? run.status;
      const completedAt = TERMINAL_RUN_STATUSES.has(nextStatus)
        ? occurredAt
        : run.completed_at;
      this.db.prepare(`
        UPDATE observability_runs
        SET status = ?,
            outcome = COALESCE(?, outcome),
            verification_status = COALESCE(?, verification_status),
            compact_summary = COALESCE(?, compact_summary),
            updated_at = ?,
            last_event_at = MAX(last_event_at, ?),
            completed_at = ?,
            version = version + 1
        WHERE id = ?
      `).run(
        nextStatus,
        safeText(input.outcome),
        input.verificationStatus ?? null,
        safeText(input.compactSummary),
        receivedAt,
        occurredAt,
        completedAt,
        runId,
      );
    }

    const row = this.db.prepare(
      "SELECT * FROM observability_events WHERE seq = ?",
    ).get(insertedId) as EventRow;
    return {
      inserted: true,
      duplicate: false,
      event: eventFromRow(row),
      run: this.getRun(runId),
    };
  }

  requestStop(runId: string, expectedVersion: number, at = Date.now()): StopRequestResult {
    return this.db.transaction((): StopRequestResult => {
      const run = plainRun(this.db, runId);
      if (!run) return { ok: false, reason: "not_found", run: null };
      if (run.version !== expectedVersion) {
        return { ok: false, reason: "stale_version", run: this.getRun(runId) };
      }
      if (TERMINAL_RUN_STATUSES.has(run.status) || run.status === "cancelling") {
        return { ok: false, reason: "not_running", run: this.getRun(runId) };
      }
      const recorded = this.recordEventInTransaction(runId, {
        producerId: "ava:mission-control",
        producerEventId: `stop:${runId}:${expectedVersion}`,
        spanId: `control_${nanoid(12)}`,
        type: "control.stop_requested",
        status: "waiting",
        title: "Stop requested",
        summary: "Niko requested that AVA stop this exact run.",
        payload: { expectedVersion, requestedAt: at },
        occurredAt: at,
        runStatus: "cancelling",
      });
      if (!recorded.event || !recorded.run) {
        return { ok: false, reason: "not_found", run: null };
      }
      return { ok: true, run: recorded.run, event: recorded.event };
    })();
  }

  getRun(runId: string, now = Date.now()): ObservabilityRun | null {
    const row = this.db.prepare(
      `${RUN_SELECT} WHERE r.id = ? GROUP BY r.id`,
    ).get(runId) as RunRow | undefined;
    return row ? runFromRow(row, now) : null;
  }

  listRuns(options: { limit?: number; status?: ObservabilityRunStatus } = {}): ObservabilityRun[] {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
    const where = options.status ? "WHERE r.status = ?" : "";
    const sql = `
      ${RUN_SELECT}
      ${where}
      GROUP BY r.id
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT ?
    `;
    const rows = options.status
      ? this.db.prepare(sql).all(options.status, limit)
      : this.db.prepare(sql).all(limit);
    const now = Date.now();
    return (rows as RunRow[]).map((row) => runFromRow(row, now));
  }

  getEvents(runId: string): ObservabilityEvent[] {
    const rows = this.db.prepare(
      "SELECT * FROM observability_events WHERE run_id = ? ORDER BY seq",
    ).all(runId) as EventRow[];
    return rows.map(eventFromRow);
  }

  eventsAfter(after: number, limit = 500): ObservabilityEvent[] {
    const safeLimit = Math.max(1, Math.min(2_000, Math.floor(limit)));
    const rows = this.db.prepare(
      "SELECT * FROM observability_events WHERE seq > ? ORDER BY seq LIMIT ?",
    ).all(Math.max(0, Math.floor(after)), safeLimit) as EventRow[];
    return rows.map(eventFromRow);
  }

  eventBounds(): { min: number | null; max: number | null } {
    const row = this.db.prepare(
      "SELECT MIN(seq) AS min, MAX(seq) AS max FROM observability_events",
    ).get() as { min: number | null; max: number | null };
    return {
      min: row.min === null ? null : Number(row.min),
      max: row.max === null ? null : Number(row.max),
    };
  }

  markOrphanedRuns(at = Date.now()): number {
    const rows = this.db.prepare(`
      SELECT id FROM observability_runs
      WHERE status NOT IN ('completed', 'failed', 'cancelled', 'timed_out', 'orphaned')
    `).all() as Array<{ id: string }>;
    for (const row of rows) {
      this.recordEvent(row.id, {
        producerId: "ava:startup-recovery",
        producerEventId: `orphaned:${row.id}:${at}`,
        type: "run.orphaned",
        status: "error",
        title: "Run orphaned by server restart",
        summary: "AVA restarted before this run recorded a terminal event.",
        error: "The prior runtime ended without a terminal event.",
        occurredAt: at,
        terminal: true,
        runStatus: "orphaned",
        outcome: "interrupted_by_restart",
        verificationStatus: "not_verified",
      });
    }
    return rows.length;
  }

  purgeExpiredDetails(now = Date.now()): {
    compactedRuns: number;
    deletedRuns: number;
    events: number;
  } {
    return this.db.transaction(() => {
      const ids = this.db.prepare(`
        SELECT id FROM observability_runs
        WHERE detailed_expires_at <= ?
          AND status IN ('completed', 'failed', 'cancelled', 'timed_out', 'orphaned')
          AND retention_class != 'compact_outcome_365d'
      `).all(now) as Array<{ id: string }>;
      const del = this.db.prepare(
        "DELETE FROM observability_events WHERE run_id = ?",
      );
      let events = 0;
      const compact = this.db.prepare(`
        UPDATE observability_runs
        SET objective = NULL,
            retention_class = 'compact_outcome_365d',
            updated_at = ?,
            version = version + 1
        WHERE id = ?
      `);
      for (const row of ids) {
        events += del.run(row.id).changes;
        compact.run(now, row.id);
      }
      const deletedRuns = this.db.prepare(`
        DELETE FROM observability_runs
        WHERE compact_expires_at <= ?
          AND status IN ('completed', 'failed', 'cancelled', 'timed_out', 'orphaned')
      `).run(now).changes;
      return {
        compactedRuns: ids.length,
        deletedRuns,
        events,
      };
    })();
  }
}

export type ObservabilityListener = (event: ObservabilityEvent) => void;
export type StopHandler = () => boolean | Promise<boolean>;

/**
 * Store + live broker + scoped controls. The database remains authoritative;
 * listeners are only a low-latency notification path and can always catch up by
 * global event sequence.
 */
export class ObservabilityService {
  readonly store: ObservabilityStore;
  private listeners = new Set<ObservabilityListener>();
  private stopHandlers = new Map<string, StopHandler>();

  constructor(db: Db) {
    this.store = new ObservabilityStore(db);
  }

  startRun(input: StartRunInput): ObservabilityRun {
    const { run, event } = this.store.startRun(input);
    this.publish(event);
    return this.withControl(run);
  }

  record(runId: string, input: RecordEventInput): RecordEventResult {
    const result = this.store.recordEvent(runId, input);
    if (result.inserted && result.event) this.publish(result.event);
    if (result.run) result.run = this.withControl(result.run);
    return result;
  }

  updateRunContext(
    runId: string,
    input: Parameters<ObservabilityStore["updateRunContext"]>[1],
  ): ObservabilityRun | null {
    const run = this.store.updateRunContext(runId, input);
    return run ? this.withControl(run) : null;
  }

  getRun(runId: string): ObservabilityRun | null {
    const run = this.store.getRun(runId);
    return run ? this.withControl(run) : null;
  }

  listRuns(options?: Parameters<ObservabilityStore["listRuns"]>[0]): ObservabilityRun[] {
    return this.store.listRuns(options).map((run) => this.withControl(run));
  }

  getEvents(runId: string): ObservabilityEvent[] {
    return this.store.getEvents(runId);
  }

  eventsAfter(after: number, limit?: number): ObservabilityEvent[] {
    return this.store.eventsAfter(after, limit);
  }

  subscribe(listener: ObservabilityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerStopHandler(runId: string, handler: StopHandler): () => void {
    this.stopHandlers.set(runId, handler);
    return () => {
      if (this.stopHandlers.get(runId) === handler) this.stopHandlers.delete(runId);
    };
  }

  async requestStop(runId: string, expectedVersion: number): Promise<StopRequestResult> {
    const handler = this.stopHandlers.get(runId);
    const current = this.getRun(runId);
    if (!handler) {
      return {
        ok: false,
        reason: current ? "not_running" : "not_found",
        run: current,
      };
    }
    const requested = this.store.requestStop(runId, expectedVersion);
    if (!requested.ok) return requested;
    this.publish(requested.event);
    let accepted = false;
    let stopError: string | null = null;
    try {
      accepted = await handler();
    } catch (error) {
      stopError = error instanceof Error ? error.message : String(error);
    }
    if (!accepted) {
      this.record(runId, {
        producerId: "ava:mission-control",
        type: "control.stop_failed",
        status: "error",
        title: "Stop could not reach the active owner",
        error: stopError ?? "The run changed ownership or ended before the stop signal arrived.",
        // requestStop temporarily projects `cancelling`. Restore the state this
        // exact version had when its owner declined/failed the signal so the
        // UI never strands a still-running operation as permanently stopping.
        runStatus: current?.status,
      });
      return {
        ok: false,
        reason: "not_running",
        run: this.getRun(runId),
      };
    }
    const latest = this.getRun(runId);
    return latest
      ? { ok: true, run: latest, event: requested.event }
      : requested;
  }

  private withControl(run: ObservabilityRun): ObservabilityRun {
    return {
      ...run,
      controlAvailable:
        this.stopHandlers.has(run.id) &&
        !TERMINAL_RUN_STATUSES.has(run.status) &&
        run.status !== "cancelling",
    };
  }

  private publish(event: ObservabilityEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Observability consumers must never break the task being observed.
      }
    }
  }
}
