// web/src/chat/useChatStream.ts
import { useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";
import type { TaskReceipt } from "./task-receipt.js";

type EventBase = { id: number; runEpoch: number };

export type StreamEvent =
  | (EventBase & { kind: "thought"; payload: { text: string } })
  | (EventBase & { kind: "delta"; payload: { text: string } })
  | (EventBase & { kind: "tool_call"; payload: { tool: string; args: unknown } })
  | (EventBase & { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string } })
  | (EventBase & { kind: "final"; payload: { text: string } })
  | (EventBase & { kind: "error"; payload: { message: string } })
  | (EventBase & { kind: "killed"; payload: { reason?: "stuck" | "manual" } })
  | (EventBase & { kind: "done"; payload: Record<string, never> })
  | (EventBase & { kind: "receipt"; payload: TaskReceipt })
  | (EventBase & { kind: "gap"; payload: { from: number; to: number } })
  | (EventBase & { kind: "approval_required"; payload: { id: string; tool: string; args: unknown; summary: string } })
  | (EventBase & { kind: "approval_resolved"; payload: { id: string; status: "approved" | "denied" | "expired" } });

export function useChatStream(sessionId: string | null, runEpoch: number, taskId: string | null = null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const lastIdRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let finished = false;
    // Each run has its own event-id space starting at 1; reset id tracking
    // but keep accumulated events from prior runs visible.
    lastIdRef.current = 0;

    // Consecutive connection failures that never opened. A stream the server
    // rejects outright (401 auth failure / 403 / 404) fails immediately and
    // forever; without a terminal condition the 1s reconnect loop hammers an
    // auth-rejected endpoint indefinitely.
    let failStreak = 0;

    function connect() {
      if (cancelled || finished) return;
      const token = getToken() ?? "";
      const url =
        `/api/chat/${sessionId}/stream` +
        `?lastEventId=${lastIdRef.current}&t=${encodeURIComponent(token)}` +
        (taskId ? `&taskId=${encodeURIComponent(taskId)}` : "");
      const es = new EventSource(url);
      esRef.current = es;
      es.addEventListener("open", () => { failStreak = 0; });
      es.addEventListener("error", () => {
        // Capture readyState BEFORE close() forces it to CLOSED. When the server
        // rejects the connection (401/403/404) EventSource marks it CLOSED and
        // would NOT auto-reconnect — treat that as terminal. A transient network
        // blip leaves it CONNECTING (0) and is safe to retry. (2 === CLOSED.)
        const permanent = es.readyState === 2;
        es.close();
        if (finished) return;
        failStreak += 1;
        // Permanent rejection, or a burst of immediate failures that never
        // opened (defensive, in case readyState is unreliable): stop looping.
        if (permanent || failStreak >= 5) {
          finished = true;
          return;
        }
        setTimeout(connect, 1000);
      });
      const handle = (kind: StreamEvent["kind"]) => (e: MessageEvent) => {
        const data = (e as MessageEvent & { data?: string }).data;
        if (!data || data === "undefined") return;
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          return;
        }
        const id = Number((e as MessageEvent & { lastEventId?: string }).lastEventId ?? 0);
        lastIdRef.current = Math.max(lastIdRef.current, id);
        setEvents((prev) => [...prev, { kind, payload, id, runEpoch } as StreamEvent]);
        if (kind === "done" || kind === "killed" || kind === "error") {
          finished = true;
          es.close();
        }
      };
      for (const k of ["thought", "delta", "tool_call", "tool_result", "final", "error", "killed", "done", "receipt", "gap", "approval_required", "approval_resolved"] as const) {
        es.addEventListener(k, handle(k));
      }
    }

    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !finished) {
        esRef.current?.close();
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    // A 401 anywhere in the app clears the token and fires this — stop the
    // reconnect loop immediately instead of racing a now-tokenless retry.
    const onUnauthorized = () => {
      finished = true;
      esRef.current?.close();
    };
    window.addEventListener("ava:unauthorized", onUnauthorized);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("ava:unauthorized", onUnauthorized);
      esRef.current?.close();
    };
  }, [sessionId, runEpoch, taskId]);

  return { events };
}
