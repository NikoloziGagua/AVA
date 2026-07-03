import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

export type Intent = {
  id: string;
  goal: string;
  status: string;
  outcome?: string;
  /** While awaiting_approval this holds the drafted plan (prefixed "PLAN:"). */
  diff_summary?: string | null;
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
async function getSelf(): Promise<{ intents: Intent[]; paused: boolean } | null> {
  const r = await fetch("/api/self", { headers: authHeaders() });
  if (!r.ok) return null;
  const j: unknown = await r.json();
  if (Array.isArray(j)) return { intents: j as Intent[], paused: false };
  if (j && typeof j === "object") {
    const o = j as { improvements?: Intent[]; intents?: Intent[]; paused?: boolean };
    return { intents: o.improvements ?? o.intents ?? [], paused: o.paused === true };
  }
  return null;
}

export function useSelfJournal() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [paused, setPausedState] = useState(false);
  const intentsRef = useRef<Intent[]>([]);
  intentsRef.current = intents;

  const refresh = useCallback(async () => {
    try {
      const s = await getSelf();
      if (!s) return; // transient failure — keep the last good view
      setIntents(s.intents);
      setPausedState(s.paused);
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
  // Approve / reject a plan parked at awaiting_approval.
  const approve = useCallback((id: string) => act(id, "approve"), [act]);
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
          if (r.status === 409)
            return { ok: false, error: "self-improvement is paused — resume it first" };
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

  return { intents, paused, setPaused, improve, revertLast, cancel, approve, reject };
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
