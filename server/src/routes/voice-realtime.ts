import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Db } from "../state/db.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import { validateToken } from "../auth/tokens.js";
import {
  gateTranscript,
  loadTranscriptGateConfig,
  type TranscriptGateConfig,
} from "../voice/transcript-gate.js";

// ─── OpenAI Realtime API: TRANSCRIBE-ONLY proxy ──────────────────────────────
//
// This proxy used to run the realtime model speech-to-speech: it generated the
// audio reply itself, with no tools. That made voice (a) hallucinate replies to
// silence and (b) far less capable than text chat, which routes through the
// full tool-using agent.
//
// It is now a transcription service only:
//   - `create_response: false` — the realtime model NEVER speaks. We use it
//     purely for low-latency server-VAD endpointing + speech-to-text.
//   - Every finished transcript is run through `gateTranscript` so silence /
//     noise hallucinations ("you", "Thank you.") are dropped server-side and
//     never reach the client.
//   - Accepted transcripts are forwarded to the browser, which submits them to
//     the SAME `POST /api/chat` agent path that typed messages use (full tool
//     stack, approvals, playbooks) and speaks the reply via TTS.
//
// Event types we care about (server → client):
//     - session.created / session.updated
//     - input_audio_buffer.speech_started / .speech_stopped (server VAD)
//     - conversation.item.input_audio_transcription.completed  (gated here)
//     - error

// gpt-4o-realtime-preview returned server_error on this account — likely a
// gate on the older preview SKU. The GA gpt-realtime model is enabled where
// gpt-5.x is, which is what we have. Override via REALTIME_MODEL env var.
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime";
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;

export interface RealtimeVadConfig {
  /** Transcription model. gpt-4o-transcribe hallucinates far less than whisper-1. */
  transcribeModel: string;
  /** server_vad energy threshold 0..1 — higher ignores more background noise. */
  threshold: number;
  /** Audio kept before speech onset, ms. */
  prefixPaddingMs: number;
  /** Trailing silence that ends an utterance, ms (min silence duration). */
  silenceMs: number;
}

export const DEFAULT_REALTIME_VAD: RealtimeVadConfig = {
  transcribeModel: "gpt-4o-transcribe",
  threshold: 0.6,
  prefixPaddingMs: 300,
  silenceMs: 600,
};

/** Build VAD config from env overrides (REALTIME_TRANSCRIBE_MODEL, REALTIME_VAD_*). */
export function loadRealtimeVadConfig(
  env: Record<string, string | undefined> = process.env,
): RealtimeVadConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw == null || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    transcribeModel: env.REALTIME_TRANSCRIBE_MODEL || DEFAULT_REALTIME_VAD.transcribeModel,
    threshold: num("REALTIME_VAD_THRESHOLD", DEFAULT_REALTIME_VAD.threshold),
    prefixPaddingMs: num("REALTIME_VAD_PREFIX_PADDING_MS", DEFAULT_REALTIME_VAD.prefixPaddingMs),
    silenceMs: num("REALTIME_VAD_SILENCE_MS", DEFAULT_REALTIME_VAD.silenceMs),
  };
}

/**
 * GA `gpt-realtime` session.update payload, configured for TRANSCRIBE-ONLY use.
 *
 * Key points:
 *   - `output_modalities: ["text"]` and `turn_detection.create_response: false`
 *     ensure the realtime model produces no audio/auto-reply — we only want its
 *     VAD + transcription. (No `audio.output` block is needed without audio out.)
 *   - VAD `threshold` / `prefix_padding_ms` / `silence_duration_ms` are tuned to
 *     ignore background noise and require a real trailing pause to end a turn.
 *   - The GA model uses the NESTED audio schema (not the beta-flat
 *     `modalities`/`voice`/`input_audio_transcription` fields, which it rejects).
 */
export function buildRealtimeSessionUpdate(
  instructions: string,
  vad: RealtimeVadConfig = DEFAULT_REALTIME_VAD,
) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions,
      output_modalities: ["text"],
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          turn_detection: {
            type: "server_vad",
            threshold: vad.threshold,
            prefix_padding_ms: vad.prefixPaddingMs,
            silence_duration_ms: vad.silenceMs,
            // The realtime model must not answer — voice replies come from the
            // text agent over /api/chat. This is the core "no auto-reply to
            // silence" guarantee on the upstream side.
            create_response: false,
            interrupt_response: false,
          },
          transcription: { model: vad.transcribeModel },
        },
      },
    },
  };
}

/**
 * If `evt` is a finished user input-transcription event, pull out the transcript
 * plus any confidence signals the transcriber attached; otherwise return null.
 *
 * gpt-4o-transcribe may include per-segment `logprobs`; we average them so the
 * gate can reject very-low-confidence garbage. whisper-1 typically omits them,
 * in which case the gate falls back to its text/duration heuristics.
 */
export function readTranscriptionCompleted(
  evt: { type?: string; transcript?: string; logprobs?: Array<{ logprob?: number }> | null },
): { text: string; avgLogprob: number | null } | null {
  if (evt.type !== "conversation.item.input_audio_transcription.completed") return null;
  const text = evt.transcript ?? "";
  let avgLogprob: number | null = null;
  if (Array.isArray(evt.logprobs) && evt.logprobs.length > 0) {
    const vals = evt.logprobs
      .map((l) => (typeof l?.logprob === "number" ? l.logprob : null))
      .filter((v): v is number => v != null);
    if (vals.length > 0) avgLogprob = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return { text, avgLogprob };
}

/** Compute speech-segment duration (ms) from a VAD speech_stopped event. */
export function speechDurationMs(
  startMs: number | null,
  evt: { audio_end_ms?: number },
): number | null {
  if (startMs == null) return null;
  if (typeof evt.audio_end_ms === "number") return Math.max(0, evt.audio_end_ms - startMs);
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
  /** Optional override for the transcript gate (tests). Defaults to env config. */
  gateConfig?: TranscriptGateConfig;
  /** Optional override for VAD/transcription config (tests). Defaults to env. */
  vadConfig?: RealtimeVadConfig;
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
  const gateConfig = deps.gateConfig ?? loadTranscriptGateConfig();
  const vadConfig = deps.vadConfig ?? loadRealtimeVadConfig();
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
    // The proxy no longer owns the conversation — it neither creates nor
    // persists sessions. The browser submits accepted transcripts to
    // /api/chat, which creates/titles the session and persists both turns.
    // We just echo the client's current session id back so it has continuity.
    const sessionId = requestedSessionId;

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
    // VAD onset timestamp of the in-flight utterance, used to measure speech
    // duration so the gate can drop sub-threshold blips.
    let speechStartMs: number | null = null;
    const pendingFromClient: Array<{ data: RawData; isBinary: boolean }> = [];
    log.info("realtime: client connected, opening upstream to gpt-realtime (transcribe-only)");

    upstream.on("open", () => {
      upstreamReady = true;
      log.info("realtime: upstream open, sending transcribe-only session.update");
      // Configure the realtime session on connect.
      const system = buildSystemPrompt({
        memoryDir: deps.memoryDir,
        mode: "conversation",
      });
      upstream.send(JSON.stringify(buildRealtimeSessionUpdate(system, vadConfig)));
      // Echo the client's current session id back.
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

    // ─── Upstream → Client (with transcript gating + diagnostics) ───────
    upstream.on("message", (data, isBinary) => {
      let evt:
        | {
            type?: string;
            transcript?: string;
            audio_start_ms?: number;
            audio_end_ms?: number;
            logprobs?: Array<{ logprob?: number }> | null;
            error?: { type?: string; code?: string; message?: string };
          }
        | null = null;
      try {
        const text = typeof data === "string" ? data : data.toString("utf8");
        evt = JSON.parse(text);
      } catch {
        evt = null; // non-JSON/binary frame
      }

      // Track VAD timing + surface lifecycle/errors. Never throw out of here.
      if (evt) {
        if (evt.type === "input_audio_buffer.speech_started") {
          speechStartMs = typeof evt.audio_start_ms === "number" ? evt.audio_start_ms : 0;
        } else if (evt.type === "error") {
          log.warn(
            `realtime upstream error event: code=${evt.error?.code} type=${evt.error?.type} message=${evt.error?.message}`,
          );
        } else if (evt.type === "session.created" || evt.type === "session.updated") {
          log.info(`realtime ${evt.type} (model=${REALTIME_MODEL})`);
        }
      }

      // Gate finished transcripts: a rejected one is dropped here and NEVER
      // reaches the browser, so silence/noise produces no user turn at all.
      const tr = evt ? readTranscriptionCompleted(evt) : null;
      if (tr) {
        const speechMs = evt ? speechDurationMs(speechStartMs, evt) : null;
        speechStartMs = null;
        const verdict = gateTranscript(
          { text: tr.text, speechMs, avgLogprob: tr.avgLogprob },
          gateConfig,
        );
        if (!verdict.accept) {
          log.info(
            `realtime: dropped transcript (${verdict.reason}) speechMs=${speechMs ?? "?"} text=${JSON.stringify(tr.text)}`,
          );
          return; // do not forward — no phantom turn
        }
        log.info(`realtime: accepted transcript text=${JSON.stringify(verdict.text)}`);
        // fall through to forward the (accepted) transcript verbatim
      }

      // Forward everything else (and accepted transcripts) verbatim, preserving
      // text framing — the browser drops non-string messages.
      try {
        if (client.readyState === WebSocket.OPEN) forwardFrame(client, data, isBinary);
      } catch { /* client probably closed */ }
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
