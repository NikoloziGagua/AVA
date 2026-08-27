import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

export type Intent = {
  id: string;
  goal: string;
  status: string;
  outcome?: string;
  /** While awaiting_approval this holds the drafted plan (prefixed "PLAN:"). */
  diff_summary?: string | null;
  worker_provider?: "claude" | "codex";
  error?: string | null;
  cancellation_source?: "self_stop" | "global_stop" | "system_abort" | null;
};

export type WorkerOption = {
  provider: "claude" | "codex";
  label: string;
  installed: boolean;
  configuration: "not_checked" | "unavailable";
  available: boolean;
  version: string | null;
  reason: string | null;
};

export type WorkerState = {
  provider: "claude" | "codex";
  version: number;
  updatedAt: number;
  options: WorkerOption[];
};

const POLL_MS = 4000;

function authHeaders(): HeadersInit {
  const token = getToken() ?? "";
  return { authorization: `Bearer ${token}` };
}

function jsonAuthHeaders(): HeadersInit {
  const token = getToken() ?? "";
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/**
 * GET /api/self — the server is migrating from `{intents}` (and, before that, a bare
 * array) to `{improvements, paused}`. Parse all three shapes so the UI never breaks
 * mid-deploy; a shape with no `paused` field means the server can't pause → false.
 */
async function getSelf(): Promise<{ intents: Intent[]; paused: boolean; worker: WorkerState | null } | null> {
  const r = await fetch("/api/self", { headers: authHeaders() });
  if (!r.ok) return null;
  const j: unknown = await r.json();
  if (Array.isArray(j)) return { intents: j as Intent[], paused: false, worker: null };
  if (j && typeof j === "object") {
    const o = j as { improvements?: Intent[]; intents?: Intent[]; paused?: boolean; worker?: WorkerState };
    return { intents: o.improvements ?? o.intents ?? [], paused: o.paused === true, worker: o.worker ?? null };
  }
  return null;
}

export function useSelfJournal() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [paused, setPausedState] = useState(false);
  const [worker, setWorkerState] = useState<WorkerState | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [selectingWorker, setSelectingWorker] = useState(false);
  const intentsRef = useRef<Intent[]>([]);
  intentsRef.current = intents;

  const refresh = useCallback(async () => {
    try {
      const s = await getSelf();
      if (!s) return; // transient failure — keep the last good view
      setIntents(s.intents);
      setPausedState(s.paused);
      setWorkerState(s.worker);
    } catch {
      /* best-effort polling */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const revertLast = useCallback(async () => {
    const target = [...intentsRef.current].reverse().find((i) => i.status === "swapped");
    if (!target) return;
    try {
      await fetch(`/api/self/${target.id}/revert`, {
        method: "POST",
        headers: authHeaders(),
      });
    } catch {
      /* surface nothing — refresh reflects server truth */
    }
    await refresh();
  }, [refresh]);

  // POST a simple action (cancel/approve/reject) for one intent, then refresh so the
  // UI reflects server truth. Errors are swallowed — the next poll corrects the view.
  const act = useCallback(async (id: string, action: "cancel" | "approve" | "reject") => {
    try {
      await fetch(`/api/self/${id}/${action}`, { method: "POST", headers: authHeaders() });
    } catch {
      /* server truth surfaces on refresh */
    }
    await refresh();
  }, [refresh]);

  // Cancel a running/queued self-improvement (the Stop for self-dev). The server
  // aborts the worker + verify subprocess; refresh reflects the cancelled state.
  const cancel = useCallback((id: string) => act(id, "cancel"), [act]);
  // Approval locks the currently displayed worker/version. If another client
  // changes the selector first, the server refuses the stale approval instead
  // of silently running a different provider.
  const approve = useCallback(async (id: string) => {
    const selected = worker;
    if (!selected) {
      setWorkerError("AVA has not loaded the implementation worker yet.");
      return;
    }
    setWorkerError(null);
    try {
      const response = await fetch(`/api/self/${id}/approve`, {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ expectedWorkerVersion: selected.version }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        reason?: string;
      };
      if (!response.ok) {
        if (body.error === "stale_version") {
          setWorkerError("The worker choice changed elsewhere. Review it and approve again.");
        } else if (body.error === "worker_unavailable") {
          setWorkerError(body.reason ?? "The selected worker is unavailable.");
        } else {
          setWorkerError("AVA could not approve this plan. Refresh and try again.");
        }
      }
    } catch {
      setWorkerError("Couldn't approve the plan. Check AVA's connection and try again.");
    }
    await refresh();
  }, [refresh, worker]);
  // Reject does not need a worker lock because no provider is launched.
  const reject = useCallback((id: string) => act(id, "reject"), [act]);

  // Ask Ava to start a self-improvement from a user-written goal. Unlike the journal
  // actions this surfaces failure to the caller — the initiator input needs to tell
  // the user why nothing happened (e.g. 409 = self-improvement is paused).
  const improve = useCallback(
    async (goal: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = goal.trim();
      if (!trimmed) return { ok: false, error: "tell Ava what to improve first" };
      try {
        const r = await fetch("/api/self/improve", {
          method: "POST",
          headers: jsonAuthHeaders(),
          body: JSON.stringify({ goal: trimmed }),
        });
        if (!r.ok) {
          if (r.status === 409) {
            const body = await r.json().catch(() => ({})) as { error?: string; reason?: string };
            if (body.error === "worker_unavailable")
              return { ok: false, error: body.reason ?? "the selected worker is unavailable" };
            return { ok: false, error: "self-improvement is paused — resume it first" };
          }
          return { ok: false, error: `couldn't start (HTTP ${r.status})` };
        }
        await refresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "network error — try again" };
      }
    },
    [refresh],
  );

  // Pause/resume the autonomous loop on the SERVER. Optimistic flip so the button
  // feels instant; the response (and every 4s poll) reconciles to server truth.
  const setPaused = useCallback(async (next: boolean) => {
    setPausedState(next);
    try {
      const r = await fetch("/api/self/pause", {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ paused: next }),
      });
      if (r.ok) {
        const j = (await r.json()) as { paused?: boolean };
        if (typeof j.paused === "boolean") setPausedState(j.paused);
      }
    } catch {
      /* next poll reconciles to server truth */
    }
  }, []);

  const selectWorker = useCallback(async (provider: "claude" | "codex") => {
    const current = worker;
    if (!current || current.provider === provider || selectingWorker) return;
    setSelectingWorker(true);
    setWorkerError(null);
    try {
      const r = await fetch("/api/self/worker", {
        method: "POST",
        headers: jsonAuthHeaders(),
        body: JSON.stringify({ provider, expectedVersion: current.version }),
      });
      const body = await r.json().catch(() => ({})) as {
        error?: string;
        reason?: string;
        worker?: Omit<WorkerState, "options">;
      };
      if (!r.ok) {
        setWorkerError(body.error === "stale_version"
          ? "The worker choice changed elsewhere. Refreshed the latest setting."
          : body.reason ?? "That worker is unavailable.");
        await refresh();
        return;
      }
      if (body.worker) setWorkerState({ ...body.worker, options: current.options });
      await refresh();
    } catch {
      setWorkerError("Couldn't change the worker. Check AVA's connection and try again.");
    } finally {
      setSelectingWorker(false);
    }
  }, [refresh, selectingWorker, worker]);

  return {
    intents, paused, setPaused, improve, revertLast, cancel, approve, reject,
    worker, workerError, selectingWorker, selectWorker,
  };
}

/** A self-improvement is still in flight (cancellable) in these states. */
export function isRunningStatus(status: string): boolean {
  return status === "queued" || status === "reflecting" || status === "implementing" || status === "verifying";
}

/** Strip the "PLAN:" prefix off the parked plan for display. */
export function planText(diffSummary: string | null | undefined): string {
  if (!diffSummary) return "";
  return diffSummary.replace(/^PLAN:\s*/, "").trim();
}
