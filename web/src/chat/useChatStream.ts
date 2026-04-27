// web/src/chat/useChatStream.ts
import { useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

type EventBase = { id: number; runEpoch: number };

export type StreamEvent =
  | (EventBase & { kind: "thought"; payload: { text: string } })
  | (EventBase & { kind: "tool_call"; payload: { tool: string; args: unknown } })
  | (EventBase & { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string } })
  | (EventBase & { kind: "final"; payload: { text: string } })
  | (EventBase & { kind: "error"; payload: { message: string } })
  | (EventBase & { kind: "killed"; payload: Record<string, never> })
  | (EventBase & { kind: "done"; payload: Record<string, never> })
  | (EventBase & { kind: "gap"; payload: { from: number; to: number } });

export function useChatStream(sessionId: string | null, runEpoch: number) {
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

    function connect() {
      if (cancelled || finished) return;
      const token = getToken() ?? "";
      const url =
        `/api/chat/${sessionId}/stream` +
        `?lastEventId=${lastIdRef.current}&t=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;
      es.addEventListener("error", () => {
        es.close();
        if (!finished) setTimeout(connect, 1000);
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
      for (const k of ["thought", "tool_call", "tool_result", "final", "error", "killed", "done", "gap"] as const) {
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

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      esRef.current?.close();
    };
  }, [sessionId, runEpoch]);

  return { events };
}
