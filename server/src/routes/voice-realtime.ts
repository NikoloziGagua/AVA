import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import type { Db } from "../state/db.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import { validateToken } from "../auth/tokens.js";

// ─── OpenAI Realtime API event shapes ────────────────────────────────────────
//
// The Realtime API uses a JSON event protocol over a single WebSocket. Our
// proxy is mostly a pipe — we relay client↔upstream events verbatim — but we
// also intercept a few event types to:
//   1. Inject our system prompt + voice + audio format on session.update
//   2. Persist the user's transcribed turn (input_audio_transcription.completed)
//   3. Persist Ava's transcribed reply (response.audio_transcript.done)
//
// Event types we care about (full list in OpenAI docs):
//   client → server:
//     - session.update          (we send this on connect)
//     - input_audio_buffer.append   (raw audio chunks from mic)
//     - input_audio_buffer.commit
//     - response.create
//     - conversation.item.create    (text-only injects, tool outputs)
//   server → client:
//     - session.created / session.updated
//     - input_audio_buffer.speech_started / .speech_stopped (server VAD)
//     - conversation.item.created
//     - conversation.item.input_audio_transcription.completed
//     - response.created / .done
//     - response.audio.delta / .done
//     - response.audio_transcript.delta / .done
//     - error

const REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-realtime";

export interface RealtimeProxyDeps {
  db: Db;
  apiKey: string | null;
  memoryDir: string;
  appendMessage: (m: { sessionId: string; role: "user" | "assistant"; content: string }) => void;
  getSession: (id: string) => { id: string } | null;
  createSession: (opts: { title: string | null }) => { id: string };
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

export interface RealtimeProxy {
  /** Attach a WebSocketServer that intercepts upgrades on the given path. */
  attach: (httpServer: import("node:http").Server) => void;
  /** Close the WS server (used in tests). */
  close: () => void;
}

const PATH = "/api/voice/realtime";

export function buildRealtimeProxy(deps: RealtimeProxyDeps): RealtimeProxy {
  const log = deps.log ?? { info: () => {}, warn: () => {}, error: () => {} };
  const wss = new WebSocketServer({ noServer: true });

  function handleUpgrade(httpServer: import("node:http").Server) {
    httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname !== PATH) return; // not ours; let other handlers (or 404) take it

      const token = url.searchParams.get("t") ?? url.searchParams.get("token") ?? "";
      const deviceId = validateToken(deps.db, token);
      if (!deviceId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      if (!deps.apiKey) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      const sessionIdParam = url.searchParams.get("sessionId");

      wss.handleUpgrade(req, socket, head, (ws) => {
        startSession(ws, sessionIdParam, deviceId).catch((err) => {
          log.error("realtime session error:", err instanceof Error ? err.message : err);
          try { ws.close(1011, "session error"); } catch { /* ignore */ }
        });
      });
    });
  }

  async function startSession(client: WebSocket, requestedSessionId: string | null, _deviceId: string) {
    let sessionId = requestedSessionId && deps.getSession(requestedSessionId)
      ? requestedSessionId
      : deps.createSession({ title: null }).id;

    const upstream = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    let upstreamReady = false;
    const pendingFromClient: RawData[] = [];

    upstream.on("open", () => {
      upstreamReady = true;
      // Configure the realtime session on connect.
      const system = buildSystemPrompt({
        memoryDir: deps.memoryDir,
        mode: "conversation",
      });
      upstream.send(JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["audio", "text"],
          instructions: system,
          voice: "ash",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
            create_response: true,
          },
        },
      }));
      // Tell the client which session id we landed on.
      try {
        client.send(JSON.stringify({ type: "ava.session", sessionId }));
      } catch { /* ignore */ }
      // Drain anything the client sent before upstream was ready.
      for (const buf of pendingFromClient) upstream.send(buf);
      pendingFromClient.length = 0;
    });

    // ─── Client → Upstream ─────────────────────────────────────────────
    client.on("message", (data) => {
      if (!upstreamReady) {
        pendingFromClient.push(data);
        return;
      }
      // Forward client events verbatim (input_audio_buffer.append, etc).
      upstream.send(data as Buffer | string);
    });

    // ─── Upstream → Client + transcript persistence ────────────────────
    upstream.on("message", (data) => {
      try {
        // Forward to client first so latency isn't blocked by parsing.
        if (client.readyState === WebSocket.OPEN) {
          client.send(data as Buffer | string);
        }
      } catch { /* client probably closed */ }

      // Best-effort persist; never let a parse error kill the proxy.
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        const evt = JSON.parse(text) as { type?: string; transcript?: string; item_id?: string };
        if (evt.type === "conversation.item.input_audio_transcription.completed") {
          const t = (evt.transcript ?? "").trim();
          if (t) deps.appendMessage({ sessionId, role: "user", content: t });
        }
        if (evt.type === "response.audio_transcript.done") {
          const t = (evt.transcript ?? "").trim();
          if (t) deps.appendMessage({ sessionId, role: "assistant", content: t });
        }
      } catch {
        // Audio chunks etc. arrive as strings but we only persist on the
        // small JSON events; binary or non-JSON gets ignored here.
      }
    });

    // ─── Lifecycle ────────────────────────────────────────────────────
    upstream.on("close", (code, reason) => {
      log.info("realtime upstream closed", code, reason?.toString());
      try { client.close(code, reason?.toString()); } catch { /* ignore */ }
    });
    upstream.on("error", (err) => {
      log.error("realtime upstream error:", err.message);
      try {
        client.send(JSON.stringify({ type: "error", error: { message: err.message } }));
      } catch { /* ignore */ }
      try { client.close(1011, "upstream error"); } catch { /* ignore */ }
    });

    client.on("close", () => {
      try { upstream.close(); } catch { /* ignore */ }
    });
    client.on("error", (err) => {
      log.warn("realtime client error:", err.message);
      try { upstream.close(); } catch { /* ignore */ }
    });
  }

  return {
    attach: handleUpgrade,
    close: () => { wss.close(); },
  };
}
