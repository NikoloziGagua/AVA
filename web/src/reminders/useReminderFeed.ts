import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWatches, type WatchRow } from "../api.js";

export type ReminderFeed =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** `stale`: the last refresh failed, so these rows are from `fetchedAt`. */
  | { status: "ok"; watches: WatchRow[]; fetchedAt: number; stale: boolean };

/**
 * The reminder list, kept current while it is on screen. Statuses change on
 * their own (Scheduled -> Accepted), so it refreshes every `refreshMs` while
 * the page is visible and whenever it regains focus. Only the newest request
 * may change what is shown: a slow older poll can never overwrite a newer
 * answer. A failed refresh keeps the last rows but marks them stale.
 */
export function useReminderFeed(refreshMs = 15_000) {
  const [feed, setFeed] = useState<ReminderFeed>({ status: "loading" });
  const latest = useRef(0);
  const mounted = useRef(true);

  /** Resolves with the rows fetched (even if a newer request superseded them), or null on failure. */
  const refresh = useCallback(async (): Promise<WatchRow[] | null> => {
    const request = ++latest.current;
    try {
      const watches = await fetchWatches();
      if (mounted.current && request === latest.current) {
        setFeed({ status: "ok", watches, fetchedAt: Date.now(), stale: false });
      }
      return watches;
    } catch (error) {
      if (mounted.current && request === latest.current) {
        setFeed((current) => current.status === "ok"
          ? { ...current, stale: true }
          : { status: "error", message: error instanceof Error ? error.message : "Reminders could not be loaded." });
      }
      return null;
    }
  }, []);

  /** Drop a row the server has confirmed deleted, before the next refresh arrives. */
  const forget = useCallback((id: string) => {
    // Any refresh still in flight was asked before the delete: ignore it.
    latest.current += 1;
    setFeed((current) => current.status === "ok"
      ? { ...current, watches: current.watches.filter((watch) => watch.id !== id) }
      : current);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const whenVisible = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(whenVisible, refreshMs);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener("focus", whenVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener("focus", whenVisible);
    };
  }, [refresh, refreshMs]);

  return { feed, refresh, forget };
}

/** "14:05" for the stale marker, in the browser's own zone. */
export function fetchedAtLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
