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

// gpt-4o-realtime-preview returned server_error on this account — likely a
// gate on the older preview SKU. The GA gpt-realtime model is enabled where
// gpt-5.x is, which is what we have. Override via REALTIME_MODEL env var.
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime";
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;

/**
 * GA `gpt-realtime` session.update payload.
 *
 * The GA model uses a NESTED audio schema and `output_modalities` — NOT the
 * beta-flat shape (top-level `modalities` / `voice` / `input_audio_transcription`),
 * which the GA model rejects as unknown parameters. Sending the beta shape was
 * the silent `session.update` failure that closed the socket. Verified against
 * the OpenAI Realtime GA docs (audio.input.format = { type:"audio/pcm", rate }).
 */
export function buildRealtimeSessionUpdate(instructions: string) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions,
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          turn_detection: { type: "server_vad" },
          transcription: { model: "whisper-1" },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice: "alloy",
        },
      },
    },
  };
}

/**
 * Map a realtime server event to a durable message, or null if it isn't a
 * transcript event. Accepts both the GA name (`response.output_audio_transcript.done`)
 * and the legacy beta name (`response.audio_transcript.done`) so transcript
 * persistence can't silently break across an API rename.
 */
export function persistTranscriptEvent(
  evt: { type?: string; transcript?: string },
): { role: "user" | "assistant"; content: string } | null {
  const type = evt.type ?? "";
  const content = (evt.transcript ?? "").trim();
  if (!content) return null;
  if (type === "conversation.item.input_audio_transcription.completed") {
    return { role: "user", content };
  }
  if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
    return { role: "assistant", content };
  }
  return null;
}

/**
 * Forward a WS frame preserving its text/binary kind. `ws` delivers incoming
 * frames to listeners as Buffers, and `send(buffer)` defaults to a BINARY
 * frame. But the OpenAI realtime protocol is JSON text in both directions
 * ("binary frames are not supported"), and the browser client drops any
 * non-string message — so re-framing text as binary silently breaks the audio
 * stream both ways. Passing the original `isBinary` keeps text as text.
 */
export function forwardFrame(target: Pick<WebSocket, "send">, data: RawData, isBinary: boolean): void {
  target.send(data, { binary: isBinary });
}

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

    // No `OpenAI-Beta: realtime=v1` header: that selects the beta protocol, and
    // we're now speaking the GA session schema over the GA `/v1/realtime` path.
    // Mixing the beta header with a GA-shaped session.update is incoherent and a
    // likely source of the rejection.
    const upstream = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
      },
    });

    let upstreamReady = false;
    const pendingFromClient: Array<{ data: RawData; isBinary: boolean }> = [];
    log.info("realtime: client connected, opening upstream to gpt-realtime");

    upstream.on("open", () => {
      upstreamReady = true;
      log.info("realtime: upstream open, sending session.update");
      // Configure the realtime session on connect.
      const system = buildSystemPrompt({
        memoryDir: deps.memoryDir,
        mode: "conversation",
      });
      upstream.send(JSON.stringify(buildRealtimeSessionUpdate(system)));
      // Tell the client which session id we landed on.
      try {
        client.send(JSON.stringify({ type: "ava.session", sessionId }));
      } catch { /* ignore */ }
      // Drain anything the client sent before upstream was ready, preserving
      // each frame's text/binary kind.
      for (const f of pendingFromClient) forwardFrame(upstream, f.data, f.isBinary);
      pendingFromClient.length = 0;
    });

    // ─── Client → Upstream ─────────────────────────────────────────────
    client.on("message", (data, isBinary) => {
      if (!upstreamReady) {
        pendingFromClient.push({ data, isBinary });
        return;
      }
      // Forward client events preserving text framing — the mic audio is
      // base64 inside a JSON text event, and OpenAI rejects binary frames.
      forwardFrame(upstream, data, isBinary);
    });

    // ─── Upstream → Client + transcript persistence + diagnostic logs ───
    upstream.on("message", (data, isBinary) => {
      try {
        if (client.readyState === WebSocket.OPEN) {
          // Preserve text framing: the browser client drops non-string messages.
          forwardFrame(client, data, isBinary);
        }
      } catch { /* client probably closed */ }

      // Best-effort persist; never let a parse error kill the proxy.
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        const evt = JSON.parse(text) as {
          type?: string;
          transcript?: string;
          item_id?: string;
          error?: { type?: string; code?: string; message?: string };
        };
        // Surface upstream errors and lifecycle events so we can see what
        // OpenAI is actually saying.
        if (evt.type === "error") {
          log.warn(
            `realtime upstream error event: code=${evt.error?.code} type=${evt.error?.type} message=${evt.error?.message}`,
          );
        } else if (evt.type === "session.created" || evt.type === "session.updated") {
          log.info(`realtime ${evt.type} (model=${REALTIME_MODEL})`);
        }
        const persist = persistTranscriptEvent(evt);
        if (persist) deps.appendMessage({ sessionId, ...persist });
      } catch {
        // Audio chunks etc. arrive as strings but we only persist on the
        // small JSON events; binary or non-JSON gets ignored here.
      }
    });

    // ─── Lifecycle ────────────────────────────────────────────────────
    upstream.on("close", (code, reason) => {
      const r = reason?.toString() || "(no reason)";
      log.info(`realtime upstream closed: code=${code} reason="${r}" model=${REALTIME_MODEL}`);
      // Forward the close reason to the client so the user sees something
      // actionable instead of "code=1000".
      try {
        client.send(JSON.stringify({
          type: "error",
          error: { message: `upstream closed (code=${code}): ${r}` },
        }));
      } catch { /* ignore */ }
      try { client.close(code, r); } catch { /* ignore */ }
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
