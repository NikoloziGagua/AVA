import type {
  ExplorerEvent,
  ExplorerTaskSummary,
} from "../api.js";

export type ExplorerTaskStatusFilter = "all" | ExplorerTaskSummary["status"];
export type ExplorerVerificationFilter =
  | "all"
  | ExplorerTaskSummary["verification"]["status"];

type ErrorWithStatus = {
  message?: unknown;
  status?: unknown;
};

/**
 * Preserve the actual request failure while adding the most likely recovery
 * step. Explorer routes were introduced after AVA's original web shell, so a
 * browser tab connected to a server process that has not restarted is a common
 * and otherwise confusing failure mode.
 */
export function describeExplorerRequestError(
  error: unknown,
  resource: string,
): string {
  const candidate =
    error && typeof error === "object" ? (error as ErrorWithStatus) : null;
  const status =
    typeof candidate?.status === "number" && Number.isFinite(candidate.status)
      ? candidate.status
      : null;
  const rawMessage =
    typeof candidate?.message === "string" && candidate.message.trim()
      ? candidate.message.trim()
      : typeof error === "string" && error.trim()
        ? error.trim()
        : "Unknown request failure";
  const technical = status == null
    ? rawMessage
    : `HTTP ${status}: ${rawMessage}`;

  if (status === 401) {
    return `${technical}. AVA rejected this browser session. Pair or sign in again, then retry ${resource}.`;
  }
  if (status === 404 || status === 405) {
    return `${technical}. The running AVA server may predate the Explorer routes. Restart AVA so the current server build is loaded, refresh Explorer, then retry ${resource}.`;
  }
  if (status != null && status >= 500) {
    return `${technical}. The AVA server failed while loading ${resource}. Check its server log; if an older process is still running, restart AVA and retry.`;
  }
  if (
    rawMessage.toLocaleLowerCase().includes("fetch") ||
    rawMessage.toLocaleLowerCase().includes("network")
  ) {
    return `${technical}. Explorer could not reach the AVA server. Make sure AVA is running, restart it if this tab is connected to an older process, then refresh Explorer.`;
  }
  return `${technical}. Retry ${resource}; if the problem persists, restart AVA so the current Explorer backend is active.`;
}

export function humanizeExplorerToken(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function explorerTaskStatusLabel(status: string): string {
  if (status === "finished") return "Final response recorded";
  if (status === "completed") return "Legacy final response";
  return humanizeExplorerToken(status);
}

export function formatExplorerDuration(
  durationMs: number | null | undefined,
  fallback = "Not recorded",
): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) {
    return fallback;
  }
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) {
    const seconds = durationMs / 1_000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  }
  if (durationMs < 3_600_000) {
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.floor((durationMs % 60_000) / 1_000);
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(durationMs / 3_600_000);
  const minutes = Math.floor((durationMs % 3_600_000) / 60_000);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatExplorerTimestamp(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "Not recorded";
  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function explorerTaskTitle(task: ExplorerTaskSummary): string {
  const title = task.sessionTitle?.trim();
  if (title) return title;
  return `Task ${task.id.slice(0, 8)}`;
}

export function filterExplorerTasks(
  tasks: readonly ExplorerTaskSummary[],
  query: string,
  status: ExplorerTaskStatusFilter,
  verification: ExplorerVerificationFilter,
): ExplorerTaskSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return tasks.filter((task) => {
    if (status !== "all" && task.status !== status) return false;
    if (verification !== "all" && task.verification.status !== verification) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      task.id,
      task.sessionId,
      task.sessionTitle,
      task.outcome,
      task.mode,
      task.status,
      task.verification.status,
      task.verification.reason,
      ...task.capabilityIds,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  });
}

export function selectInitialExplorerEvent(
  events: readonly ExplorerEvent[],
): ExplorerEvent | null {
  return (
    events.find(
      (event) =>
        event.status === "error" ||
        event.status === "denied" ||
        event.status === "expired" ||
        event.error,
    ) ??
    events[0] ??
    null
  );
}

export function stringifyExplorerPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
