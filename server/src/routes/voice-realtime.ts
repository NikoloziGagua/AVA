import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Db } from "../state/db.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import { validateToken } from "../auth/tokens.js";
import {
  gateTranscript,
  loadTranscriptGateConfig,
  type TranscriptGateConfig,
  type TranscriptGateReason,
} from "../voice/transcript-gate.js";
import { getReasoningLevel, type ReasoningLevel } from "../state/reasoning-pref.js";
import { formatSpeechText } from "../voice/speechText.js";
import { DEFAULT_SPEECH_RATE } from "../voice/voiceConfig.js";
import { DEFAULT_VOICE } from "./voice-defaults.js";

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
 * The user-facing "Fast ↔ Thorough" reasoning toggle also tunes voice
 * responsiveness: how long server-VAD waits after the owner stops talking before
 * Ava replies. "fast" = snappy (jump in quickly); "thorough" = patient (wait so
 * she never talks over you). Other VAD fields (threshold/prefix) are unchanged.
 */
export function vadForReasoning(base: RealtimeVadConfig, level: ReasoningLevel): RealtimeVadConfig {
  return { ...base, silenceMs: level === "fast" ? 300 : 700 };
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

// ─── Hybrid (speech-to-speech + one action tool) ─────────────────────────────
//
// To match ChatGPT-style latency for conversation while keeping full
// capability, the realtime model SPEAKS directly (low latency) and is given a
// single tool, `do_on_computer`. For chitchat it just replies; when the owner
// asks for an action it calls the tool, the proxy runs the real /api/chat agent
// (full tools), and feeds the result back so the model speaks it. Silence
// hallucination stays gated by the same VAD tuning + input-transcript gate.

export const DO_ON_COMPUTER_TOOL = {
  type: "function" as const,
  name: "do_on_computer",
  description:
    "Perform an action on the owner's computer (open/find files, run commands, browse the web, " +
    "control apps, remember things, etc.). Use this whenever the owner asks you to DO something " +
    "rather than just chat. Pass a clear, complete task description in `task`. Do not attempt the " +
    "action yourself in conversation — always call this tool for actions.",
  parameters: {
    type: "object",
    properties: { task: { type: "string", description: "What to do, in plain language." } },
    required: ["task"],
  },
};

/**
 * Hybrid session.update: the realtime model speaks (audio out) AND can call
 * `do_on_computer`. VAD is tuned the same as transcribe-only so it won't answer
 * silence. Transcription stays on so we still get captions + can persist turns.
 */
export function buildHybridSessionUpdate(
  instructions: string,
  vad: RealtimeVadConfig = DEFAULT_REALTIME_VAD,
  voice = DEFAULT_VOICE,
) {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions,
      output_modalities: ["audio"],
      tools: [DO_ON_COMPUTER_TOOL],
      tool_choice: "auto",
      audio: {
        input: {
          format: { type: "audio/pcm", rate: 24000 },
          turn_detection: {
            type: "server_vad",
            threshold: vad.threshold,
            prefix_padding_ms: vad.prefixPaddingMs,
            silence_duration_ms: vad.silenceMs,
            // Still false: the model does NOT auto-reply. The proxy sends
            // `response.create` only AFTER the transcript passes the gate, so a
            // silence/noise blip can never trigger a spoken reply. The model
            // then speaks directly (fast) or calls do_on_computer.
            create_response: false,
            interrupt_response: false,
          },
          transcription: { model: vad.transcribeModel },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice,
          // Faster spoken delivery per Sir's preference (centralized default).
          speed: DEFAULT_SPEECH_RATE,
        },
      },
    },
  };
}

/**
 * If `evt` is a completed realtime function call (the model invoking a tool),
 * return its call id / name / parsed args; otherwise null. Handles the GA
 * `response.output_item.done` (item.type === "function_call") shape.
 */
export function readToolCall(
  evt: { type?: string; item?: { type?: string; call_id?: string; id?: string; name?: string; arguments?: string } },
): { callId: string; name: string; args: Record<string, unknown> } | null {
  if (evt.type !== "response.output_item.done") return null;
  const item = evt.item;
  if (!item || item.type !== "function_call") return null;
  const callId = item.call_id ?? item.id ?? "";
  let args: Record<string, unknown> = {};
  try { args = item.arguments ? (JSON.parse(item.arguments) as Record<string, unknown>) : {}; } catch { args = {}; }
  return { callId, name: item.name ?? "", args };
}

/** Build the upstream frames that return a tool result and ask the model to speak it. */
export function toolResultFrames(callId: string, output: string): string[] {
  return [
    JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } }),
    JSON.stringify({ type: "response.create" }),
  ];
}

// ─── Client-bound control frames (Ava-specific, not OpenAI events) ───────────
//
// The browser needs to know which mode the proxy is in: in HYBRID the realtime
// model speaks (client must play audio + must NOT re-route transcripts to
// /api/chat), in transcribe-only it stays text and the client owns the reply.
// We tell it on connect via the session hello frame's `mode`.

/** The first frame the client receives: its session id and the proxy's mode. */
export function sessionHelloFrame(sessionId: string | null, hybrid: boolean): string {
  return JSON.stringify({ type: "ava.session", sessionId, mode: hybrid ? "hybrid" : "transcribe" });
}

/** Sent (hybrid) when do_on_computer starts so the UI shows progress, not dead air. */
export function actionStartedFrame(task: string): string {
  return JSON.stringify({ type: "ava.action", task });
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

export interface ForwardDecision {
  /** Forward this frame to the browser? */
  forward: boolean;
  /** Was this a finished input-transcription event (vs. any other upstream event)? */
  isTranscript: boolean;
  /** For transcript events: did it pass the gate? */
  accept: boolean;
  reason: TranscriptGateReason | "not_transcript";
  text: string;
  speechMs: number | null;
}

/**
 * The single decision point for whether an upstream realtime event reaches the
 * browser. Non-transcript events pass through untouched. A finished transcript
 * is run through the gate: a rejected transcript is NOT forwarded, so the client
 * never emits a user turn and never calls /api/chat — i.e. silence and whisper
 * hallucinations can never become a real conversation turn.
 */
export function decideTranscriptForward(
  evt: {
    type?: string;
    transcript?: string;
    audio_end_ms?: number;
    logprobs?: Array<{ logprob?: number }> | null;
  },
  speechStartMs: number | null,
  gateConfig: TranscriptGateConfig,
): ForwardDecision {
  const tr = readTranscriptionCompleted(evt);
  if (!tr) {
    return { forward: true, isTranscript: false, accept: false, reason: "not_transcript", text: "", speechMs: null };
  }
  const speechMs = speechDurationMs(speechStartMs, evt);
  const verdict = gateTranscript(
    { text: tr.text, speechMs, avgLogprob: tr.avgLogprob },
    gateConfig,
  );
  return {
    forward: verdict.accept,
    isTranscript: true,
    accept: verdict.accept,
    reason: verdict.reason,
    text: verdict.text,
    speechMs,
  };
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
  /**
   * When provided, the proxy runs in HYBRID mode: the realtime model speaks
   * directly (fast conversation) and gets the do_on_computer tool; a tool call
   * runs this — the full /api/chat agent — and the result is spoken back. When
   * absent, the proxy stays transcribe-only (model never speaks).
   */
  runAction?: (sessionId: string | null, task: string) => Promise<{ text: string; sessionId: string | null }>;
  /** Voice for the realtime model's spoken output (hybrid mode). */
  voice?: string;
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
    const hybrid = !!deps.runAction;
    // In hybrid mode the proxy owns the action handoff; the session id is tracked
    // here and may be (re)assigned when an action turn creates one.
    let sessionId = requestedSessionId;

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
    // True while Ava is mid-response (between response.created and response.done).
    // A transcript that lands during this window is almost always a hallucination
    // / echo, and starting a new response would cut Ava off — so we ignore it.
    let responseActive = false;
    const pendingFromClient: Array<{ data: RawData; isBinary: boolean }> = [];
    log.info("realtime: client connected, opening upstream to gpt-realtime (transcribe-only)");

    upstream.on("open", () => {
      upstreamReady = true;
      // The reasoning toggle ("fast"/"thorough") also controls voice snappiness.
      const vad = vadForReasoning(vadConfig, getReasoningLevel(deps.db));
      log.info(`realtime: upstream open, sending ${hybrid ? "hybrid (speak+tool)" : "transcribe-only"} session.update (vad silence=${vad.silenceMs}ms)`);
      // Configure the realtime session on connect.
      const system = buildSystemPrompt({
        memoryDir: deps.memoryDir,
        mode: "conversation",
      });
      const sessionUpdate = hybrid
        ? buildHybridSessionUpdate(
            system +
              "\n\n[VOICE] You are speaking aloud — keep replies short and natural. Say \"Sir\" " +
              "smoothly, as part of the phrase, without a comma pause around it (\"Yes Sir\", not " +
              "\"Yes, Sir,\"). When the owner " +
              "asks you to DO something on the computer (open/find files, run commands, browse, " +
              "control apps, remember something), CALL do_on_computer with a clear task, then speak " +
              "the result it returns. For everything else, just reply directly in your own voice.",
            vad,
            deps.voice ?? DEFAULT_VOICE,
          )
        : buildRealtimeSessionUpdate(system, vad);
      upstream.send(JSON.stringify(sessionUpdate));
      // Echo the client's current session id back, and tell it the proxy mode so
      // it knows whether to play audio (hybrid) or own the reply (transcribe).
      try {
        client.send(sessionHelloFrame(sessionId, hybrid));
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
        } else if (evt.type === "response.created") {
          responseActive = true;
        } else if (evt.type === "response.done") {
          responseActive = false;
        } else if (evt.type === "error") {
          log.warn(
            `realtime upstream error event: code=${evt.error?.code} type=${evt.error?.type} message=${evt.error?.message}`,
          );
        } else if (evt.type === "session.created" || evt.type === "session.updated") {
          log.info(`realtime ${evt.type} (model=${REALTIME_MODEL})`);
        }
      }

      // Hybrid: the model called do_on_computer → run the real /api/chat agent
      // and feed the result back so the model speaks it.
      if (hybrid && evt) {
        const call = readToolCall(evt);
        if (call && call.name === "do_on_computer" && deps.runAction) {
          const task = String((call.args as { task?: unknown }).task ?? "");
          log.info(`realtime: do_on_computer task=${JSON.stringify(task)}`);
          // Tell the client an action started so it can show progress instead of
          // dead air while the (possibly multi-second) agent run executes.
          try { client.send(actionStartedFrame(task)); } catch { /* */ }
          void (async () => {
            try {
              const r = await deps.runAction!(sessionId, task);
              sessionId = r.sessionId ?? sessionId;
              try { client.send(sessionHelloFrame(sessionId, hybrid)); } catch { /* */ }
              // formatSpeechText smooths "Sir" punctuation only in what the
              // realtime model speaks; the agent's persisted reply is untouched.
              for (const f of toolResultFrames(call.callId, formatSpeechText(r.text || "Done."))) upstream.send(f);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              for (const f of toolResultFrames(call.callId, formatSpeechText(`That didn't work, Sir — ${msg}`))) upstream.send(f);
            }
          })();
          return; // don't forward the raw function_call item to the client
        }
      }

      // Gate finished transcripts: a rejected one is dropped here and NEVER
      // reaches the browser, so silence/noise produces no user turn at all.
      const decision = evt
        ? decideTranscriptForward(evt, speechStartMs, gateConfig)
        : null;
      if (decision?.isTranscript) {
        speechStartMs = null; // consume the in-flight utterance's timing
        // Log the reason code only — never the raw audio. Transcript text is
        // short and useful for tuning; audio append frames are never logged.
        if (!decision.forward) {
          log.info(
            `realtime: dropped transcript reason=${decision.reason} speechMs=${decision.speechMs ?? "?"} text=${JSON.stringify(decision.text)}`,
          );
          return; // do not forward — no phantom turn, no /api/chat call
        }
        if (hybrid && responseActive) {
          // Ava is still speaking. A transcript now is almost always a
          // hallucination / echo / noise — starting a new response would cut her
          // off mid-sentence (the reported bug). Drop it: no interrupt, and no
          // phantom "you" caption on the client.
          log.info(`realtime: ignored transcript while Ava is speaking (no interrupt): ${JSON.stringify(decision.text)}`);
          return;
        }
        log.info(`realtime: accepted transcript text=${JSON.stringify(decision.text)}`);
        if (hybrid) {
          // Model didn't auto-reply (create_response:false). Now that the
          // transcript passed the gate, ask it to respond — speak or call a tool.
          responseActive = true; // optimistic; confirmed by response.created
          try { upstream.send(JSON.stringify({ type: "response.create" })); } catch { /* */ }
        }
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
