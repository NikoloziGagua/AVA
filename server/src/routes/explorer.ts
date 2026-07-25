import { Router, type RequestHandler, type Response } from "express";
import type { Db } from "../state/db.js";
import type { ActiveRuns } from "../orchestrator/active-runs.js";
import type { CapabilitySnapshot } from "./capabilities.js";
import {
  countExplorerTasks,
  explorerCoverage,
  getExplorerTask,
  listExplorerTasks,
} from "../explorer/store.js";
import {
  deriveExplorerCapabilities,
  EXPLORER_DOMAINS,
} from "../explorer/registry.js";
import type { ExplorerTaskStatus } from "../explorer/types.js";
import { buildLearnedWorkflowSnapshot } from "../explorer/workflows.js";

export const EXPLORER_API_VERSION = 2;

const TASK_STATUSES = new Set<ExplorerTaskStatus>([
  "running",
  "finished",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export type ExplorerLiveTask = {
  id: string;
  sessionId: string | null;
  sessionTitle: string | null;
  status: "running";
  mode: "conversation" | "action" | null;
  startedAt: number | null;
  elapsedMs: number | null;
  currentStage: string;
  eventCount: number;
  traceAvailable: boolean;
  source: "active_run_registry";
};

export type ExplorerRouteDeps = {
  db: Db;
  runs: ActiveRuns;
  startedAt: number;
  memoryDir: string;
  capabilitySnapshot: () => Promise<CapabilitySnapshot>;
};

function queryString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function sendExplorerError(
  res: Response,
  input: {
    status: number;
    error: string;
    message: string;
    action: string;
    retryable: boolean;
  },
): void {
  res.status(input.status).json({
    error: input.error,
    message: input.message,
    action: input.action,
    retryable: input.retryable,
    service: "ava-explorer",
    apiVersion: EXPLORER_API_VERSION,
  });
}

export function explorerRoutes(
  auth: RequestHandler,
  deps: ExplorerRouteDeps,
): Router {
  const router = Router();

  router.get("/meta", auth, (_req, res) => {
    res.json({
      ok: true,
      service: "ava-explorer",
      apiVersion: EXPLORER_API_VERSION,
      instrumentation: "enabled",
      serverStartedAt: deps.startedAt,
      coverage: explorerCoverage(),
      endpoints: ["tasks", "live", "capabilities", "workflows"],
    });
  });

  router.get("/tasks", auth, (req, res) => {
    const statusParam = queryString(req.query.status);
    if (statusParam && !TASK_STATUSES.has(statusParam as ExplorerTaskStatus)) {
      sendExplorerError(res, {
        status: 400,
        error: "bad_status",
        message: `Unknown Explorer task status: ${statusParam}.`,
        action: "Use running, finished, completed, failed, cancelled, or interrupted.",
        retryable: false,
      });
      return;
    }
    const limitParam = queryString(req.query.limit);
    const parsedLimit = limitParam === undefined ? 50 : Number(limitParam);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      sendExplorerError(res, {
        status: 400,
        error: "bad_limit",
        message: "Explorer task limit must be a positive number.",
        action: "Use a limit between 1 and 100.",
        retryable: false,
      });
      return;
    }
    const offsetParam = queryString(req.query.offset);
    const parsedOffset = offsetParam === undefined ? 0 : Number(offsetParam);
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
      sendExplorerError(res, {
        status: 400,
        error: "bad_offset",
        message: "Explorer task offset cannot be negative.",
        action: "Use zero or a positive offset.",
        retryable: false,
      });
      return;
    }
    try {
      const status = statusParam as ExplorerTaskStatus | undefined;
      const limit = Math.min(100, Math.floor(parsedLimit));
      const offset = Math.floor(parsedOffset);
      const total = countExplorerTasks(deps.db, { status });
      const tasks = listExplorerTasks(deps.db, {
        limit,
        offset,
        status,
      });
      res.json({
        tasks,
        total,
        limit,
        offset,
        hasMore: offset + tasks.length < total,
        coverage: explorerCoverage(),
        generatedAt: Date.now(),
        apiVersion: EXPLORER_API_VERSION,
      });
    } catch {
      sendExplorerError(res, {
        status: 503,
        error: "explorer_task_store_unavailable",
        message: "AVA could not read the durable Explorer task store.",
        action: "Restart the AVA Desktop Runtime. If this continues, inspect the AVA server logs.",
        retryable: true,
      });
    }
  });

  router.get("/tasks/:id", auth, (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string") {
      sendExplorerError(res, {
        status: 400,
        error: "bad_request",
        message: "A task ID is required.",
        action: "Choose a recorded task from Task Inspector.",
        retryable: false,
      });
      return;
    }
    try {
      const task = getExplorerTask(deps.db, id);
      if (!task) {
        sendExplorerError(res, {
          status: 404,
          error: "explorer_task_not_found",
          message: "No instrumented Explorer task exists for this ID.",
          action:
            "Choose a task from the recorded task list. Tasks from before Explorer instrumentation have no reconstructed trace.",
          retryable: false,
        });
        return;
      }
      res.json({
        task,
        coverage: explorerCoverage(),
        apiVersion: EXPLORER_API_VERSION,
      });
    } catch {
      sendExplorerError(res, {
        status: 503,
        error: "explorer_task_store_unavailable",
        message: "AVA could not read this Explorer execution record.",
        action: "Restart the AVA Desktop Runtime. If this continues, inspect the AVA server logs.",
        retryable: true,
      });
    }
  });

  router.get("/live", auth, (_req, res) => {
    try {
      const now = Date.now();
      const tasks: ExplorerLiveTask[] = deps.runs.list().map((run) => {
        const trace = getExplorerTask(deps.db, run.runId);
        const last = trace?.events.at(-1);
        return {
          id: run.runId,
          sessionId: run.sessionId,
          sessionTitle: trace?.sessionTitle ?? null,
          status: "running",
          mode: trace?.mode ?? null,
          startedAt: trace?.startedAt ?? null,
          elapsedMs: trace ? Math.max(0, now - trace.startedAt) : null,
          currentStage: last?.title ?? "Active run (structured trace unavailable)",
          eventCount: trace?.eventCount ?? 0,
          traceAvailable: trace !== null,
          source: "active_run_registry",
        };
      });
      res.json({
        tasks,
        generatedAt: now,
        source: "active_run_registry",
        apiVersion: EXPLORER_API_VERSION,
      });
    } catch {
      sendExplorerError(res, {
        status: 503,
        error: "explorer_live_registry_unavailable",
        message: "AVA could not read the active-run registry.",
        action: "Restart the AVA Desktop Runtime, then reopen Live.",
        retryable: true,
      });
    }
  });

  router.get("/capabilities", auth, async (_req, res) => {
    try {
      const snapshot = await deps.capabilitySnapshot();
      res.json({
        domains: EXPLORER_DOMAINS,
        capabilities: deriveExplorerCapabilities(snapshot),
        generatedAt: snapshot.generatedAt,
        sources: [
          "capability_registry",
          "runtime_probe",
          "configuration",
          "local_store",
        ],
        apiVersion: EXPLORER_API_VERSION,
      });
    } catch {
      sendExplorerError(res, {
        status: 503,
        error: "explorer_capability_probe_unavailable",
        message: "AVA could not build the current capability evidence snapshot.",
        action: "Retry the check. If it continues, inspect AVA's server health and logs.",
        retryable: true,
      });
    }
  });

  router.get("/workflows", auth, (_req, res) => {
    try {
      res.json({
        ...buildLearnedWorkflowSnapshot(deps.memoryDir),
        apiVersion: EXPLORER_API_VERSION,
      });
    } catch {
      sendExplorerError(res, {
        status: 503,
        error: "explorer_workflow_store_unavailable",
        message: "AVA could not read her learned procedural playbooks.",
        action: "Open Memory > Playbooks to check the store, then retry Explorer.",
        retryable: true,
      });
    }
  });

  return router;
}
