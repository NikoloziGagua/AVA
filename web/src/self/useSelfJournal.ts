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

async function getSelf(): Promise<Intent[]> {
  const r = await fetch("/api/self", { headers: authHeaders() });
  if (!r.ok) return [];
  const j = (await r.json()) as { intents: Intent[] };
  return j.intents ?? [];
}

export function useSelfJournal() {
  const [intents, setIntents] = useState<Intent[]>([]);
  const [paused, setPaused] = useState(false);
  const intentsRef = useRef<Intent[]>([]);
  intentsRef.current = intents;

  const refresh = useCallback(async () => {
    try {
      setIntents(await getSelf());
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

  return { intents, paused, setPaused, revertLast, cancel, approve, reject };
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
