import { useCallback, useEffect, useState } from "react";
import { fetchInitiativeSummary, type InitiativeSummary } from "./api.js";

/** Pending ideas change at most daily, so a slow background check is enough. */
export const SUMMARY_REFRESH_MS = 5 * 60_000;

/**
 * AVA's pending invitations for the bar and the island. It is read when the
 * app opens or comes back into view, every few minutes while visible, and on
 * request after Niko answers one. A failed read shows nothing rather than a
 * stale count, and an AVA without initiatives (404) simply has none.
 */
export function useInitiativeSummary(enabled: boolean): { summary: InitiativeSummary | null; refresh: () => void } {
  const [summary, setSummary] = useState<InitiativeSummary | null>(null);
  const [request, setRequest] = useState(0);
  const refresh = useCallback(() => setRequest((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;
    const load = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      fetchInitiativeSummary()
        .then((next) => { if (!cancelled) setSummary(next); })
        .catch(() => { if (!cancelled) setSummary(null); })
        .finally(() => { inFlight = false; });
    };
    load();
    const timer = window.setInterval(load, SUMMARY_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, request]);

  return { summary: enabled ? summary : null, refresh };
}
