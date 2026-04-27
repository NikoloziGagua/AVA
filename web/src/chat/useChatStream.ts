// web/src/chat/useChatStream.ts
import { useEffect, useRef, useState } from "react";
import { getToken } from "../auth/tokens.js";

export type StreamEvent =
  | { kind: "thought"; payload: { text: string }; id: number }
  | { kind: "tool_call"; payload: { tool: string; args: unknown }; id: number }
  | { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string }; id: number }
  | { kind: "final"; payload: { text: string }; id: number }
  | { kind: "error"; payload: { message: string }; id: number }
  | { kind: "killed"; payload: Record<string, never>; id: number }
  | { kind: "done"; payload: Record<string, never>; id: number }
  | { kind: "gap"; payload: { from: number; to: number }; id: number };

export function useChatStream(sessionId: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const lastIdRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const token = getToken() ?? "";
      const url =
        `/api/chat/${sessionId}/stream` +
        `?lastEventId=${lastIdRef.current}&t=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      esRef.current = es;
      es.addEventListener("error", () => {
        es.close();
        setTimeout(connect, 1000);
      });
      const handle = (kind: StreamEvent["kind"]) => (e: MessageEvent) => {
        const id = Number((e as MessageEvent & { lastEventId?: string }).lastEventId ?? 0);
        const payload = JSON.parse(e.data);
        lastIdRef.current = Math.max(lastIdRef.current, id);
        setEvents((prev) => [...prev, { kind, payload, id } as StreamEvent]);
      };
      for (const k of ["thought", "tool_call", "tool_result", "final", "error", "killed", "done", "gap"] as const) {
        es.addEventListener(k, handle(k));
      }
    }

    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
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
  }, [sessionId]);

  return { events };
}
