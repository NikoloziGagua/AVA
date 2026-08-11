import { ApiError } from "../api.js";
import { clearToken, getToken } from "../auth/tokens.js";

export type StrategyActor = "niko" | "ava" | "codex" | "system";
export type StrategyRoomStatus = "discussing" | "awaiting_niko" | "approved" | "paused" | "failed";

export type StrategyRoom = {
  id: string;
  title: string;
  topic: string;
  status: StrategyRoomStatus;
  phase: string;
  activeActor: StrategyActor | null;
  round: number;
  version: number;
  livingBrief: string | null;
  conclusion: string | null;
  codexThreadId: string | null;
  sourceSessionId: string | null;
  sourceThroughMessageId: number | null;
  returnedMessageId: number | null;
  returnedAt: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  stoppedAt: number | null;
};

export type StrategyMessage = {
  id: string;
  roomId: string;
  sequence: number;
  author: StrategyActor;
  kind: "message" | "position" | "review" | "synthesis" | "decision" | "status" | "error";
  content: string;
  correlationId: string;
  createdAt: number;
};

export type StrategyDetail = { room: StrategyRoom; messages: StrategyMessage[] };

export type StrategyMeta = {
  service: "ava-strategy-room";
  apiVersion: number;
  authority: "ava";
  participants: {
    niko: { available: boolean; role: string };
    ava: { available: boolean; role: string };
    codex: { available: boolean; role: string; version: string | null; error: string | null };
  };
  approvalEffect: "records_decision_only";
  chatHandoff: "server_snapshot_and_explicit_approved_return";
  codexBoundary: "dedicated_read_only_resumable_cli_thread";
  eventBounds: { min: number | null; max: number | null };
};

export type StrategyEvent = {
  seq: number;
  eventId: string;
  roomId: string;
  type: string;
  payload: unknown;
  createdAt: number;
};

async function strategyRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "AVA's server is unreachable.", "server_unreachable", "Restart the AVA Desktop Runtime.", path);
  }
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      window.dispatchEvent(new Event("ava:unauthorized"));
    }
    throw new ApiError(
      response.status,
      body.message ?? body.error ?? `Strategy Room returned HTTP ${response.status}.`,
      body.error ?? `http_${response.status}`,
      null,
      path,
    );
  }
  return body as T;
}

export async function fetchStrategyMeta(): Promise<StrategyMeta> {
  return strategyRequest("/api/strategy/meta");
}

export async function fetchStrategyRooms(): Promise<StrategyRoom[]> {
  const result = await strategyRequest<{ rooms: StrategyRoom[] }>("/api/strategy/rooms");
  return result.rooms;
}

export async function fetchStrategyRoom(id: string): Promise<StrategyDetail> {
  return strategyRequest(`/api/strategy/rooms/${encodeURIComponent(id)}`);
}

export async function createStrategyRoom(topic: string): Promise<StrategyDetail> {
  return strategyRequest("/api/strategy/rooms", {
    method: "POST",
    body: JSON.stringify({ topic }),
  });
}

export async function createStrategyRoomFromChat(sessionId: string): Promise<StrategyDetail> {
  return strategyRequest("/api/strategy/rooms/from-chat", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function sendStrategyMessage(id: string, content: string): Promise<StrategyDetail> {
  return strategyRequest(`/api/strategy/rooms/${encodeURIComponent(id)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function approveStrategyRoom(id: string, expectedVersion: number): Promise<StrategyRoom> {
  const result = await strategyRequest<{ approved: true; room: StrategyRoom }>(
    `/api/strategy/rooms/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
  return result.room;
}

export type ReturnedStrategyConclusion = {
  room: StrategyRoom;
  sessionId: string;
  messageId: number;
  idempotent: boolean;
};

export async function returnStrategyConclusionToChat(
  id: string,
  expectedVersion: number,
): Promise<ReturnedStrategyConclusion> {
  const result = await strategyRequest<ReturnedStrategyConclusion & { returned: true }>(
    `/api/strategy/rooms/${encodeURIComponent(id)}/return-to-chat`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
  return result;
}

export async function pauseStrategyRoom(id: string, expectedVersion: number): Promise<StrategyRoom> {
  const result = await strategyRequest<{ paused: true; room: StrategyRoom }>(
    `/api/strategy/rooms/${encodeURIComponent(id)}/pause`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
  return result.room;
}

export async function resumeStrategyRoom(id: string, expectedVersion: number): Promise<StrategyRoom> {
  const result = await strategyRequest<{ resumed: true; room: StrategyRoom }>(
    `/api/strategy/rooms/${encodeURIComponent(id)}/resume`,
    { method: "POST", body: JSON.stringify({ expectedVersion }) },
  );
  return result.room;
}

export function subscribeStrategyEvents(options: {
  after?: number;
  onEvent: (event: StrategyEvent) => void;
  onGap?: () => void;
  onState?: (state: "connecting" | "live" | "offline") => void;
}): () => void {
  const controller = new AbortController();
  let cursor = Math.max(0, options.after ?? 0);
  let retryMs = 500;

  const wait = (ms: number) => new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    controller.signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });

  void (async () => {
    while (!controller.signal.aborted) {
      options.onState?.("connecting");
      try {
        const headers = new Headers({ accept: "text/event-stream" });
        const token = getToken();
        if (token) headers.set("authorization", `Bearer ${token}`);
        const response = await fetch(`/api/strategy/stream?after=${cursor}`, {
          headers,
          signal: controller.signal,
        });
        if (response.status === 401) {
          clearToken();
          window.dispatchEvent(new Event("ava:unauthorized"));
          return;
        }
        if (!response.ok || !response.body) throw new Error(`stream_http_${response.status}`);
        options.onState?.("live");
        retryMs = 500;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = "";
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) data += `${data ? "\n" : ""}${line.slice(5).trimStart()}`;
            }
            if (eventName === "strategy_event" && data) {
              const event = JSON.parse(data) as StrategyEvent;
              if (event.seq > cursor) {
                cursor = event.seq;
                options.onEvent(event);
              }
            } else if (eventName === "gap") options.onGap?.();
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        options.onState?.("offline");
      }
      await wait(retryMs);
      retryMs = Math.min(8_000, retryMs * 2);
    }
  })();
  return () => controller.abort();
}
