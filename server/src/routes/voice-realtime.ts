import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Db } from "../state/db.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import { validateToken } from "../auth/tokens.js";
import { createSession, touchSession, listSessions } from "../state/sessions.js";
import { appendMessage, listMessages } from "../state/messages.js";
import { readDevLog, type DevLogEntry } from "../self/dev-log.js";
import { dirname } from "node:path";
import {
  gateTranscript,
  loadTranscriptGateConfig,
  type TranscriptGateConfig,
  type TranscriptGateReason,
} from "../voice/transcript-gate.js";
import { getReasoningLevel, type ReasoningLevel } from "../state/reasoning-pref.js";
import { getVoiceEngine } from "../state/voice-engine-pref.js";
import { formatSpeechText } from "../voice/speechText.js";
import { DEFAULT_SPEECH_RATE } from "../voice/voiceConfig.js";
import { DEFAULT_VOICE } from "./voice-defaults.js";
import {
  resolveVoiceProvider,
  describeVoiceProvider,
  redactSecrets,
  buildHumeRealtimeUrl,
  resolveHumeWsUrl,
  type VoiceProviderConfig,
  type HumeProviderConfig,
} from "./voice-provider-config.js";

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
  // "fast" was 300ms, which ended a turn on a natural mid-sentence pause — Ava
  // barged into the OWNER. 500ms rides through those short pauses while still
  // feeling snappy; real responsiveness now comes from voice barge-in (the owner
  // can talk over her) rather than an ultra-short endpoint. Both stay env-tunable.
  return { ...base, silenceMs: level === "fast" ? 500 : 700 };
}

/**
 * Build the realtime session's `turn_detection` block. In VAD mode this is the
 * tuned `server_vad` config (auto endpointing, never auto-replies). In Enter
 * push-to-talk mode it is `null`: automatic VAD/turn-detection is DISABLED, so
 * the server never decides a turn started or ended from the audio. The client
 * owns turn boundaries — it forwards mic audio only while a turn is held and
 * sends an explicit `input_audio_buffer.commit` to finish it. This is what keeps
 * background/external audio between turns from ever becoming a turn.
 */
export function turnDetectionFor(vad: RealtimeVadConfig, pushToTalk: boolean) {
  if (pushToTalk) return null;
  return {
    type: "server_vad" as const,
    threshold: vad.threshold,
    prefix_padding_ms: vad.prefixPaddingMs,
    silence_duration_ms: vad.silenceMs,
    // The realtime model must not answer on its own — voice replies come from
    // the text agent (transcribe) or after the gate (hybrid).
    create_response: false,
    interrupt_response: false,
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
  opts: { pushToTalk?: boolean } = {},
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
          // server_vad in VAD mode; null (no auto endpointing) in push-to-talk.
          turn_detection: turnDetectionFor(vad, !!opts.pushToTalk),
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

/**
 * Spoken-conversation persona, appended to the base system prompt for any
 * speaking provider (OpenAI hybrid + Hume). Tuned for warm, curious, natural
 * talk with snappy pacing: short replies, no long pauses, and "Sir" said
 * smoothly as part of the phrase rather than as a dramatic, comma-walled aside.
 */
export const VOICE_PERSONA_INSTRUCTIONS =
  "\n\n[VOICE] You're speaking aloud in a live conversation. Be warm, curious, and natural — " +
  "like a sharp friend, not a formal assistant. Keep replies short and conversational, and keep " +
  "your pacing quick: start talking right away, don't leave long pauses before or after you speak. " +
  "Say \"Sir\" naturally, woven smoothly into the phrase without a comma pause or dramatic emphasis " +
  "around it (\"Yes Sir\", not \"Yes, Sir,\"). When the owner asks you to DO something on the " +
  "computer (open/find files, run commands, browse, control apps, remember something), CALL " +
  "do_on_computer with a clear task and do NOT speak the steps or the result yourself — the system " +
  "narrates each step and speaks the result aloud. After the tool returns, stay silent unless Sir " +
  "asks a follow-up. If Sir asks how it went WHILE the task is still running, say you're still " +
  "working on it — never say it's \"done\" and never invent results before the system has actually " +
  "spoken them. You are AVA — a specific AI agent living on Sir's Windows PC, not a generic chatbot: " +
  "NEVER describe yourself in terms of an LLM 'training cutoff' or 'my training data'. When Sir asks " +
  "about your latest update, recent changes, self-improvement, or what Claude has been building, CALL " +
  "do_on_computer with the task 'read and summarize my recent Claude update log' — the system has your " +
  "exact changelog; never recite from memory or guess (a short summary is in this prompt for context, " +
  "but the tool has the authoritative, current list). For everything else (chit-chat, questions), just " +
  "reply directly in your own voice.";

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
  opts: { pushToTalk?: boolean } = {},
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
          // server_vad (proxy sends response.create only after the gate passes)
          // in VAD mode; null (client-driven commit) in push-to-talk.
          turn_detection: turnDetectionFor(vad, !!opts.pushToTalk),
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

// ─── Hume EVI provider (alternative upstream, selected via AVA_VOICE_PROVIDER) ─
//
// When AVA_VOICE_PROVIDER=hume (and HUME_API_KEY is set) the proxy speaks Hume's
// EVI websocket instead of OpenAI's. Hume has a different wire protocol, so the
// proxy translates the events the browser cares about into the SAME OpenAI-shaped
// frames the web client already understands (classifyRealtimeEvent), keeping the
// front-end provider-agnostic. If the Hume socket can't be established, the proxy
// falls back to the proven OpenAI path. NOTHING here logs a secret value.

/**
 * Build Hume EVI `session_settings`: the system prompt and the chosen voice. The
 * voice is pinned by exact id when `HUME_VOICE_ID` is set (most reliable),
 * otherwise by name (defaults to "Alice Bennett"). PCM16 @ 24k matches the audio
 * format the browser path already uses for OpenAI, so playback is unchanged.
 */
export function buildHumeSessionSettings(
  instructions: string,
  hume: HumeProviderConfig,
  contextText = "",
) {
  const voice = hume.voiceId
    ? { provider: "HUME_AI" as const, id: hume.voiceId }
    : { provider: "HUME_AI" as const, name: hume.voiceName };
  const settings: {
    type: "session_settings";
    system_prompt: string;
    voice: { provider: "HUME_AI"; id?: string; name?: string };
    audio: { encoding: "linear16"; sample_rate: number; channels: number };
    context?: { text: string; type: "persistent" };
  } = {
    type: "session_settings",
    system_prompt: instructions,
    voice,
    audio: { encoding: "linear16", sample_rate: 24000, channels: 1 },
  };
  // `context` is an UNVERIFIED backup channel for recollection. What IS verified:
  // Hume TRUNCATES the long (~12k char) system prompt, so anything past the cut is
  // silently dropped. The caller now defends against that in the prompt itself
  // (buildHumeVoicePrompt puts identity + updates + history first, under budget) and
  // ALSO mirrors the recollection here — whether Hume honors `context` is unconfirmed,
  // so the prompt is the guaranteed channel and this is belt-and-suspenders.
  // type:"persistent" keeps it across turns if Hume does honor it.
  if (contextText.trim()) settings.context = { text: contextText, type: "persistent" };
  return settings;
}

/**
 * Build a "recent conversation" block so Hume has the SAME recollection as the
 * OpenAI path (which seeds the last-N turns as conversation items). Whether Hume
 * honors session_settings.context is unverified, so the caller now seeds this block
 * BOTH ways — folded into the (compact, identity-first, budget-capped) system_prompt
 * AND in the `context` field — so recollection survives regardless. Pure + testable.
 * Returns "" when there's nothing to seed.
 */
export function buildHumeHistoryBlock(
  messages: Array<{ role: string; content: string }>,
  maxTurns: number,
): string {
  const turns = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-maxTurns);
  if (turns.length === 0) return "";
  const lines = turns
    .map((m) => `${m.role === "user" ? "Sir" : "You (Ava)"}: ${m.content}`)
    .join("\n");
  return (
    "\n\n# Recent conversation (most recent last) — you remember all of this; " +
    "continue it naturally and never act like it's a fresh start:\n" +
    lines
  );
}

/**
 * Build a "your actual recent updates" block from the Claude→Ava dev log so the
 * voice model can answer "what's your latest update / self-improvement?" with
 * Ava's REAL changelog instead of confabulating LLM-training facts. Pure +
 * testable. Returns "" when the log has no shipped entries.
 */
export function buildVoiceUpdatesBlock(entries: DevLogEntry[]): string {
  const shipped = entries.filter((e) => e.phase === "shipped" || e.phase === "note");
  if (shipped.length === 0) return "";
  const lines = shipped.slice(-6).map((e) => `- ${e.title}`).join("\n");
  return (
    "\n\n# Your ACTUAL recent updates (real changes Claude — Sir's coding agent — " +
    "shipped to your code; THIS is your changelog, not your training data). When " +
    "Sir asks about your latest update or self-improvement, answer from THIS list:\n" +
    lines
  );
}

/** Hume EVI truncates the system prompt at ~12k chars, silently dropping whatever
 *  is past the cut. The OLD assembly put the big base prompt FIRST, so the things
 *  that actually fix the recall/identity bug — the voice persona (anti-confabulation
 *  + "you are AVA"), the real changelog, and recent history — were appended last and
 *  cut away. This assembles the prompt in PRIORITY order under a safe budget so the
 *  critical front always survives: identity → real updates → recent history → the
 *  (compact) persona/prefs/observations base, which absorbs the trim. Pure + testable. */
export function buildHumeVoicePrompt(
  parts: { voicePersona: string; updates: string; history: string; base: string },
  budget = 11000,
): string {
  const ordered = [parts.voicePersona, parts.updates, parts.history, parts.base]
    .map((s) => s.trim())
    .filter(Boolean);
  let out = "";
  for (const blk of ordered) {
    if (!out) { out = blk.slice(0, budget); continue; }
    const room = budget - out.length - 2; // 2 for the "\n\n" join
    if (room <= 0) break;
    out += "\n\n" + (blk.length <= room ? blk : blk.slice(0, room));
    if (blk.length > room) break; // budget exhausted mid-block
  }
  return out;
}

/** What a translated Hume event tells the proxy to do. `frames` are JSON strings
 *  in the OpenAI-shaped client protocol; the optional fields drive persistence /
 *  the gate / the action handoff, mirroring the OpenAI branch's side effects. */
export interface HumeTranslation {
  /** Client-bound frames (already OpenAI-shaped) to forward verbatim. */
  frames: string[];
  /** A finished user utterance (subject to the same transcript gate). */
  userTranscript?: string;
  /** One SEGMENT of the assistant's spoken turn (Hume emits several per turn). The
   *  proxy buffers these and persists the whole turn as one message on `turnEnd`. */
  assistantText?: string;
  /** The spoken turn finished (assistant_end) or was cut off (user_interruption) —
   *  flush the buffered assistant segments to one message row. */
  turnEnd?: boolean;
  /** The model asked to act on the computer. */
  toolCall?: { callId: string; name: string; args: Record<string, unknown> };
}

/** The sample rate the browser audio player assumes for the PCM16 deltas it
 *  plays (same rate the OpenAI realtime path uses). */
export const CLIENT_PCM_RATE = 24000;

/** Box-filter resample mono PCM16 from srcRate to dstRate. Averages the source
 *  samples spanned by each output sample, so a 2:1 downsample (Hume's 48k→24k)
 *  also low-passes instead of bare decimation (less aliasing). */
export function resamplePcm16(pcm: Buffer, srcRate: number, dstRate: number): Buffer {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return Buffer.alloc(0);
  if (srcRate === dstRate) return pcm.subarray(0, n * 2);
  const dstN = Math.max(1, Math.floor((n * dstRate) / srcRate));
  const out = Buffer.alloc(dstN * 2);
  const step = srcRate / dstRate;
  for (let i = 0; i < dstN; i++) {
    const s0 = Math.floor(i * step);
    const s1 = Math.min(n, Math.max(s0 + 1, Math.ceil((i + 1) * step)));
    let sum = 0, cnt = 0;
    for (let j = s0; j < s1; j++) { sum += pcm.readInt16LE(j * 2); cnt++; }
    let v = cnt > 0 ? Math.round(sum / cnt) : 0;
    if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
    out.writeInt16LE(v, i * 2);
  }
  return out;
}

/**
 * Hume EVI returns each `audio_output` as a self-contained WAV clip at 48 kHz
 * 16-bit mono. The browser plays raw PCM16 at {@link CLIENT_PCM_RATE} (24 kHz), so
 * playing the WAV bytes verbatim makes Ava sound an octave low and half speed (and
 * clicks on the header). This strips the WAV container, reads its real sample rate,
 * and resamples the PCM to 24 kHz — returning base64 raw PCM16 the client plays
 * correctly. Non-WAV input (already raw PCM) passes through unchanged. Pure.
 */
export function humeAudioChunkToClientPcm(b64: string): string {
  if (!b64) return "";
  const buf = Buffer.from(b64, "base64");
  // Not a WAV → assume it is already client-rate PCM16; pass through.
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return b64;
  }
  let sampleRate = 48000;
  let dataOff = -1, dataLen = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt " && off + 24 <= buf.length) {
      sampleRate = buf.readUInt32LE(off + 12);
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
      break;
    }
    off += 8 + size + (size & 1); // chunks are word-aligned
  }
  if (dataOff < 0) return ""; // malformed — drop rather than play garbage
  const pcm = buf.subarray(dataOff, Math.min(dataOff + dataLen, buf.length));
  return resamplePcm16(pcm, sampleRate, CLIENT_PCM_RATE).toString("base64");
}

/**
 * Translate one inbound Hume EVI message into the OpenAI-shaped frames the web
 * client already handles, plus any side-effect signals. Unknown/irrelevant
 * messages translate to no frames. Pure + total so it is unit-testable without a
 * live Hume socket.
 */
export function translateHumeEvent(evt: {
  type?: string;
  data?: string;
  message?: { role?: string; content?: string };
  tool_call_id?: string;
  name?: string;
  parameters?: string;
  slug?: string;
}): HumeTranslation {
  switch (evt.type) {
    case "audio_output": {
      // Hume sends a 48kHz WAV clip; convert to the 24kHz raw PCM16 the client
      // plays, or it comes out an octave low and half speed.
      const delta = humeAudioChunkToClientPcm(evt.data ?? "");
      return { frames: delta ? [JSON.stringify({ type: "response.output_audio.delta", delta })] : [] };
    }
    case "user_message": {
      const text = evt.message?.content ?? "";
      // Surface as the OpenAI input-transcription event; the proxy still runs it
      // through the transcript gate before it becomes a real turn.
      return { frames: [], userTranscript: text };
    }
    case "assistant_message": {
      const text = evt.message?.content ?? "";
      return {
        frames: text ? [JSON.stringify({ type: "response.output_audio_transcript.done", transcript: text })] : [],
        assistantText: text,
      };
    }
    case "assistant_end":
      return { frames: [JSON.stringify({ type: "response.done" })], turnEnd: true };
    case "user_interruption":
      // Barge-in: the spoken turn was cut off. Flush whatever Ava already said as
      // one row (it WAS spoken) so it isn't lost or merged into the next turn.
      return { frames: [], turnEnd: true };
    case "tool_call": {
      let args: Record<string, unknown> = {};
      try { args = evt.parameters ? (JSON.parse(evt.parameters) as Record<string, unknown>) : {}; } catch { args = {}; }
      return { frames: [], toolCall: { callId: evt.tool_call_id ?? "", name: evt.name ?? "", args } };
    }
    case "error":
      return { frames: [JSON.stringify({ type: "error", error: { message: evt.message?.content ?? evt.slug ?? "hume error" } })] };
    default:
      // assistant_prosody, chat_metadata, etc. — nothing the client needs.
      // (user_interruption has its own case above.)
      return { frames: [] };
  }
}

/** Hume's tool-result frame: report a tool_response back so the model can speak it. */
export function humeToolResultFrame(callId: string, output: string): string {
  return JSON.stringify({ type: "tool_response", tool_call_id: callId, content: output });
}

/**
 * Translate a browser → proxy frame (OpenAI-shaped) into the Hume input frame.
 * The mic audio arrives as `input_audio_buffer.append` with base64 PCM; Hume
 * wants `audio_input` with `data`. Control frames Hume doesn't need (commit,
 * etc.) translate to null and are simply dropped. Pure for unit-testing.
 */
export function translateClientFrameToHume(raw: string): string | null {
  let evt: { type?: string; audio?: unknown } | null = null;
  try { evt = JSON.parse(raw); } catch { return null; }
  if (evt?.type === "input_audio_buffer.append" && typeof evt.audio === "string") {
    return JSON.stringify({ type: "audio_input", data: evt.audio });
  }
  return null;
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

/** When hybrid voice connects WITHOUT a session id (e.g. entering voice from the
 *  home orb), decide whether to resume an existing conversation or start fresh.
 *  Default is to RESUME the most-recent session so voice↔chat share one continuous
 *  memory ("ask in voice → finish in chat → ask in voice again, it remembers").
 *  `wantNew` (the client's "+new conversation" control → `?new=1`) forces a fresh
 *  session. Pure so the resume/new choice is unit-testable without a socket;
 *  `resumeId === null` means the caller should create a new session. */
export function chooseResumeOrNew(wantNew: boolean, mostRecentId: string | null): { resumeId: string | null } {
  return { resumeId: wantNew ? null : mostRecentId };
}

/** Content-part type for seeding a stored turn into the realtime model via
 *  `conversation.item.create`. The GA realtime schema is asymmetric: user/system
 *  turns use `input_text`, assistant turns use `output_text` (sending `text` for
 *  an assistant turn is rejected with "Value must be 'output_text'"). */
export function seedContentType(role: string): "input_text" | "output_text" {
  return role === "assistant" ? "output_text" : "input_text";
}

/** Sent (hybrid) when do_on_computer starts so the UI shows progress, not dead air. */
export function actionStartedFrame(task: string): string {
  return JSON.stringify({ type: "ava.action", task });
}

/** Sent (hybrid) per agent tool call so the client can narrate each step via TTS. */
export function stepFrame(tool: string, args: unknown): string {
  return JSON.stringify({ type: "ava.step", tool, args });
}

/** Sent (hybrid) with the task's final result; the client speaks it via TTS. */
export function actionResultFrame(text: string): string {
  return JSON.stringify({ type: "ava.result", text });
}

/**
 * Sent when the owner talks OVER Ava (voice barge-in): the proxy has cancelled
 * her in-flight response upstream, and this tells the client to stop playing her
 * audio locally and open the new turn instead of letting her tail keep speaking.
 */
export function bargeInFrame(): string {
  return JSON.stringify({ type: "ava.barge_in" });
}

/**
 * Sent when a PUSH-TO-TALK commit is dropped at the gate (e.g. it transcribed to
 * nothing). The client sits in "thinking" after a commit; without this it would
 * wait for the recovery timer. This lets it recover to "listening" deterministically
 * with a soft "didn't catch that" hint the instant the proxy knows there's no reply.
 */
export function recoverFrame(reason: string): string {
  return JSON.stringify({ type: "ava.recover", reason });
}

/**
 * Satisfy the model's do_on_computer call WITHOUT a response.create, so the
 * realtime model stays silent — the client narrates the steps and speaks the
 * result instead (one voice per task). Contrast toolResultFrames, which also
 * asks the model to speak.
 */
export function silentToolResultFrame(callId: string, output: string): string {
  return JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } });
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
  pushToTalk = false,
): ForwardDecision {
  const tr = readTranscriptionCompleted(evt);
  if (!tr) {
    return { forward: true, isTranscript: false, accept: false, reason: "not_transcript", text: "", speechMs: null };
  }
  const speechMs = speechDurationMs(speechStartMs, evt);
  const verdict = gateTranscript(
    { text: tr.text, speechMs, avgLogprob: tr.avgLogprob, pushToTalk },
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
  runAction?: (sessionId: string | null, task: string, onStep?: (tool: string, args: unknown) => void, signal?: AbortSignal) => Promise<{ text: string; sessionId: string | null }>;
  /** Voice for the realtime model's spoken output (hybrid mode). */
  voice?: string;
  /**
   * Which realtime upstream to speak. Defaults to resolving from the environment
   * (`AVA_VOICE_PROVIDER`, Hume keys) at proxy-build time. OpenAI is the default
   * and the fallback; Hume is used only when fully configured.
   */
  providerConfig?: VoiceProviderConfig;
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
  const providerConfig = deps.providerConfig ?? resolveVoiceProvider();
  // Log only the NON-secret shape of the provider choice (never the API key).
  log.info("realtime: voice provider", describeVoiceProvider(providerConfig));
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
      // "+new conversation" control: force a fresh session instead of resuming.
      const wantNew = url.searchParams.get("new") === "1";
      // Endpointing mode picked by the client. "enter_push_to_talk" disables the
      // server's automatic VAD/turn-detection for this session; anything else
      // (incl. absent) keeps the default VAD behaviour.
      const pushToTalk = url.searchParams.get("inputMode") === "enter_push_to_talk";

      wss.handleUpgrade(req, socket, head, (ws) => {
        startSession(ws, sessionIdParam, deviceId, pushToTalk, wantNew).catch((err) => {
          log.error("realtime session error:", err instanceof Error ? err.message : err);
          try { ws.close(1011, "session error"); } catch { /* ignore */ }
        });
      });
    });
  }

  async function startSession(client: WebSocket, requestedSessionId: string | null, _deviceId: string, pushToTalk = false, wantNew = false) {
    // PROVIDER BRANCH. The dashboard voice toggle (voice_engine_pref) selects the
    // provider, read here at connect so a toggle change takes effect on reconnect.
    // When the toggle is "hume" AND Hume is configured (HUME_API_KEY in env), try
    // Hume first; if its socket can't be established, fall through to the proven
    // OpenAI path below. No client handlers are attached until Hume actually opens,
    // so a failed attempt leaves the connection clean for the OpenAI fallback.
    if (getVoiceEngine(deps.db) === "hume" && providerConfig.hume) {
      // Resolve the upstream URL here (async): prefers OAuth access-token auth when
      // a secret key is set, else the raw api_key. Done before the session Promise
      // so the executor stays synchronous.
      const humeUrl = await resolveHumeWsUrl(providerConfig.hume);
      const opened = await tryStartHumeSession(client, requestedSessionId, providerConfig.hume, humeUrl, pushToTalk);
      if (opened) return;
      log.warn("realtime: hume upstream did not establish — falling back to OpenAI");
    }
    // The realtime model always speaks for the OpenAI provider (hybrid: it speaks
    // chitchat AND routes do_on_computer to the full agent).
    const hybrid = !!deps.runAction;
    // In hybrid mode the proxy owns the action handoff; the session id is tracked
    // here and may be (re)assigned when an action turn creates one.
    let sessionId = requestedSessionId;
    // Aborts any in-flight do_on_computer agent run when THIS connection drops, so
    // a mid-task disconnect (1006) doesn't leave a zombie run burning tokens and
    // holding the shared browser — and so a reconnect starts clean instead of
    // double-executing the command.
    const actionAbort = new AbortController();

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
    // One spoken reply arrives as SEVERAL `…audio_transcript.done` segments (one per
    // sentence). Buffer them and persist the whole turn as ONE message on
    // `response.done`, so chat history (and the voice recollection that re-seeds it)
    // sees coherent turns instead of clause-fragments.
    let assistantTurnBuf = "";
    const flushAssistantTurn = () => {
      const text = assistantTurnBuf.trim();
      assistantTurnBuf = "";
      if (hybrid && sessionId && text) {
        appendMessage(deps.db, { sessionId, role: "assistant", content: text });
        touchSession(deps.db, sessionId);
      }
    };
    const pendingFromClient: Array<{ data: RawData; isBinary: boolean }> = [];
    log.info("realtime: client connected, opening upstream to gpt-realtime (transcribe-only)");

    upstream.on("open", () => {
      upstreamReady = true;
      // The reasoning toggle ("fast"/"thorough") also controls voice snappiness.
      const vad = vadForReasoning(vadConfig, getReasoningLevel(deps.db));
      log.info(`realtime: upstream open, sending ${hybrid ? "hybrid (speak+tool)" : "transcribe-only"} session.update (${pushToTalk ? "push-to-talk, VAD off" : `vad silence=${vad.silenceMs}ms`})`);
      // Configure the realtime session on connect.
      const system = buildSystemPrompt({
        memoryDir: deps.memoryDir,
        mode: "conversation",
      });
      // Ava's real changelog so "what's your latest update?" isn't confabulated.
      // (Recent conversation history is seeded below as conversation items.)
      const updates = buildVoiceUpdatesBlock(readDevLog(dirname(deps.memoryDir), 8));
      const sessionUpdate = hybrid
        ? buildHybridSessionUpdate(
            system + VOICE_PERSONA_INSTRUCTIONS + updates,
            vad,
            deps.voice ?? DEFAULT_VOICE,
            { pushToTalk },
          )
        : buildRealtimeSessionUpdate(system, vad, { pushToTalk });
      upstream.send(JSON.stringify(sessionUpdate));
      // HYBRID: unify voice with chat. Voice from the orb may have no session
      // (requestedSessionId === null). RESUME the most-recent conversation by
      // default so voice↔chat stay one continuous memory — re-entering voice and
      // asking "what did you do?" recalls what just happened, instead of landing
      // in a brand-new empty "Voice chat" session (the old bug: each entry minted
      // a fresh session). `?new=1` (the client's "+new" control) forces a fresh
      // one. The hello below sends whichever id we land on; the client latches
      // `ava.session` and adopts it.
      if (hybrid && !sessionId) {
        const { resumeId } = chooseResumeOrNew(wantNew, listSessions(deps.db)[0]?.id ?? null);
        sessionId = resumeId ?? createSession(deps.db, { title: "Voice chat" }).id;
      }
      // Seed the realtime model with recent conversation history so voice no
      // longer forgets what was typed (and vice-versa). Context only — NO
      // response.create — and bounded by N (env-tunable) because every seeded
      // item is OpenAI cost per connect, so the default stays small.
      if (hybrid && sessionId) {
        const N = Number(process.env.REALTIME_SEED_TURNS ?? 12);
        for (const m of listMessages(deps.db, sessionId).slice(-N)) {
          if (m.role !== "user" && m.role !== "assistant") continue;
          upstream.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: m.role,
              // Asymmetric GA content-part type (input_text vs output_text). The
              // old `text` was rejected — "Value must be 'output_text'" — and only
              // surfaced once voice started RESUMING a session with assistant turns
              // to seed; a fresh session had nothing to seed, so it stayed hidden.
              content: [{ type: seedContentType(m.role), text: m.content }],
            },
          }));
        }
      }
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
          flushAssistantTurn(); // persist the whole spoken turn as one message
        } else if (evt.type === "error") {
          log.warn(
            `realtime upstream error event: code=${evt.error?.code} type=${evt.error?.type} message=${evt.error?.message}`,
          );
        } else if (evt.type === "session.created" || evt.type === "session.updated") {
          log.info(`realtime ${evt.type} (model=${REALTIME_MODEL})`);
        } else if (
          evt.type === "response.output_audio_transcript.done" ||
          evt.type === "response.audio_transcript.done"
        ) {
          // BUFFER one segment of Ava's SPOKEN reply (chitchat). The model emits
          // several of these per spoken turn (one per sentence); we accumulate and
          // persist the whole turn as ONE message on response.done (above). This
          // fires only when the model actually speaks — during a do_on_computer task
          // it stays silent (silentToolResultFrame omits response.create → no output
          // transcript), so it never overlaps the do_on_computer result stored in (E).
          // Do NOT return: keep forwarding so the client's captions still update.
          const t = (evt as { transcript?: string }).transcript ?? "";
          if (hybrid && sessionId && t.trim()) {
            assistantTurnBuf += (assistantTurnBuf ? " " : "") + t.trim();
          }
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
              // Narrate each agent step to the client (it speaks them via TTS).
              // actionAbort.signal ties this run to the connection: if the client
              // drops mid-task, runVoiceAction aborts its fetches and kills the
              // loopback run instead of finishing into a dead socket.
              const r = await deps.runAction!(sessionId, task, (tool, args) => {
                try { client.send(stepFrame(tool, args)); } catch { /* */ }
              }, actionAbort.signal);
              sessionId = r.sessionId ?? sessionId;
              try { client.send(sessionHelloFrame(sessionId, hybrid)); } catch { /* */ }
              // Persist the action RESULT as Ava's turn. The user's raw words were
              // already stored as the accepted transcript (C), so we do NOT store
              // the task here — doing so would double the user turn. The internal
              // /api/chat run that executed the tools stores nothing (persist:false).
              if (sessionId) {
                appendMessage(deps.db, { sessionId, role: "assistant", content: r.text || "Done." });
                touchSession(deps.db, sessionId);
              }
              // The client speaks the result via TTS; the realtime model stays
              // silent (silentToolResultFrame omits response.create). One voice
              // per task. formatSpeechText smooths "Sir" punctuation for speech.
              try { client.send(actionResultFrame(formatSpeechText(r.text || "Done."))); } catch { /* */ }
              upstream.send(silentToolResultFrame(call.callId, r.text || "Done."));
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              try { client.send(actionResultFrame(formatSpeechText(`That didn't work, Sir — ${msg}`))); } catch { /* */ }
              // Store the failure as Ava's turn too, so the conversation reflects
              // what was spoken aloud (same single-source-of-truth as the success
              // path; the user turn is still only stored once, in C).
              if (sessionId) {
                appendMessage(deps.db, { sessionId, role: "assistant", content: `That didn't work, Sir — ${msg}` });
                touchSession(deps.db, sessionId);
              }
              upstream.send(silentToolResultFrame(call.callId, `error: ${msg}`));
            }
          })();
          return; // don't forward the raw function_call item to the client
        }
      }

      // Gate finished transcripts: a rejected one is dropped here and NEVER
      // reaches the browser, so silence/noise produces no user turn at all. In
      // push-to-talk the gate skips its hallucination heuristics (a held commit is
      // real speech), so short deliberate commands ("okay"/"yeah") get through.
      const decision = evt
        ? decideTranscriptForward(evt, speechStartMs, gateConfig, pushToTalk)
        : null;
      if (decision?.isTranscript) {
        speechStartMs = null; // consume the in-flight utterance's timing
        // Log the reason code only — never the raw audio. Transcript text is
        // short and useful for tuning; audio append frames are never logged.
        if (!decision.forward) {
          log.info(
            `realtime: dropped transcript reason=${decision.reason} speechMs=${decision.speechMs ?? "?"} text=${JSON.stringify(decision.text)}`,
          );
          // Push-to-talk: the client is stuck in "thinking" after its commit and
          // no reply is coming. Tell it to recover deterministically instead of
          // waiting out its safety timer (an empty/blank commit is the only PTT
          // drop now that the gate skips the denylist for held commits).
          if (pushToTalk) {
            try { if (client.readyState === WebSocket.OPEN) client.send(recoverFrame(decision.reason)); } catch { /* */ }
          }
          return; // do not forward — no phantom turn, no /api/chat call
        }
        if (hybrid && responseActive) {
          // VOICE BARGE-IN: the owner talked OVER Ava (VAD keeps the mic forwarding
          // during "responding"). Reaching here means the transcript already passed
          // the gate — confident speech, not echo/silence — so treat it as a real
          // interruption: cancel Ava's in-flight response upstream and open a NEW
          // turn with these words instead of dropping them (the old behaviour, which
          // made "talk over her to stop her" do nothing). The gate + browser echo
          // cancellation keep Ava's own tail from retriggering this.
          log.info(`realtime: barge-in — owner spoke over Ava; cancelling response for ${JSON.stringify(decision.text)}`);
          try { upstream.send(JSON.stringify({ type: "response.cancel" })); } catch { /* */ }
          responseActive = false;
          flushAssistantTurn(); // persist whatever Ava managed to say before the cut
          try { if (client.readyState === WebSocket.OPEN) client.send(bargeInFrame()); } catch { /* */ }
          // fall through: persist the user turn + response.create for the new turn
        }
        log.info(`realtime: accepted transcript text=${JSON.stringify(decision.text)}`);
        // SINGLE place the spoken USER turn is stored. Both earlier branches
        // (rejected transcript, "Ava is speaking") have already returned, so this
        // runs once per real utterance — no phantom turns. The internal /api/chat
        // run (do_on_computer) stores nothing (persist:false), so this is the one
        // source of truth for the user's words whether they chitchat or trigger
        // an action. HYBRID only: transcribe-only persists via /api/chat, so
        // storing here too would double the user turn.
        if (hybrid && sessionId) {
          appendMessage(deps.db, { sessionId, role: "user", content: decision.text });
          touchSession(deps.db, sessionId);
        }
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
      flushAssistantTurn(); // don't lose a turn the model spoke before the socket dropped
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
      try { actionAbort.abort(); } catch { /* ignore */ } // cancel any in-flight do_on_computer run
      try { upstream.close(); } catch { /* ignore */ }
    });
    client.on("error", (err) => {
      log.warn("realtime client error:", err.message);
      try { actionAbort.abort(); } catch { /* ignore */ }
      try { upstream.close(); } catch { /* ignore */ }
    });
  }

  /**
   * Attempt a Hume EVI session. Resolves `true` once the Hume socket OPENS and
   * the bridge is wired (the session then runs independently); resolves `false`
   * if the socket errors/closes before opening, so the caller can fall back to
   * OpenAI. No client handlers are attached until the socket opens, leaving the
   * connection pristine for the fallback. Never logs a secret — upstream errors
   * are redacted with the API key before they reach a log or the client.
   */
  function tryStartHumeSession(
    client: WebSocket,
    requestedSessionId: string | null,
    hume: HumeProviderConfig,
    wsUrl: string,
    pushToTalk = false,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const hybrid = !!deps.runAction;
      let sessionId = requestedSessionId;
      const actionAbort = new AbortController();
      let opened = false;
      // Hume emits one `assistant_message` per sentence; buffer the segments and
      // persist the whole spoken turn as ONE message on `assistant_end` (turnEnd),
      // so history isn't a pile of clause-fragments (which also poisons the recall
      // we seed back into the prompt).
      let assistantTurnBuf = "";
      const flushAssistantTurn = () => {
        const text = assistantTurnBuf.trim();
        assistantTurnBuf = "";
        if (hybrid && sessionId && text) {
          appendMessage(deps.db, { sessionId, role: "assistant", content: text });
          touchSession(deps.db, sessionId);
        }
      };
      const redact = (m: string) => redactSecrets(m, [hume.apiKey, hume.secretKey, hume.configId, hume.voiceId]);

      let upstream: WebSocket;
      try {
        upstream = new WebSocket(wsUrl);
      } catch (e) {
        log.warn("realtime: hume connect threw:", redact(e instanceof Error ? e.message : String(e)));
        resolve(false);
        return;
      }

      const pendingFromClient: string[] = [];

      upstream.on("open", () => {
        opened = true;
        // Resolve the session FIRST (resume the latest, like the OpenAI path) so we
        // can seed its recent history into Hume's prompt. Without this Hume starts
        // blank on every connect — no recollection of prior voice/chat turns.
        if (hybrid && !sessionId) {
          const { resumeId } = chooseResumeOrNew(false, listSessions(deps.db)[0]?.id ?? null);
          sessionId = resumeId ?? createSession(deps.db, { title: "Voice chat" }).id;
        }
        // Hume truncates the prompt at ~12k, so build it COMPACT + identity-first
        // (buildHumeVoicePrompt): drop the tool-map Hume can't use, and order the
        // anti-confabulation persona + real changelog + recent history AHEAD of the
        // persona base so the things that fix recall/identity always survive the cut.
        // Recollection ALSO goes in Hume's separate `context` field — belt-and-
        // suspenders, since whether Hume honors `context` is unverified and the
        // (now-surviving) prompt is the guaranteed channel.
        const compactBase = buildSystemPrompt({ memoryDir: deps.memoryDir, mode: "conversation", compact: true });
        const seedN = Number(process.env.REALTIME_SEED_TURNS ?? 12);
        const history = hybrid && sessionId ? buildHumeHistoryBlock(listMessages(deps.db, sessionId), seedN) : "";
        const updates = buildVoiceUpdatesBlock(readDevLog(dirname(deps.memoryDir), 8));
        const humePrompt = buildHumeVoicePrompt({ voicePersona: VOICE_PERSONA_INSTRUCTIONS, updates, history, base: compactBase });
        const contextText = (updates + history).trim();
        try { upstream.send(JSON.stringify(buildHumeSessionSettings(humePrompt, hume, contextText))); } catch { /* */ }
        try { client.send(sessionHelloFrame(sessionId, hybrid)); } catch { /* */ }
        log.info("realtime: hume session open (voice via Hume EVI)");
        // Drain client frames buffered before open, translating mic audio.
        for (const raw of pendingFromClient) {
          const f = translateClientFrameToHume(raw);
          if (f) try { upstream.send(f); } catch { /* */ }
        }
        pendingFromClient.length = 0;
        resolve(true); // session now runs independently
      });

      // Client → Hume: translate OpenAI-shaped mic frames to Hume audio_input.
      client.on("message", (data, isBinary) => {
        const raw = isBinary ? data.toString("utf8") : (typeof data === "string" ? data : data.toString("utf8"));
        if (!opened) { pendingFromClient.push(raw); return; }
        const f = translateClientFrameToHume(raw);
        if (f) try { upstream.send(f); } catch { /* */ }
      });

      // Hume → Client: translate to the OpenAI-shaped frames the browser handles.
      upstream.on("message", (data) => {
        let evt: Parameters<typeof translateHumeEvent>[0] | null = null;
        try { evt = JSON.parse(typeof data === "string" ? data : data.toString("utf8")); } catch { evt = null; }
        if (!evt) return;
        const t = translateHumeEvent(evt);

        // Gated user turn (same chokepoint as OpenAI): reject silence/noise.
        if (t.userTranscript != null) {
          const decision = decideTranscriptForward(
            { type: "conversation.item.input_audio_transcription.completed", transcript: t.userTranscript },
            null,
            gateConfig,
            pushToTalk,
          );
          if (!decision.forward) {
            log.info(`realtime(hume): dropped transcript reason=${decision.reason} text=${JSON.stringify(decision.text)}`);
            if (pushToTalk) {
              try { if (client.readyState === WebSocket.OPEN) client.send(recoverFrame(decision.reason)); } catch { /* */ }
            }
            return;
          }
          if (hybrid && sessionId) {
            appendMessage(deps.db, { sessionId, role: "user", content: decision.text });
            touchSession(deps.db, sessionId);
          }
          try {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: decision.text }));
            }
          } catch { /* */ }
          return;
        }

        // Action handoff: the model called do_on_computer → run the real agent.
        if (t.toolCall && t.toolCall.name === "do_on_computer" && deps.runAction) {
          const task = String((t.toolCall.args as { task?: unknown }).task ?? "");
          const callId = t.toolCall.callId;
          try { client.send(actionStartedFrame(task)); } catch { /* */ }
          void (async () => {
            try {
              const r = await deps.runAction!(sessionId, task, (tool, args) => {
                try { client.send(stepFrame(tool, args)); } catch { /* */ }
              }, actionAbort.signal);
              sessionId = r.sessionId ?? sessionId;
              try { client.send(sessionHelloFrame(sessionId, hybrid)); } catch { /* */ }
              if (sessionId) {
                appendMessage(deps.db, { sessionId, role: "assistant", content: r.text || "Done." });
                touchSession(deps.db, sessionId);
              }
              try { client.send(actionResultFrame(formatSpeechText(r.text || "Done."))); } catch { /* */ }
              try { upstream.send(humeToolResultFrame(callId, r.text || "Done.")); } catch { /* */ }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              try { client.send(actionResultFrame(formatSpeechText(`That didn't work, Sir — ${msg}`))); } catch { /* */ }
              if (sessionId) {
                appendMessage(deps.db, { sessionId, role: "assistant", content: `That didn't work, Sir — ${msg}` });
                touchSession(deps.db, sessionId);
              }
              try { upstream.send(humeToolResultFrame(callId, `error: ${msg}`)); } catch { /* */ }
            }
          })();
          return;
        }

        // Buffer Ava's spoken reply segment (chitchat); persist the whole turn as
        // one message on turnEnd (assistant_end / barge-in) below.
        if (t.assistantText && hybrid && sessionId && t.assistantText.trim()) {
          assistantTurnBuf += (assistantTurnBuf ? " " : "") + t.assistantText.trim();
        }
        if (t.turnEnd) flushAssistantTurn();

        // Forward translated frames (audio, captions, errors) to the client.
        for (const frame of t.frames) {
          try { if (client.readyState === WebSocket.OPEN) client.send(frame); } catch { /* */ }
        }
      });

      // Hume answered the WS upgrade with a non-101 HTTP status (401/403 = auth,
      // 429 = rate limit, 5xx = Hume down). Log the real status so an auth/rate
      // problem is diagnosable instead of a blank "error before open".
      upstream.on("unexpected-response", (_req, res) => {
        log.warn({ status: res.statusCode }, "realtime: hume upstream rejected the connection (HTTP status)");
        if (!opened) { resolve(false); return; }
      });
      upstream.on("error", (err) => {
        const msg = redact(err.message);
        if (!opened) { log.warn({ err: msg }, "realtime: hume upstream error before open"); resolve(false); return; }
        log.error({ err: msg }, "realtime: hume upstream error");
        try { client.send(JSON.stringify({ type: "error", error: { message: msg } })); } catch { /* */ }
        try { client.close(1011, "upstream error"); } catch { /* */ }
      });
      upstream.on("close", (code, reason) => {
        if (!opened) { resolve(false); return; }
        flushAssistantTurn(); // don't lose a turn Ava spoke before the socket dropped
        const r = redact(reason?.toString() || "(no reason)");
        try { client.send(JSON.stringify({ type: "error", error: { message: `upstream closed (code=${code}): ${r}` } })); } catch { /* */ }
        try { client.close(code, r); } catch { /* */ }
      });

      client.on("close", () => {
        try { actionAbort.abort(); } catch { /* */ }
        try { upstream.close(); } catch { /* */ }
      });
      client.on("error", () => {
        try { actionAbort.abort(); } catch { /* */ }
        try { upstream.close(); } catch { /* */ }
      });
    });
  }

  return {
    attach: handleUpgrade,
    close: () => { wss.close(); },
  };
}
