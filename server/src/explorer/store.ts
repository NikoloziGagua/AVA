import type { Db } from "../state/db.js";
import type { AgentEvent } from "../orchestrator/agent.js";
import { capabilityIdsForTool } from "./registry.js";
import {
  EXPLORER_COVERAGE,
  type ExplorerEvent,
  type ExplorerEventStatus,
  type ExplorerTaskDetail,
  type ExplorerTaskOutcome,
  type ExplorerTaskStatus,
  type ExplorerTaskSummary,
} from "./types.js";
import { sanitiseExplorerText, sanitiseExplorerValue } from "./redaction.js";

type TaskRow = {
  id: string;
  session_id: string | null;
  session_title: string | null;
  original_request: string;
  mode: "conversation" | "action";
  status: ExplorerTaskStatus;
  outcome: ExplorerTaskOutcome;
  verification_status: "not_recorded";
  final_response: string | null;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
  event_count: number;
  tool_call_count: number;
  error_count: number;
  capability_json: string | null;
};

type EventRow = {
  id: number;
  task_id: string;
  sequence: number;
  type: string;
  title: string;
  status: ExplorerEventStatus;
  tool_name: string | null;
  capability_ids: string;
  sanitised_input: string | null;
  sanitised_output: string | null;
  error_message: string | null;
  duration_ms: number | null;
  occurred_at: number;
  privacy_level: "personal";
  data_source: "instrumented_runtime";
};

export type RecordExplorerEventOptions = {
  at?: number;
  durationMs?: number | null;
};

const TASK_SELECT = `
  SELECT
    t.*,
    s.title AS session_title,
    COUNT(e.id) AS event_count,
    COALESCE(SUM(CASE WHEN e.type = 'tool_call_started' THEN 1 ELSE 0 END), 0) AS tool_call_count,
    COALESCE(SUM(CASE WHEN e.status = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
    GROUP_CONCAT(e.capability_ids, char(10)) AS capability_json
  FROM explorer_tasks t
  LEFT JOIN sessions s ON s.id = t.session_id
  LEFT JOIN explorer_events e ON e.task_id = t.id
`;

function encode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(sanitiseExplorerValue(value));
  } catch {
    return JSON.stringify("[Explorer could not serialise this value]");
  }
}

function decode(value: string | null): unknown {
  if (value === null) return null;
  try {
    return sanitiseExplorerValue(JSON.parse(value));
  } catch {
    return sanitiseExplorerText(value);
  }
}

function parseCapabilityIds(value: string | null): string[] {
  if (!value) return [];
  const ids = new Set<string>();
  for (const line of value.split("\n")) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (Array.isArray(parsed)) {
        for (const id of parsed) if (typeof id === "string") ids.add(id);
      }
    } catch {
      // A corrupt aggregate should not hide the rest of the task.
    }
  }
  return [...ids];
}

function taskSummary(row: TaskRow): ExplorerTaskSummary {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionTitle: sanitiseExplorerText(row.session_title),
    status: row.status,
    outcome: row.outcome,
    mode: row.mode,
    verification: {
      status: "not_recorded",
      reason:
        "This runtime does not yet emit structured verification events. " +
        "A successful tool result or AVA response is not treated as independent proof.",
    },
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs:
      row.completed_at === null
        ? null
        : Math.max(0, row.completed_at - row.started_at),
    eventCount: Number(row.event_count),
    toolCallCount: Number(row.tool_call_count),
    errorCount: Number(row.error_count),
    capabilityIds: parseCapabilityIds(row.capability_json),
    evidence: { source: "instrumented_runtime", label: "observed" },
  };
}

function eventEvidence(type: string): string {
  switch (type) {
    case "tool_call_started":
      return "AVA requested this tool operation";
    case "tool_call_completed":
      return "the tool returned this recorded result";
    case "approval_required":
    case "approval_resolved":
      return "this approval state was emitted by the policy runtime";
    case "final_response":
      return "AVA generated this final response";
    case "task_finished":
    case "task_completed":
      return "the runtime reached its terminal done event; this does not prove the objective succeeded";
    case "error":
      return "the runtime emitted this error";
    case "task_cancelled":
      return "the runtime recorded cancellation";
    case "task_interrupted":
      return "startup recovery found a run without a terminal event";
    default:
      return "this runtime event occurred";
  }
}

function eventFromRow(row: EventRow): ExplorerEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    sequence: row.sequence,
    type: row.type,
    title: row.title,
    status: row.status,
    occurredAt: row.occurred_at,
    durationMs: row.duration_ms,
    toolName: row.tool_name,
    capabilityIds: parseCapabilityIds(row.capability_ids),
    input: decode(row.sanitised_input),
    output: decode(row.sanitised_output),
    error: sanitiseExplorerText(row.error_message),
    privacyLevel: "personal",
    evidence: {
      source: "instrumented_runtime",
      proves: eventEvidence(row.type),
      verification: "not_independently_verified",
    },
  };
}

function nextSequence(db: Db, taskId: string): number {
  const row = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM explorer_events WHERE task_id = ?",
  ).get(taskId) as { sequence: number };
  return Number(row.sequence);
}

type AppendEvent = {
  type: string;
  title: string;
  status: ExplorerEventStatus;
  toolName?: string | null;
  capabilityIds?: string[];
  input?: unknown;
  output?: unknown;
  error?: string | null;
  durationMs?: number | null;
  at: number;
};

function appendEvent(db: Db, taskId: string, event: AppendEvent): number {
  const result = db.prepare(`
    INSERT INTO explorer_events (
      task_id, sequence, type, title, status, tool_name, capability_ids,
      sanitised_input, sanitised_output, error_message, duration_ms,
      occurred_at, privacy_level, data_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'personal', 'instrumented_runtime')
  `).run(
    taskId,
    nextSequence(db, taskId),
    event.type,
    event.title,
    event.status,
    event.toolName ?? null,
    JSON.stringify(event.capabilityIds ?? []),
    encode(event.input),
    encode(event.output),
    sanitiseExplorerText(event.error ?? null),
    event.durationMs ?? null,
    event.at,
  );
  return Number(result.lastInsertRowid);
}

export function createExplorerTask(
  db: Db,
  input: {
    id: string;
    sessionId: string;
    originalRequest: string;
    mode: "conversation" | "action";
    startedAt?: number;
  },
): void {
  const startedAt = input.startedAt ?? Date.now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO explorer_tasks (
        id, session_id, original_request, mode, status, outcome,
        verification_status, started_at
      ) VALUES (?, ?, ?, ?, 'running', 'running', 'not_recorded', ?)
    `).run(
      input.id,
      input.sessionId,
      sanitiseExplorerText(input.originalRequest) ?? "",
      input.mode,
      startedAt,
    );
    appendEvent(db, input.id, {
      type: "task_created",
      title: "Task created",
      status: "running",
      capabilityIds: ["conversation.text-turn"],
      input: { request: input.originalRequest, mode: input.mode },
      at: startedAt,
    });
  })();
}

/**
 * Persist only operational events. Raw model deltas and "thought" events are
 * intentionally excluded: they are neither durable operational evidence nor a
 * supported way to expose hidden reasoning.
 */
export function recordExplorerAgentEvent(
  db: Db,
  taskId: string,
  event: AgentEvent,
  options: RecordExplorerEventOptions = {},
): number | null {
  if (event.kind === "thought" || event.kind === "delta") return null;
  const at = options.at ?? Date.now();
  const durationMs = options.durationMs ?? null;

  return db.transaction(() => {
    switch (event.kind) {
      case "tool_call":
        return appendEvent(db, taskId, {
          type: "tool_call_started",
          title: `Started ${event.payload.tool}`,
          status: "running",
          toolName: event.payload.tool,
          capabilityIds: capabilityIdsForTool(event.payload.tool),
          input: event.payload.args,
          at,
        });
      case "tool_result": {
        const id = appendEvent(db, taskId, {
          type: "tool_call_completed",
          title: `${event.payload.tool} ${event.payload.ok ? "completed" : "failed"}`,
          status: event.payload.ok ? "success" : "error",
          toolName: event.payload.tool,
          capabilityIds: capabilityIdsForTool(event.payload.tool),
          output: event.payload.result,
          error: event.payload.ok ? null : event.payload.result,
          durationMs,
          at,
        });
        return id;
      }
      case "approval_required":
        // Do not copy approval args into Explorer. Even a key-based scrubber
        // cannot know every secret field a future tool might introduce.
        return appendEvent(db, taskId, {
          type: "approval_required",
          title: `Approval required for ${event.payload.tool}`,
          status: "waiting",
          toolName: event.payload.tool,
          capabilityIds: capabilityIdsForTool(event.payload.tool),
          input: {
            approvalId: event.payload.id,
            tool: event.payload.tool,
            summary: event.payload.summary,
          },
          at,
        });
      case "approval_resolved":
        return appendEvent(db, taskId, {
          type: "approval_resolved",
          title: `Approval ${event.payload.status}`,
          status: event.payload.status,
          input: { approvalId: event.payload.id },
          at,
        });
      case "final": {
        const priorErrors = db.prepare(`
          SELECT COUNT(*) AS count
          FROM explorer_events
          WHERE task_id = ? AND status = 'error'
        `).get(taskId) as { count: number };
        const outcome: ExplorerTaskOutcome =
          Number(priorErrors.count) > 0
            ? "finished_with_errors_unverified"
            : "finished_unverified";
        const id = appendEvent(db, taskId, {
          type: "final_response",
          title: "Final response generated",
          status: "success",
          capabilityIds: ["conversation.text-turn"],
          output: { text: event.payload.text },
          at,
        });
        db.prepare(`
          UPDATE explorer_tasks
          SET status = 'finished',
              outcome = ?,
              final_response = ?,
              completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(outcome, sanitiseExplorerText(event.payload.text), at, taskId);
        return id;
      }
      case "error": {
        const id = appendEvent(db, taskId, {
          type: "error",
          title: "Task failed",
          status: "error",
          error: event.payload.message,
          at,
        });
        db.prepare(`
          UPDATE explorer_tasks
          SET status = 'failed',
              outcome = 'failed_safely',
              error_message = ?,
              completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(sanitiseExplorerText(event.payload.message), at, taskId);
        return id;
      }
      case "killed": {
        // The explicit kill route records cancellation immediately so the task
        // closes even if an uncooperative worker never emits `killed`. When the
        // normal AgentEvent arrives afterward, do not append a duplicate.
        const task = db.prepare(
          "SELECT status FROM explorer_tasks WHERE id = ?",
        ).get(taskId) as { status: ExplorerTaskStatus } | undefined;
        if (!task || task.status !== "running") return null;
        const id = appendEvent(db, taskId, {
          type: "task_cancelled",
          title: "Task cancelled",
          status: "cancelled",
          output: { reason: event.payload.reason ?? "manual" },
          at,
        });
        db.prepare(`
          UPDATE explorer_tasks
          SET status = 'cancelled',
              outcome = 'cancelled_by_user',
              completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(at, taskId);
        return id;
      }
      case "done": {
        const task = db.prepare(
          "SELECT status FROM explorer_tasks WHERE id = ?",
        ).get(taskId) as { status: ExplorerTaskStatus } | undefined;
        if (!task) return null;
        if (task.status === "finished" || task.status === "completed") {
          return appendEvent(db, taskId, {
            type: "task_finished",
            title: "Runtime finished",
            status: "success",
            at,
          });
        }
        if (task.status !== "running") return null;
        const id = appendEvent(db, taskId, {
          type: "error",
          title: "Task ended without a final result",
          status: "error",
          error: "The run ended without a final response or explicit failure event.",
          at,
        });
        db.prepare(`
          UPDATE explorer_tasks
          SET status = 'failed',
              outcome = 'ended_without_result',
              error_message = 'The run ended without a final response or explicit failure event.',
              completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(at, taskId);
        return id;
      }
    }
  })();
}

export function failExplorerTaskIfRunning(
  db: Db,
  taskId: string,
  message = "The run exited without a terminal event.",
  at = Date.now(),
): boolean {
  return db.transaction(() => {
    const task = db.prepare(
      "SELECT status FROM explorer_tasks WHERE id = ?",
    ).get(taskId) as { status: ExplorerTaskStatus } | undefined;
    if (!task || task.status !== "running") return false;
    appendEvent(db, taskId, {
      type: "error",
      title: "Task ended unexpectedly",
      status: "error",
      error: message,
      at,
    });
    db.prepare(`
      UPDATE explorer_tasks
      SET status = 'failed',
          outcome = 'ended_without_result',
          error_message = ?,
          completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(sanitiseExplorerText(message), at, taskId);
    return true;
  })();
}

export function cancelExplorerTaskIfRunning(
  db: Db,
  taskId: string,
  at = Date.now(),
): boolean {
  return db.transaction(() => {
    const task = db.prepare(
      "SELECT status FROM explorer_tasks WHERE id = ?",
    ).get(taskId) as { status: ExplorerTaskStatus } | undefined;
    if (!task || task.status !== "running") return false;
    appendEvent(db, taskId, {
      type: "task_cancelled",
      title: "Task cancelled by user",
      status: "cancelled",
      output: { reason: "manual" },
      at,
    });
    db.prepare(`
      UPDATE explorer_tasks
      SET status = 'cancelled',
          outcome = 'cancelled_by_user',
          completed_at = ?
      WHERE id = ? AND status = 'running'
    `).run(at, taskId);
    return true;
  })();
}

export function markStaleExplorerTasksInterrupted(
  db: Db,
  at = Date.now(),
): number {
  return db.transaction(() => {
    const rows = db.prepare(
      "SELECT id FROM explorer_tasks WHERE status = 'running'",
    ).all() as Array<{ id: string }>;
    for (const row of rows) {
      appendEvent(db, row.id, {
        type: "task_interrupted",
        title: "Task interrupted by server restart",
        status: "error",
        error: "The server restarted before this task recorded a terminal event.",
        at,
      });
      db.prepare(`
        UPDATE explorer_tasks
        SET status = 'interrupted',
            outcome = 'interrupted',
            error_message = 'The server restarted before this task recorded a terminal event.',
            completed_at = ?
        WHERE id = ?
      `).run(at, row.id);
    }
    return rows.length;
  })();
}

export function listExplorerTasks(
  db: Db,
  options: { limit?: number; offset?: number; status?: ExplorerTaskStatus } = {},
): ExplorerTaskSummary[] {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const where = options.status ? " WHERE t.status = ?" : "";
  const sql = `${TASK_SELECT}${where} GROUP BY t.id ORDER BY t.started_at DESC, t.id DESC LIMIT ? OFFSET ?`;
  const rows = options.status
    ? db.prepare(sql).all(options.status, limit, offset)
    : db.prepare(sql).all(limit, offset);
  return (rows as TaskRow[]).map(taskSummary);
}

export function countExplorerTasks(
  db: Db,
  options: { status?: ExplorerTaskStatus } = {},
): number {
  const row = options.status
    ? db.prepare(
        "SELECT COUNT(*) AS count FROM explorer_tasks WHERE status = ?",
      ).get(options.status)
    : db.prepare("SELECT COUNT(*) AS count FROM explorer_tasks").get();
  return Number((row as { count: number }).count);
}

export function getExplorerTask(
  db: Db,
  taskId: string,
): ExplorerTaskDetail | null {
  const row = db.prepare(
    `${TASK_SELECT} WHERE t.id = ? GROUP BY t.id`,
  ).get(taskId) as TaskRow | undefined;
  if (!row) return null;
  const eventRows = db.prepare(
    "SELECT * FROM explorer_events WHERE task_id = ? ORDER BY sequence ASC",
  ).all(taskId) as EventRow[];
  return {
    ...taskSummary(row),
    originalRequest: sanitiseExplorerText(row.original_request) ?? "",
    finalResponse: sanitiseExplorerText(row.final_response),
    error: sanitiseExplorerText(row.error_message),
    events: eventRows.map(eventFromRow),
  };
}

export function explorerCoverage() {
  return EXPLORER_COVERAGE;
}
