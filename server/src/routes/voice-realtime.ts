import { WebSocketServer, WebSocket, type RawData } from "ws";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import { validateToken } from "../auth/tokens.js";
import { createSession, getMostRecentSession, getSessionFull, touchSession } from "../state/sessions.js";
import { appendMessage, listMessages, listMessagesAfterId, type Message } from "../state/messages.js";
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
import { DEFAULT_REALTIME_SPEECH_RATE } from "../voice/voiceConfig.js";
import { DEFAULT_VOICE } from "./voice-defaults.js";
import { VoiceActionCoordinator } from "../voice/action-coordinator.js";
import { VoiceTurnAccumulator } from "../voice/turn-policy.js";
import type { ObservabilityService } from "../observability/store.js";
import type { ObservabilityParentContext, ObservabilityRunStatus } from "../observability/types.js";
import { TERMINAL_RUN_STATUSES } from "../observability/types.js";
import {
  resolveVoiceProvider,
  describeVoiceProvider,
  redactSecrets,
  buildHumeRealtimeUrl,
  resolveHumeWsUrl,
  type VoiceProviderConfig,
  type HumeProviderConfig,
} from "./voice-provider-config.js";

// ─── OpenAI Realtime API speech-to-speech proxy ─────────────────────────────
//
// The realtime model owns one continuous spoken voice and fast conversation.
// It gets one bridge tool, `do_on_computer`; tool requests run through AVA's
// normal /api/chat action agent, then the result is returned to the SAME
// realtime response so task completion never switches to a separate TTS voice.
//
// Safety and turn-taking:
//   - `create_response: false` lets this proxy gate completed transcripts before
//     explicitly requesting a response; silence/noise cannot make AVA speak.
//   - Semantic VAD waits for a complete thought instead of splitting commands at
//     short pauses.
//   - Accepted owner speech cancels current output; raw VAD onset alone does not.
//     The browser then truncates the unheard tail at its playback position.
//
// Event types we care about (server → client):
//     - session.created / session.updated
//     - input_audio_buffer.speech_started / .speech_stopped (server VAD)
//     - conversation.item.input_audio_transcription.completed  (gated here)
//     - error

// gpt-4o-realtime-preview returned server_error on this account — likely a
// gate on the older preview SKU. Use OpenAI's current full realtime voice model
// by default, with REALTIME_MODEL available for intentional overrides.
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2.1";
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;

export interface RealtimeVadConfig {
  /** Transcription model. gpt-4o-transcribe hallucinates far less than whisper-1. */
  transcribeModel: string;
  /** ISO-639-1 language hint. Null keeps automatic language detection. */
  transcribeLanguage: string | null;
  /** Semantic VAD waits for a complete thought instead of every short pause. */
  mode?: "semantic_vad" | "server_vad";
  /** How quickly semantic VAD decides the owner has finished speaking. */
  semanticEagerness?: "low" | "medium" | "high" | "auto";
  /** server_vad energy threshold 0..1 — higher ignores more background noise. */
  threshold: number;
  /** Audio kept before speech onset, ms. */
  prefixPaddingMs: number;
  /** Trailing silence that ends an utterance, ms (min silence duration). */
  silenceMs: number;
}

export const DEFAULT_REALTIME_VAD: RealtimeVadConfig = {
  transcribeModel: "gpt-4o-transcribe",
  transcribeLanguage: "en",
  mode: "semantic_vad",
  semanticEagerness: "low",
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
  const rawMode = env.REALTIME_VAD_MODE?.trim().toLowerCase();
  const mode = rawMode === "server_vad" ? "server_vad" : "semantic_vad";
  const rawEagerness = env.REALTIME_VAD_EAGERNESS?.trim().toLowerCase();
  const semanticEagerness =
    rawEagerness === "medium" || rawEagerness === "high" || rawEagerness === "auto"
      ? rawEagerness
      : "low";
  return {
    transcribeModel: env.REALTIME_TRANSCRIBE_MODEL || DEFAULT_REALTIME_VAD.transcribeModel,
    transcribeLanguage:
      env.REALTIME_TRANSCRIBE_LANGUAGE?.trim().toLowerCase() === "auto"
        ? null
        : env.REALTIME_TRANSCRIBE_LANGUAGE?.trim() || DEFAULT_REALTIME_VAD.transcribeLanguage,
    mode,
    semanticEagerness,
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
  // This fixes the measured failure where "I want you to go" became a task
  // before "into WhatsApp" arrived. Fast uses semantic VAD's balanced timeout;
  // Thorough lets the owner pause longer. The server-VAD fallback is also much
  // more patient than the old 500/700ms values.
  return {
    ...base,
    // Endpointing controls whether AVA acts on half a sentence; it must not
    // become aggressive just because the text-reasoning preference is "fast".
    // The latest real trace showed `auto` splitting "You are", "What", and
    // "The first step" into separate action turns. Keep semantic VAD patient in
    // both modes and tune only the server-VAD fallback timeout.
    semanticEagerness: "low",
    silenceMs: level === "fast" ? 900 : 1200,
  };
}

/**
 * Build the realtime session's `turn_detection` block. Hands-free mode defaults
 * to semantic VAD (patient endpointing, never auto-replies), with server VAD
 * retained as an explicit fallback. In Enter push-to-talk mode it is `null`:
 * automatic VAD/turn-detection is DISABLED, so
 * the server never decides a turn started or ended from the audio. The client
 * owns turn boundaries — it forwards mic audio only while a turn is held and
 * sends an explicit `input_audio_buffer.commit` to finish it. This is what keeps
 * background/external audio between turns from ever becoming a turn.
 */
export function turnDetectionFor(vad: RealtimeVadConfig, pushToTalk: boolean) {
  if (pushToTalk) return null;
  if ((vad.mode ?? "semantic_vad") === "semantic_vad") {
    return {
      type: "semantic_vad" as const,
      eagerness: vad.semanticEagerness ?? "low",
      create_response: false,
      // A raw energy onset may be room noise or AVA's own speaker echo. Do not
      // destroy the current reply until the completed transcript passes our
      // confidence + structural gates; the proxy then cancels explicitly.
      interrupt_response: false,
    };
  }
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
 * GA realtime session.update payload, configured for TRANSCRIBE-ONLY use.
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
          // Semantic/server VAD in hands-free mode; null in push-to-talk.
          turn_detection: turnDetectionFor(vad, !!opts.pushToTalk),
          transcription: {
            model: vad.transcribeModel,
            ...(vad.transcribeLanguage ? { language: vad.transcribeLanguage } : {}),
          },
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
  "do_on_computer with a clear, complete task. Never invent a destination or action from an unfinished " +
  "utterance; if the request still trails off or lacks its target, wait for the rest or ask one short " +
  "question. Pass the owner's request faithfully: do not expand it with fallback strategies, tool " +
  "choices, UI automation, permissions, or invented next steps. For Chrome, websites, Instagram, " +
  "WhatsApp, and other logged-in accounts, the task must say to use AVA's persistent logged-in Chrome " +
  "and never launch a browser through shell. Do not narrate internal tool steps. After the tool returns, speak one concise natural " +
  "result in this same voice. If Sir asks how it went WHILE the task is still running, say you're still " +
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
    "rather than just chat. Call only after the request is complete; never guess missing words, a " +
    "destination, person, site, or action from a trailing fragment. Pass the owner's request faithfully " +
    "without adding fallback strategies or tool instructions. Browser/account requests always use " +
    "AVA's persistent logged-in Chrome, never a shell-launched browser. Do not attempt the action " +
    "yourself in conversation.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description:
          "The owner's complete request in plain language, without invented fallbacks. For browser " +
          "or account work, specify AVA's persistent logged-in Chrome and never shell.",
      },
    },
    required: ["task"],
  },
};

/**
 * Hybrid session.update: the realtime model speaks (audio out) AND can call
 * `do_on_computer`. VAD uses the same transcript gate so it won't answer
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
          // Semantic/server VAD (proxy sends response.create only after the gate
          // passes) in hands-free mode; null in push-to-talk.
          turn_detection: turnDetectionFor(vad, !!opts.pushToTalk),
          transcription: {
            model: vad.transcribeModel,
            ...(vad.transcribeLanguage ? { language: vad.transcribeLanguage } : {}),
          },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice,
          // Natural model cadence. Forced 1.15× respeeding was audibly harsher
          // and unlike OpenAI's native realtime voice.
          speed: DEFAULT_REALTIME_SPEECH_RATE,
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

/** OpenAI conversation items for persisted chat/voice turns. Kept pure so the
 * shared-context contract is testable without a live Realtime connection. */
export function openAiHistoryFrames(
  messages: Array<Pick<Message, "role" | "content">>,
): string[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: message.role,
        content: [{ type: seedContentType(message.role), text: message.content }],
      },
    }));
}

/** The typed agent already receives this durable summary before its unsummarised
 * rows. Voice receives the same earlier-conversation anchor, while recent rows
 * remain normal conversation items. */
export function buildVoiceConversationSummary(summary: string | null | undefined): string {
  const text = summary?.trim();
  if (!text) return "";
  return `\n\n[CONVERSATION SUMMARY OF EARLIER MESSAGES]\n${text.slice(0, 4_000)}\n`;
}

/** Sent (hybrid) when do_on_computer starts so the UI shows progress, not dead air. */
export function actionStartedFrame(task: string): string {
  return JSON.stringify({ type: "ava.action", task });
}

/** Sent per agent tool call for visual progress only; it is never spoken via TTS. */
export function stepFrame(tool: string, args: unknown): string {
  return JSON.stringify({ type: "ava.step", tool, args });
}

/** Display/control copy of the result; the realtime model speaks the same result. */
export function actionResultFrame(text: string): string {
  return JSON.stringify({ type: "ava.result", text });
}

/**
 * Sent after an accepted owner transcript talks OVER Ava (voice barge-in): the
 * proxy has cancelled her in-flight response upstream, and this tells the client
 * to stop local playback. Raw VAD onset is deliberately insufficient.
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

/** A structurally incomplete automatic-VAD turn is visible, but not actionable. */
export function transcriptPendingFrame(text: string): string {
  return JSON.stringify({ type: "ava.transcript_pending", text });
}

/** Emit a gated/possibly-coalesced user caption with a stable protocol shape. */
export function acceptedTranscriptFrame(text: string): string {
  return JSON.stringify({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: text,
  });
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

/** A response.cancel is valid only after OpenAI has confirmed response.created. */
export function shouldForwardResponseCancel(responseActive: boolean): boolean {
  return responseActive;
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
  runAction?: (
    sessionId: string | null,
    task: string,
    onStep?: (tool: string, args: unknown) => void,
    signal?: AbortSignal,
    observability?: ObservabilityParentContext,
  ) => Promise<{ text: string; sessionId: string | null }>;
  /** Shared AVA-owned event stream. Hume remains explicitly out of v1 coverage. */
  observability?: ObservabilityService;
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
const fragmentHoldOverride = Number(process.env.VOICE_FRAGMENT_HOLD_MS);
const VOICE_FRAGMENT_HOLD_MS = Number.isFinite(fragmentHoldOverride) && fragmentHoldOverride > 0
  ? Math.max(500, fragmentHoldOverride)
  : 2400;

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
      const opened = await tryStartHumeSession(client, requestedSessionId, providerConfig.hume, humeUrl, pushToTalk, wantNew);
      if (opened) return;
      log.warn("realtime: hume upstream did not establish — falling back to OpenAI");
    }
    // The realtime model always speaks for the OpenAI provider (hybrid: it speaks
    // chitchat AND routes do_on_computer to the full agent).
    const hybrid = !!deps.runAction;
    // In hybrid mode the proxy owns the action handoff; the session id is tracked
    // here and may be (re)assigned when an action turn creates one.
    let sessionId = requestedSessionId;
    // Exactly one action may own this connection. Each action gets its own abort
    // controller + epoch, so Stop/replacement retires the old promise and a late
    // completion can never publish a result or restart AVA's voice.
    const actionRuns = new VoiceActionCoordinator();
    const voiceSessionRunId = `voice_session_${nanoid(12)}`;
    const voiceTraceId = `trace_voice_${nanoid(14)}`;
    let voiceSessionObserved = false;
    try {
      deps.observability?.startRun({
        id: voiceSessionRunId,
        traceId: voiceTraceId,
        rootTaskId: voiceSessionRunId,
        sessionId: requestedSessionId,
        runKind: "voice_session",
        runtimeId: "ava:voice",
        runtimeType: "ava",
        ownerType: "ava",
        ownerId: "realtime-proxy",
        ownerRole: "voice-orchestrator",
        title: "AVA voice session",
        objective: "Maintain a realtime voice conversation and route approved actions through AVA.",
        privacyLevel: "personal",
        staleAfterMs: 75_000,
      });
      voiceSessionObserved = !!deps.observability;
    } catch (error) {
      log.warn("[mission-control] voice session start failed", error instanceof Error ? error.message : error);
    }
    const recordVoiceSession = (input: Parameters<ObservabilityService["record"]>[1]) => {
      if (!voiceSessionObserved || !deps.observability) return null;
      try {
        return deps.observability.record(voiceSessionRunId, input);
      } catch (error) {
        log.warn("[mission-control] voice event failed", error instanceof Error ? error.message : error);
        return null;
      }
    };
    type ActiveVoiceTurn = {
      runId: string;
      spanId: string;
      acceptedAt: number;
      firstAudioSeen: boolean;
      unregisterStop: () => void;
    };
    let currentObservedTurn: ActiveVoiceTurn | null = null;
    const finishObservedTurn = (
      turn: ActiveVoiceTurn,
      input: {
        type: string;
        status: string;
        title: string;
        summary?: string;
        payload?: unknown;
        runStatus: ObservabilityRunStatus;
        outcome: string;
        responseText?: string;
        verificationStatus?: "verified" | "partially_verified" | "not_verified" | "not_recorded";
        providerRequestId?: string | null;
        inputTokens?: number | null;
        outputTokens?: number | null;
        cachedTokens?: number | null;
      },
    ) => {
      try {
        deps.observability?.record(turn.runId, {
          producerId: "ava:voice",
          spanId: turn.spanId,
          type: input.type,
          status: input.status,
          title: input.title,
          summary: input.summary,
          visibility: input.responseText ? "sensitive_collapsed" : "summary",
          payload: input.responseText
            ? { response: input.responseText, ...((input.payload as object | undefined) ?? {}) }
            : input.payload,
          providerRequestId: input.providerRequestId,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cachedTokens: input.cachedTokens,
          durationMs: Math.max(0, Date.now() - turn.acceptedAt),
          terminal: true,
          runStatus: input.runStatus,
          outcome: input.outcome,
          verificationStatus: input.verificationStatus ?? "not_recorded",
          compactSummary: input.summary ?? (
            input.responseText ? "AVA completed the realtime voice response." : undefined
          ),
        });
      } catch (error) {
        log.warn("[mission-control] voice turn close failed", error instanceof Error ? error.message : error);
      } finally {
        turn.unregisterStop();
        if (currentObservedTurn === turn) currentObservedTurn = null;
      }
    };
    // Semantic VAD can still split one sentence into two transcription items.
    // Hold structurally incomplete pieces and expose only a complete turn.
    const voiceTurns = new VoiceTurnAccumulator();
    let fragmentTimer: ReturnType<typeof setTimeout> | null = null;
    const clearFragmentTimer = () => {
      if (fragmentTimer) clearTimeout(fragmentTimer);
      fragmentTimer = null;
    };

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
    let speechEndMs: number | null = null;
    // True while Ava is mid-response (between response.created and response.done).
    // A transcript that lands during this window is almost always a hallucination
    // / echo, and starting a new response would cut Ava off — so we ignore it.
    let responseActive = false;
    // response.create was sent, but OpenAI has not confirmed response.created.
    // Keeping this separate prevents invalid response.cancel races.
    let responseRequested = false;
    // Stop can land in the tiny response.create → response.created gap. OpenAI
    // rejects response.cancel before creation, so retire that response the instant
    // it appears and suppress its events. A real user turn may queue one fresh
    // response behind that cancellation.
    let cancelResponseOnCreate = false;
    let suppressCurrentResponse = false;
    let responseAfterCancellation = false;
    // Highest stored message already represented upstream. Voice can remain
    // connected while another client writes typed turns; this high-water makes
    // importing those turns before the next utterance deterministic/idempotent.
    let persistedHistoryHighWater = 0;
    const recordObservedTurn = (
      turn: ActiveVoiceTurn,
      input: Parameters<ObservabilityService["record"]>[1],
    ) => {
      try {
        return deps.observability?.record(turn.runId, {
          producerId: "ava:voice",
          parentSpanId: turn.spanId,
          ...input,
        }) ?? null;
      } catch (error) {
        log.warn("[mission-control] voice turn event failed", error instanceof Error ? error.message : error);
        return null;
      }
    };
    const cancelObservedTurn = (
      reason: string,
      title = "Voice turn cancelled",
    ) => {
      const turn = currentObservedTurn;
      if (!turn) return;
      finishObservedTurn(turn, {
        type: "voice.turn.cancelled",
        status: "cancelled",
        title,
        summary: `The turn stopped before completion (${reason}).`,
        payload: { reason },
        runStatus: "cancelled",
        outcome: reason,
        verificationStatus: "not_verified",
      });
    };
    const beginObservedTurn = (transcript: string): ActiveVoiceTurn | null => {
      if (!deps.observability || !voiceSessionObserved) return null;
      if (currentObservedTurn) {
        cancelObservedTurn("replaced_by_new_turn", "Voice turn replaced by a newer utterance");
      }
      const turn: ActiveVoiceTurn = {
        runId: `voice_turn_${nanoid(12)}`,
        spanId: `span_voice_turn_${nanoid(12)}`,
        acceptedAt: Date.now(),
        firstAudioSeen: false,
        unregisterStop: () => {},
      };
      try {
        deps.observability.startRun({
          id: turn.runId,
          traceId: voiceTraceId,
          parentRunId: voiceSessionRunId,
          rootTaskId: voiceSessionRunId,
          sessionId,
          runKind: "voice_turn",
          runtimeId: "ava:voice",
          runtimeType: "ava",
          hostRuntimeId: "openai:realtime",
          ownerType: "ava",
          ownerId: "realtime-proxy",
          ownerRole: "voice-orchestrator",
          title: "Voice request",
          objective: transcript,
          privacyLevel: "personal",
          staleAfterMs: 75_000,
          startedAt: turn.acceptedAt,
        });
        turn.unregisterStop = deps.observability.registerStopHandler(turn.runId, async () => {
          if (currentObservedTurn !== turn) return false;
          actionRuns.cancel();
          if (responseActive) {
            try { upstream.send(JSON.stringify({ type: "response.cancel" })); } catch { /* upstream closed */ }
            responseActive = false;
          } else if (responseRequested) {
            cancelResponseOnCreate = true;
          }
          try {
            if (client.readyState === WebSocket.OPEN) client.send(bargeInFrame());
          } catch { /* client closed */ }
          cancelObservedTurn("cancelled_by_user", "Voice turn stopped by Niko");
          return true;
        });
        currentObservedTurn = turn;
        recordObservedTurn(turn, {
          spanId: turn.spanId,
          type: "voice.transcript.accepted",
          status: "success",
          title: "Owner transcript accepted",
          summary: "The transcript passed the voice gate and became an executable AVA turn.",
          visibility: "sensitive_collapsed",
          privacyLevel: "personal",
          payload: { transcript },
          occurredAt: turn.acceptedAt,
        });
        return turn;
      } catch (error) {
        turn.unregisterStop();
        log.warn("[mission-control] voice turn start failed", error instanceof Error ? error.message : error);
        return null;
      }
    };
    let voiceSessionEnded = false;
    let unregisterVoiceSessionStop = () => {};
    const finishObservedSession = (
      runStatus: "completed" | "failed" | "cancelled",
      outcome: string,
      summary: string,
      error?: string,
    ) => {
      if (voiceSessionEnded) return;
      voiceSessionEnded = true;
      unregisterVoiceSessionStop();
      if (!voiceSessionObserved || !deps.observability) return;
      try {
        const run = deps.observability.getRun(voiceSessionRunId);
        if (!run || TERMINAL_RUN_STATUSES.has(run.status)) return;
        deps.observability.record(voiceSessionRunId, {
          producerId: "ava:voice",
          type: `voice.session.${runStatus}`,
          status: runStatus === "completed" ? "success" : runStatus,
          title: summary,
          summary,
          error,
          terminal: true,
          runStatus,
          outcome,
          verificationStatus: "not_recorded",
        });
      } catch (missionError) {
        log.warn("[mission-control] voice session close failed", missionError instanceof Error ? missionError.message : missionError);
      }
    };
    unregisterVoiceSessionStop = deps.observability?.registerStopHandler(
      voiceSessionRunId,
      async () => {
        actionRuns.cancel();
        cancelObservedTurn("parent_session_stopped", "Voice turn stopped with its session");
        if (responseActive) {
          try { upstream.send(JSON.stringify({ type: "response.cancel" })); } catch { /* upstream closed */ }
        }
        try {
          if (client.readyState === WebSocket.OPEN) client.send(bargeInFrame());
        } catch { /* client closed */ }
        finishObservedSession("cancelled", "cancelled_by_user", "Voice session stopped by Niko");
        try { client.close(1000, "stopped from Mission Control"); } catch { /* already closed */ }
        try { upstream.close(1000, "stopped from Mission Control"); } catch { /* already closed */ }
        return true;
      },
    ) ?? (() => {});
    const missionHeartbeat = setInterval(() => {
      recordVoiceSession({
        producerId: "ava:voice",
        type: "runtime.heartbeat",
        status: "running",
        title: "Voice runtime heartbeat",
        visibility: "system_only",
      });
      const turn = currentObservedTurn;
      if (turn) {
        recordObservedTurn(turn, {
          type: "runtime.heartbeat",
          status: "running",
          title: "Voice turn heartbeat",
          visibility: "system_only",
        });
      }
    }, 30_000);
    missionHeartbeat.unref?.();
    // One spoken reply arrives as SEVERAL `…audio_transcript.done` segments (one per
    // sentence). Buffer them and persist the whole turn as ONE message on
    // `response.done`, so chat history (and the voice recollection that re-seeds it)
    // sees coherent turns instead of clause-fragments.
    let assistantTurnBuf = "";
    const flushAssistantTurn = (): string => {
      const text = assistantTurnBuf.trim();
      assistantTurnBuf = "";
      if (hybrid && sessionId && text) {
        const stored = appendMessage(deps.db, { sessionId, role: "assistant", content: text });
        persistedHistoryHighWater = Math.max(persistedHistoryHighWater, stored.id);
        touchSession(deps.db, sessionId);
      }
      return text;
    };
    const syncTypedHistoryIntoRealtime = () => {
      if (!hybrid || !sessionId || !upstreamReady) return;
      const pending = listMessagesAfterId(deps.db, sessionId, persistedHistoryHighWater);
      for (const message of pending) {
        for (const frame of openAiHistoryFrames([message])) upstream.send(frame);
        // System notices are not valid Realtime roles, but still advance the
        // cursor so a later sync cannot repeatedly inspect the same row.
        persistedHistoryHighWater = message.id;
      }
    };
    const pendingFromClient: Array<{ data: RawData; isBinary: boolean }> = [];
    log.info(
      `realtime: client connected, opening upstream to ${REALTIME_MODEL} ` +
      `(${hybrid ? "hybrid" : "transcribe-only"})`,
    );
    recordVoiceSession({
      producerId: "ava:voice",
      type: "voice.upstream.connecting",
      status: "running",
      title: "Connecting to OpenAI Realtime",
      payload: { model: REALTIME_MODEL, mode: hybrid ? "hybrid" : "transcribe_only" },
    });

    upstream.on("open", () => {
      upstreamReady = true;
      // The reasoning toggle ("fast"/"thorough") also controls voice snappiness.
      const vad = vadForReasoning(vadConfig, getReasoningLevel(deps.db));
      log.info(
        `realtime: upstream open, sending ${hybrid ? "hybrid (speak+tool)" : "transcribe-only"} ` +
        `session.update (${pushToTalk ? "push-to-talk, VAD off" : `${vad.mode ?? "semantic_vad"} eagerness=${vad.semanticEagerness ?? "low"}`})`,
      );
      // Resolve the canonical conversation before constructing instructions.
      // Pins affect chat-list presentation, not which conversation was active.
      if (hybrid && !sessionId) {
        const { resumeId } = chooseResumeOrNew(wantNew, getMostRecentSession(deps.db)?.id ?? null);
        sessionId = resumeId ?? createSession(deps.db, { title: "Voice chat" }).id;
      }
      // Configure the realtime session on connect.
      const system = buildSystemPrompt({
        memoryDir: deps.memoryDir,
        mode: "conversation",
      });
      // Ava's real changelog so "what's your latest update?" isn't confabulated.
      // (Recent conversation history is seeded below as conversation items.)
      const updates = buildVoiceUpdatesBlock(readDevLog(dirname(deps.memoryDir), 8));
      const conversationSummary = hybrid && sessionId
        ? buildVoiceConversationSummary(getSessionFull(deps.db, sessionId)?.summary)
        : "";
      const sessionUpdate = hybrid
        ? buildHybridSessionUpdate(
            system + VOICE_PERSONA_INSTRUCTIONS + updates + conversationSummary,
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
      if (voiceSessionObserved && deps.observability) {
        try {
          deps.observability.updateRunContext(voiceSessionRunId, { sessionId });
        } catch { /* telemetry cannot block voice */ }
      }
      recordVoiceSession({
        producerId: "ava:voice",
        type: "voice.upstream.connected",
        status: "success",
        title: "OpenAI Realtime connected",
        summary: "The live speech connection is ready.",
        payload: {
          model: REALTIME_MODEL,
          voice: deps.voice ?? DEFAULT_VOICE,
          inputMode: pushToTalk ? "push_to_talk" : "automatic_vad",
        },
      });
      // Seed the realtime model with recent conversation history so voice no
      // longer forgets what was typed (and vice-versa). Context only — NO
      // response.create — and bounded by N (env-tunable) because every seeded
      // item is OpenAI cost per connect, so the default stays small.
      if (hybrid && sessionId) {
        const N = Number(process.env.REALTIME_SEED_TURNS ?? 12);
        const stored = listMessages(deps.db, sessionId);
        for (const m of stored.slice(-N)) {
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
        // Older rows outside the bounded recent seed are represented by the
        // durable summary and must not later look like newly typed turns.
        persistedHistoryHighWater = stored.at(-1)?.id ?? 0;
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
      if (!isBinary) {
        try {
          const event = JSON.parse(data.toString("utf8")) as { type?: string };
          // With VAD disabled, this commit is the ordering boundary immediately
          // before OpenAI creates the spoken user item. Import typed turns first.
          if (event.type === "input_audio_buffer.commit") {
            syncTypedHistoryIntoRealtime();
          }
          if (event.type === "response.cancel") {
            // This frame is also AVA's general Stop signal. During a computer
            // action there is usually no active OpenAI response to cancel, so
            // retire the action independently and suppress any late result.
            const cancelledAction = actionRuns.cancel();
            if (cancelledAction) {
              log.info("realtime: cancelled active do_on_computer run");
            }
            if (!shouldForwardResponseCancel(responseActive)) {
              if (responseRequested) {
                cancelResponseOnCreate = true;
                log.info("realtime: queued cancellation for requested response");
                return;
              }
              log.info(
                cancelledAction
                  ? "realtime: action stopped; no model response was active"
                  : "realtime: ignored response.cancel because no response is active",
              );
              return;
            }
            responseActive = false;
            responseRequested = false;
            const partial = flushAssistantTurn();
            if (currentObservedTurn) {
              finishObservedTurn(currentObservedTurn, {
                type: "voice.turn.cancelled",
                status: "cancelled",
                title: "Voice turn stopped by Niko",
                summary: "Playback and generation were stopped from the voice interface.",
                payload: partial ? { partialResponse: partial } : undefined,
                runStatus: "cancelled",
                outcome: "cancelled_by_user",
                verificationStatus: "not_verified",
              });
            }
          }
        } catch {
          // Non-JSON frames are forwarded unchanged below.
        }
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
            item_id?: string;
            audio_start_ms?: number;
            audio_end_ms?: number;
            logprobs?: Array<{ logprob?: number }> | null;
            error?: { type?: string; code?: string; message?: string };
            response?: {
              id?: string;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                input_token_details?: { cached_tokens?: number };
              };
            };
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
          // WebSocket events are ordered on one channel. VAD has detected the
          // next utterance but has not committed its conversation item yet, so
          // this is the safe point to insert typed turns ahead of that question.
          syncTypedHistoryIntoRealtime();
          speechStartMs = typeof evt.audio_start_ms === "number" ? evt.audio_start_ms : 0;
          speechEndMs = null;
          // Do not cancel on raw energy onset. Speaker echo/background noise used
          // to shred replies before the transcript gate could reject it. A real
          // interruption is cancelled below after its completed text is accepted.
        } else if (evt.type === "input_audio_buffer.speech_stopped") {
          speechEndMs = typeof evt.audio_end_ms === "number" ? evt.audio_end_ms : null;
        } else if (evt.type === "response.created") {
          responseActive = true;
          responseRequested = false;
          if (currentObservedTurn) {
            recordObservedTurn(currentObservedTurn, {
              type: "model.response.started",
              status: "running",
              title: "Realtime response started",
              summary: "OpenAI Realtime began producing this turn.",
              payload: { model: REALTIME_MODEL, responseId: evt.response?.id ?? null },
            });
          }
          if (cancelResponseOnCreate) {
            cancelResponseOnCreate = false;
            suppressCurrentResponse = true;
            try { upstream.send(JSON.stringify({ type: "response.cancel" })); } catch { /* */ }
          }
        } else if (evt.type === "response.done") {
          responseActive = false;
          responseRequested = false;
          const spokenText = flushAssistantTurn(); // persist the whole spoken turn as one message
          if (suppressCurrentResponse) {
            suppressCurrentResponse = false;
            if (responseAfterCancellation) {
              responseAfterCancellation = false;
              responseRequested = true;
              try { upstream.send(JSON.stringify({ type: "response.create" })); } catch { /* */ }
            }
            return; // cancelled generation stays invisible to the browser
          }
          if (currentObservedTurn) {
            finishObservedTurn(currentObservedTurn, {
              type: "voice.response.completed",
              status: "success",
              title: "AVA finished the voice response",
              summary: spokenText
                ? "The realtime response completed and its spoken transcript was stored."
                : "The realtime response completed without a transcript payload.",
              responseText: spokenText || undefined,
              payload: { model: REALTIME_MODEL },
              runStatus: "completed",
              outcome: spokenText ? "spoken_response_completed" : "response_completed_without_transcript",
              verificationStatus: "not_recorded",
              providerRequestId: evt.response?.id ?? null,
              inputTokens: evt.response?.usage?.input_tokens ?? null,
              outputTokens: evt.response?.usage?.output_tokens ?? null,
              cachedTokens: evt.response?.usage?.input_token_details?.cached_tokens ?? null,
            });
          }
        } else if (evt.type === "error") {
          log.warn(
            `realtime upstream error event: code=${evt.error?.code} type=${evt.error?.type} message=${evt.error?.message}`,
          );
          if (currentObservedTurn) {
            finishObservedTurn(currentObservedTurn, {
              type: "voice.turn.failed",
              status: "error",
              title: "Realtime voice turn failed",
              summary: evt.error?.message ?? "OpenAI Realtime returned an error.",
              payload: { code: evt.error?.code, type: evt.error?.type },
              runStatus: "failed",
              outcome: "realtime_error",
              verificationStatus: "not_verified",
            });
          }
        } else if (evt.type === "session.created" || evt.type === "session.updated") {
          log.info(`realtime ${evt.type} (model=${REALTIME_MODEL})`);
        } else if (
          evt.type === "response.output_audio_transcript.done" ||
          evt.type === "response.audio_transcript.done"
        ) {
          // BUFFER one segment of Ava's SPOKEN reply (chitchat). The model emits
          // several of these per spoken turn (one per sentence); we accumulate and
          // persist the whole turn as ONE message on response.done (above).
          // Do NOT return: keep forwarding so the client's captions still update.
          const t = (evt as { transcript?: string }).transcript ?? "";
          if (hybrid && sessionId && t.trim()) {
            assistantTurnBuf += (assistantTurnBuf ? " " : "") + t.trim();
          }
        } else if (
          evt.type === "response.output_audio.delta" ||
          evt.type === "response.audio.delta"
        ) {
          const turn = currentObservedTurn;
          if (turn && !turn.firstAudioSeen) {
            turn.firstAudioSeen = true;
            recordObservedTurn(turn, {
              type: "voice.audio.first_chunk",
              status: "running",
              title: "First audio reached AVA",
              summary: "Audio bytes are intentionally not stored.",
              durationMs: Math.max(0, Date.now() - turn.acceptedAt),
            });
          }
        }
      }

      // A response that was requested before Stop arrived is cancelled on create.
      // Drop all of its response-scoped frames, including function calls and late
      // audio, while still allowing unrelated input/VAD events through.
      if (suppressCurrentResponse && evt?.type?.startsWith("response.")) {
        return;
      }

      // Hybrid: the model called do_on_computer → run the real /api/chat agent
      // and feed the result back so the model speaks it.
      if (hybrid && evt) {
        const call = readToolCall(evt);
        if (call && call.name === "do_on_computer" && deps.runAction) {
          const task = String((call.args as { task?: unknown }).task ?? "");
          log.info(`realtime: do_on_computer task=${JSON.stringify(task)}`);
          const action = actionRuns.begin();
          const observedTurn = currentObservedTurn;
          const delegationSpanId = `span_voice_delegate_${nanoid(12)}`;
          const delegated = observedTurn
            ? recordObservedTurn(observedTurn, {
                spanId: delegationSpanId,
                type: "agent.delegation.assigned",
                status: "running",
                title: "Voice delegated work to AVA's tool agent",
                summary: "The realtime model requested an AVA-controlled computer action.",
                visibility: "sensitive_collapsed",
                payload: { task, target: "ava:agent" },
                actionOwner: "router",
              })
            : null;
          // Tell the client an action started so it can show progress instead of
          // dead air while the (possibly multi-second) agent run executes.
          try { client.send(actionStartedFrame(task)); } catch { /* */ }
          void (async () => {
            try {
              // Send each agent step for visual progress only. The client does
              // not synthesize these with a second, mismatched voice.
              // Stop/replacement/socket close aborts this run. Epoch checks also
              // suppress a dependency that resolves after its signal was aborted.
              const r = await deps.runAction!(sessionId, task, (tool, args) => {
                if (!actionRuns.isCurrent(action.id)) return;
                try { client.send(stepFrame(tool, args)); } catch { /* */ }
                if (observedTurn) {
                  recordObservedTurn(observedTurn, {
                    parentSpanId: delegationSpanId,
                    type: "agent.delegation.progress",
                    status: "running",
                    title: `${tool} is running`,
                    summary: "Progress reported by the delegated AVA agent; execution is counted on the child run only.",
                    visibility: "detail",
                    payload: { tool, args },
                    actionOwner: "observer",
                  });
                }
              }, action.signal, observedTurn ? {
                traceId: voiceTraceId,
                parentRunId: observedTurn.runId,
                parentSpanId: delegationSpanId,
                causationEventId: delegated?.event?.eventId ?? null,
              } : undefined);
              if (!actionRuns.isCurrent(action.id)) {
                log.info("realtime: discarded late result from retired action");
                if (observedTurn) {
                  recordObservedTurn(observedTurn, {
                    parentSpanId: delegationSpanId,
                    type: "agent.delegation.result_discarded",
                    status: "cancelled",
                    title: "Late delegated result discarded",
                    summary: "A retired action completed after cancellation; AVA did not speak or apply it.",
                    actionOwner: "observer",
                  });
                }
                return;
              }
              sessionId = r.sessionId ?? sessionId;
              try { client.send(sessionHelloFrame(sessionId, hybrid)); } catch { /* */ }
              // Feed the result back to the SAME realtime model and ask it to
              // speak. Its output transcript is the single persisted assistant
              // turn, so stored history matches exactly what Sir heard.
              const result = r.text || "The action ended without a verifiable result.";
              if (observedTurn) {
                recordObservedTurn(observedTurn, {
                  spanId: delegationSpanId,
                  type: "agent.delegation.completed",
                  status: "success",
                  title: "Delegated AVA action completed",
                  summary: "The child agent returned a result for the realtime model to speak.",
                  visibility: "sensitive_collapsed",
                  payload: { result },
                  actionOwner: "observer",
                  terminal: true,
                });
              }
              try { client.send(actionResultFrame(formatSpeechText(result))); } catch { /* */ }
              responseRequested = true;
              actionRuns.finish(action.id);
              // A typed turn may have landed while the delegated action was
              // running. Give it to the same realtime conversation before the
              // tool result asks the model to speak.
              syncTypedHistoryIntoRealtime();
              for (const frame of toolResultFrames(call.callId, result)) upstream.send(frame);
            } catch (e) {
              if (!actionRuns.isCurrent(action.id) || action.signal.aborted) {
                log.info("realtime: action ended after cancellation; no result will be spoken");
                if (observedTurn) {
                  recordObservedTurn(observedTurn, {
                    parentSpanId: delegationSpanId,
                    type: "agent.delegation.cancelled",
                    status: "cancelled",
                    title: "Delegated action cancelled",
                    actionOwner: "observer",
                  });
                }
                return;
              }
              if (e instanceof Error && e.name === "AbortError") {
                actionRuns.finish(action.id);
                log.info("realtime: action was killed; no result will be spoken");
                return;
              }
              actionRuns.finish(action.id);
              const msg = e instanceof Error ? e.message : String(e);
              if (observedTurn) {
                recordObservedTurn(observedTurn, {
                  spanId: delegationSpanId,
                  type: "agent.delegation.failed",
                  status: "error",
                  title: "Delegated AVA action failed",
                  error: msg,
                  actionOwner: "observer",
                  terminal: true,
                });
              }
              const result = `That didn't work, Sir — ${msg}`;
              try { client.send(actionResultFrame(formatSpeechText(result))); } catch { /* */ }
              responseRequested = true;
              for (const frame of toolResultFrames(call.callId, `error: ${msg}`)) upstream.send(frame);
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
        ? decideTranscriptForward(
            speechEndMs == null ? evt : { ...evt, audio_end_ms: evt.audio_end_ms ?? speechEndMs },
            speechStartMs,
            gateConfig,
            pushToTalk,
          )
        : null;
      if (decision?.isTranscript) {
        speechStartMs = null; // consume the in-flight utterance's timing
        speechEndMs = null;
        // Log the reason code only — never the raw audio. Transcript text is
        // short and useful for tuning; audio append frames are never logged.
        if (!decision.forward) {
          log.info(
            `realtime: dropped transcript reason=${decision.reason} speechMs=${decision.speechMs ?? "?"} text=${JSON.stringify(decision.text)}`,
          );
          recordVoiceSession({
            producerId: "ava:voice",
            type: "voice.transcript.rejected",
            status: "skipped",
            title: "Transcript rejected by the voice gate",
            summary: `Reason: ${decision.reason}. No AVA task was created.`,
            visibility: "sensitive_collapsed",
            privacyLevel: "personal",
            payload: {
              transcript: decision.text,
              reason: decision.reason,
              speechMs: decision.speechMs,
            },
          });
          // Push-to-talk: the client is stuck in "thinking" after its commit and
          // no reply is coming. Tell it to recover deterministically instead of
          // waiting out its safety timer (an empty/blank commit is the only PTT
          // drop now that the gate skips the denylist for held commits).
          if (pushToTalk) {
            try { if (client.readyState === WebSocket.OPEN) client.send(recoverFrame(decision.reason)); } catch { /* */ }
          }
          return; // do not forward — no phantom turn, no /api/chat call
        }
        // Application-level completeness gate. Semantic VAD is probabilistic and
        // the real trace still split "I want you to go" / "into WhatsApp".
        // Push-to-talk has an explicit owner-chosen boundary, so only automatic
        // hands-free turns are accumulated here.
        let acceptedText = decision.text;
        if (!pushToTalk) {
          const offered = voiceTurns.offer(
            decision.text,
            typeof evt?.item_id === "string" ? evt.item_id : null,
          );
          for (const itemId of offered.discardedItemIds) {
            try {
              upstream.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
            } catch { /* */ }
          }
          if (offered.kind === "hold") {
            clearFragmentTimer();
            log.info(`realtime: holding incomplete transcript text=${JSON.stringify(offered.text)}`);
            recordVoiceSession({
              producerId: "ava:voice",
              type: "voice.transcript.pending",
              status: "waiting",
              title: "Waiting for the rest of an utterance",
              summary: "AVA held an incomplete fragment instead of executing it.",
              visibility: "sensitive_collapsed",
              privacyLevel: "personal",
              payload: { transcript: offered.text },
            });
            try {
              if (client.readyState === WebSocket.OPEN) {
                client.send(transcriptPendingFrame(offered.text));
              }
            } catch { /* */ }
            fragmentTimer = setTimeout(() => {
              fragmentTimer = null;
              const expired = voiceTurns.expire();
              if (!expired) return;
              log.info(`realtime: expired incomplete transcript text=${JSON.stringify(expired.text)}`);
              recordVoiceSession({
                producerId: "ava:voice",
                type: "voice.transcript.expired",
                status: "skipped",
                title: "Incomplete utterance expired",
                summary: "The held fragment was discarded without execution.",
                visibility: "sensitive_collapsed",
                privacyLevel: "personal",
                payload: { transcript: expired.text },
              });
              // Remove discarded items from the model's context so a later,
              // unrelated command cannot accidentally complete the old fragment.
              for (const itemId of expired.itemIds) {
                try {
                  if (upstream.readyState === WebSocket.OPEN) {
                    upstream.send(JSON.stringify({ type: "conversation.item.delete", item_id: itemId }));
                  }
                } catch { /* */ }
              }
              try {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(recoverFrame("incomplete_fragment"));
                }
              } catch { /* */ }
            }, VOICE_FRAGMENT_HOLD_MS);
            return;
          }
          clearFragmentTimer();
          acceptedText = offered.text;
        }

        if (hybrid && responseActive) {
          // VOICE BARGE-IN: the owner talked OVER Ava (VAD keeps the mic forwarding
          // during "responding"). Reaching here means the transcript already passed
          // the gate — confident speech, not echo/silence — so treat it as a real
          // interruption: cancel Ava's in-flight response upstream and open a NEW
          // turn with these words instead of dropping them (the old behaviour, which
          // made "talk over her to stop her" do nothing). The gate + browser echo
          // cancellation keep Ava's own tail from retriggering this.
          log.info(`realtime: barge-in — accepted owner speech; cancelling response for ${JSON.stringify(acceptedText)}`);
          try { upstream.send(JSON.stringify({ type: "response.cancel" })); } catch { /* */ }
          responseActive = false;
          responseRequested = false;
          const partial = flushAssistantTurn(); // persist whatever Ava managed to say before the cut
          if (currentObservedTurn) {
            finishObservedTurn(currentObservedTurn, {
              type: "voice.turn.interrupted",
              status: "cancelled",
              title: "Niko interrupted AVA",
              summary: "Accepted owner speech stopped the previous response.",
              payload: partial ? { partialResponse: partial } : undefined,
              runStatus: "cancelled",
              outcome: "interrupted_by_user",
              verificationStatus: "not_verified",
            });
          }
          try { if (client.readyState === WebSocket.OPEN) client.send(bargeInFrame()); } catch { /* */ }
          // fall through: persist the user turn + response.create for the new turn
        } else if (hybrid && responseRequested) {
          // The prior response has only been requested, so response.cancel would
          // currently be invalid. Cancel it on response.created, then create one
          // response for this accepted turn after the cancelled response ends.
          cancelResponseOnCreate = true;
          responseAfterCancellation = true;
          cancelObservedTurn("interrupted_before_response_started", "Niko replaced the pending voice response");
          try { if (client.readyState === WebSocket.OPEN) client.send(bargeInFrame()); } catch { /* */ }
        }
        log.info(`realtime: accepted transcript text=${JSON.stringify(acceptedText)}`);
        beginObservedTurn(acceptedText);
        // SINGLE place the spoken USER turn is stored. Both earlier branches
        // (rejected transcript, "Ava is speaking") have already returned, so this
        // runs once per real utterance — no phantom turns. The internal /api/chat
        // run (do_on_computer) stores nothing (persist:false), so this is the one
        // source of truth for the user's words whether they chitchat or trigger
        // an action. HYBRID only: transcribe-only persists via /api/chat, so
        // storing here too would double the user turn.
        if (hybrid && sessionId) {
          const stored = appendMessage(deps.db, { sessionId, role: "user", content: acceptedText });
          persistedHistoryHighWater = Math.max(persistedHistoryHighWater, stored.id);
          touchSession(deps.db, sessionId);
        }
        // Send the caption first. Because upstream and browser are different
        // sockets, this ordering arms the browser's new-turn audio gate before
        // an exceptionally fast response.created/audio delta can arrive.
        try {
          if (client.readyState === WebSocket.OPEN) client.send(acceptedTranscriptFrame(acceptedText));
        } catch { /* client probably closed */ }
        if (hybrid && !responseActive && !responseRequested) {
          // Model didn't auto-reply (create_response:false). Now that the
          // transcript passed the gate, ask it to respond — speak or call a tool.
          responseRequested = true;
          try { upstream.send(JSON.stringify({ type: "response.create" })); } catch { /* */ }
        }
        return; // accepted transcript was forwarded above exactly once
      }

      // Forward everything else (and accepted transcripts) verbatim, preserving
      // text framing — the browser drops non-string messages.
      try {
        if (client.readyState === WebSocket.OPEN) forwardFrame(client, data, isBinary);
      } catch { /* client probably closed */ }
    });

    // ─── Lifecycle ────────────────────────────────────────────────────
    upstream.on("close", (code, reason) => {
      clearInterval(missionHeartbeat);
      const partial = flushAssistantTurn(); // don't lose a turn the model spoke before the socket dropped
      const r = reason?.toString() || "(no reason)";
      if (currentObservedTurn) {
        finishObservedTurn(currentObservedTurn, {
          type: "voice.turn.disconnected",
          status: code === 1000 ? "cancelled" : "error",
          title: "Voice turn ended when the upstream closed",
          summary: `OpenAI Realtime closed with code ${code}.`,
          payload: { closeCode: code, reason: r, partialResponse: partial || undefined },
          runStatus: code === 1000 ? "cancelled" : "failed",
          outcome: code === 1000 ? "voice_connection_closed" : "upstream_disconnected",
          verificationStatus: "not_verified",
        });
      }
      finishObservedSession(
        code === 1000 ? "completed" : "failed",
        code === 1000 ? "voice_session_closed" : "upstream_disconnected",
        code === 1000 ? "Voice session closed" : "OpenAI Realtime disconnected unexpectedly",
        code === 1000 ? undefined : r,
      );
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
      clearInterval(missionHeartbeat);
      if (currentObservedTurn) {
        finishObservedTurn(currentObservedTurn, {
          type: "voice.turn.failed",
          status: "error",
          title: "Voice upstream failed",
          summary: err.message,
          runStatus: "failed",
          outcome: "upstream_error",
          verificationStatus: "not_verified",
        });
      }
      finishObservedSession("failed", "upstream_error", "Voice upstream failed", err.message);
      try {
        client.send(JSON.stringify({ type: "error", error: { message: err.message } }));
      } catch { /* ignore */ }
      try { client.close(1011, "upstream error"); } catch { /* ignore */ }
    });

    client.on("close", () => {
      clearInterval(missionHeartbeat);
      clearFragmentTimer();
      voiceTurns.clear();
      actionRuns.cancel();
      cancelObservedTurn("client_disconnected", "Voice turn ended when the interface closed");
      finishObservedSession("completed", "client_closed", "Voice interface closed");
      try { upstream.close(); } catch { /* ignore */ }
    });
    client.on("error", (err) => {
      log.warn("realtime client error:", err.message);
      clearInterval(missionHeartbeat);
      clearFragmentTimer();
      voiceTurns.clear();
      actionRuns.cancel();
      if (currentObservedTurn) {
        finishObservedTurn(currentObservedTurn, {
          type: "voice.turn.failed",
          status: "error",
          title: "Voice interface connection failed",
          summary: err.message,
          runStatus: "failed",
          outcome: "client_socket_error",
          verificationStatus: "not_verified",
        });
      }
      finishObservedSession("failed", "client_socket_error", "Voice interface connection failed", err.message);
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
    wantNew = false,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const hybrid = !!deps.runAction;
      let sessionId = requestedSessionId;
      const actionRuns = new VoiceActionCoordinator();
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
          const { resumeId } = chooseResumeOrNew(wantNew, getMostRecentSession(deps.db)?.id ?? null);
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
        const summary = hybrid && sessionId
          ? buildVoiceConversationSummary(getSessionFull(deps.db, sessionId)?.summary)
          : "";
        const history = hybrid && sessionId
          ? summary + buildHumeHistoryBlock(listMessages(deps.db, sessionId), seedN)
          : "";
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
        try {
          const control = JSON.parse(raw) as { type?: string };
          if (control.type === "response.cancel") {
            actionRuns.cancel();
            return;
          }
        } catch { /* audio frame or non-JSON */ }
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
          const action = actionRuns.begin();
          try { client.send(actionStartedFrame(task)); } catch { /* */ }
          void (async () => {
            try {
              const r = await deps.runAction!(sessionId, task, (tool, args) => {
                if (!actionRuns.isCurrent(action.id)) return;
                try { client.send(stepFrame(tool, args)); } catch { /* */ }
              }, action.signal);
              if (!actionRuns.isCurrent(action.id)) return;
              sessionId = r.sessionId ?? sessionId;
              try { client.send(sessionHelloFrame(sessionId, hybrid)); } catch { /* */ }
              if (sessionId) {
                appendMessage(deps.db, { sessionId, role: "assistant", content: r.text || "Done." });
                touchSession(deps.db, sessionId);
              }
              const result = r.text || "The action ended without a verifiable result.";
              try { client.send(actionResultFrame(formatSpeechText(result))); } catch { /* */ }
              actionRuns.finish(action.id);
              try { upstream.send(humeToolResultFrame(callId, result)); } catch { /* */ }
            } catch (e) {
              if (!actionRuns.isCurrent(action.id) || action.signal.aborted) return;
              if (e instanceof Error && e.name === "AbortError") {
                actionRuns.finish(action.id);
                return;
              }
              actionRuns.finish(action.id);
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
        actionRuns.cancel();
        try { upstream.close(); } catch { /* */ }
      });
      client.on("error", () => {
        actionRuns.cancel();
        try { upstream.close(); } catch { /* */ }
      });
    });
  }

  return {
    attach: handleUpgrade,
    close: () => { wss.close(); },
  };
}
