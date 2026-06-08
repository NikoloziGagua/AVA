import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

export type Intent = {
  id: string;
  goal: string;
  status: string;
  outcome?: string;
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

  // Cancel a running/queued self-improvement (the Stop for self-dev). The server
  // aborts the worker + verify subprocess; refresh reflects the cancelled state.
  const cancel = useCallback(async (id: string) => {
    try {
      await fetch(`/api/self/${id}/cancel`, { method: "POST", headers: authHeaders() });
    } catch {
      /* server truth surfaces on refresh */
    }
    await refresh();
  }, [refresh]);

  return { intents, paused, setPaused, revertLast, cancel };
}

/** A self-improvement is still in flight (cancellable) in these states. */
export function isRunningStatus(status: string): boolean {
  return status === "queued" || status === "reflecting" || status === "implementing" || status === "verifying";
}
