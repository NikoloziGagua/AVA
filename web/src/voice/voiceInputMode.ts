// Voice input (endpointing) mode — how a spoken turn starts and ends.
//
//   "vad"               — hands-free server VAD (default). The realtime server
//                         decides when a turn begins/ends from the audio energy.
//   "enter_push_to_talk"— manual turn-taking. Mic audio is NOT sent until the
//                         owner presses Enter to start a turn; a second Enter
//                         finishes it (commit + reply). Background / external
//                         audio between turns is never transmitted. Good for
//                         noisy rooms and for not being interrupted by the TV.
//
// The choice is persisted in localStorage so it survives reloads, and is read by
// both the web client (mic gating + Enter binding) and forwarded to the server
// so it can disable automatic VAD/turn-detection for the realtime session.

import type { VoiceEngine } from "../api.js";

export type VoiceInputMode = "vad" | "enter_push_to_talk";

const KEY = "ava.voiceInputMode";

export const DEFAULT_VOICE_INPUT_MODE: VoiceInputMode = "vad";

function isVoiceInputMode(v: unknown): v is VoiceInputMode {
  return v === "vad" || v === "enter_push_to_talk";
}

/** Read the persisted mode, falling back to the default on miss/garbage. */
export function loadVoiceInputMode(): VoiceInputMode {
  try {
    const raw = localStorage.getItem(KEY);
    return isVoiceInputMode(raw) ? raw : DEFAULT_VOICE_INPUT_MODE;
  } catch {
    return DEFAULT_VOICE_INPUT_MODE;
  }
}

/** Persist the mode. Swallows storage errors (private mode / quota). */
export function saveVoiceInputMode(mode: VoiceInputMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}

/**
 * Whether a captured mic chunk should be forwarded upstream right now. This is
 * the single rule that keeps background/external audio out of the stream.
 *
 *   - muted               → never forward.
 *   - enter_push_to_talk  → forward ONLY while a turn is actively being captured
 *                           (between the start-Enter and the finish-Enter).
 *                           Between turns, nothing is sent, so the TV / room /
 *                           Ava's own reply can't become a phantom turn.
 *   - vad                 → forward while the client is in the "listening" state,
 *                           which is closed during thinking/responding so Ava's
 *                           reply isn't re-heard (unchanged behaviour).
 */
export function shouldForwardMic(opts: {
  mode: VoiceInputMode;
  muted: boolean;
  capturing: boolean;
  listening: boolean;
}): boolean {
  if (opts.muted) return false;
  if (opts.mode === "enter_push_to_talk") return opts.capturing;
  return opts.listening;
}

/**
 * Whether starting a new Enter push-to-talk turn should first interrupt Ava's
 * in-flight speech. Only an explicit new turn while she is speaking/thinking
 * counts — never background audio (which, in PTT mode, is never forwarded at
 * all). VAD-mode interruption is handled separately by the server gate, which
 * only acts on confidently-detected speech.
 */
export function shouldInterruptForNewTurn(state: string): boolean {
  return state === "responding" || state === "thinking";
}

/**
 * Whether the voice turn should hand the mic back to "listening" (reopen).
 *
 * Two callers:
 *   - the fast end-of-turn settle (requireGenDone=true): reopen only once Ava's
 *     generation is done AND her audio has drained — precise, no mid-reply clip.
 *   - a longer SAFETY FALLBACK (requireGenDone=false): reopen even if the
 *     realtime "response.done" never arrived, as long as no audio is playing and
 *     no action is running. This is what keeps hands-free from dying forever when
 *     the done-handshake is missed (the reported regression).
 */
export function shouldReopenListening(opts: {
  state: string;
  actionPending: boolean;
  playing: boolean;
  genDone: boolean;
  requireGenDone: boolean;
}): boolean {
  if (opts.actionPending) return false;          // do_on_computer still running
  if (opts.playing) return false;                // Ava is still speaking
  if (opts.state !== "responding" && opts.state !== "thinking") return false;
  if (opts.requireGenDone && !opts.genDone) return false;
  return true;
}

/**
 * When the TTS speak-queue drains, whether to reopen the mic to "listening".
 * During a do_on_computer task the queue drains BETWEEN narrated steps; stay
 * closed until the final result has been spoken, or the mic would reopen
 * mid-task and re-hear Ava. Outside a task (chit-chat TTS) it reopens at once.
 */
export function reopenAfterSpeak(opts: {
  state: string; actionPending: boolean; resultReceived: boolean;
}): "reopen" | "stay" {
  if (opts.state !== "responding") return "stay";
  if (!opts.actionPending) return "reopen";   // normal chit-chat TTS
  if (opts.resultReceived) return "reopen";    // task fully narrated
  return "stay";                               // between task steps
}

/**
 * Whether changing the endpointing mode must RECONNECT the realtime session.
 * The server fixes its turn_detection (VAD vs push-to-talk) at CONNECT time, so
 * a live mode switch only takes effect after a reconnect — without one, flipping
 * to push-to-talk leaves the server's VAD running (silence wrongly ends the turn
 * and empty buffers get committed: "buffer too small … 0.00ms"). No reconnect is
 * needed when the mode didn't change, or when no session is active ("idle") —
 * the next connect reads the mode from the URL.
 */
export function shouldReconnectForModeChange(
  prev: VoiceInputMode,
  next: VoiceInputMode,
  state: string,
): boolean {
  if (prev === next) return false;
  return state !== "idle";
}

/**
 * Whether changing the voice ENGINE must reconnect the realtime session.
 *
 * The engine value alone decides the realtime session shape: "chatterbox" makes
 * the realtime model transcribe-only (the client routes transcripts to /api/chat
 * and speaks via Chatterbox /api/speak), while "openai"/"hybrid" make the model
 * speak directly with the do_on_computer tool. Crucially, "openai" and "hybrid"
 * build an IDENTICAL realtime session — they differ only in the per-request
 * /api/speak TTS for narrated steps/results, which needs no reconnect. So the
 * ONLY engine change that alters the live realtime session is one that crosses
 * the chatterbox boundary; openai↔hybrid must NOT reconnect (it would needlessly
 * tear down a working session). As with the mode reconnect, an idle session needs
 * nothing — the next connect reads the engine server-side.
 */
export function shouldReconnectForEngineChange(
  prev: VoiceEngine,
  next: VoiceEngine,
  state: string,
): boolean {
  if (prev === next) return false;
  if (state === "idle") return false;
  // Crossing the chatterbox boundary in either direction is the only switch that
  // changes the realtime "speaks vs transcribe" session.
  return (prev === "chatterbox") !== (next === "chatterbox");
}

/**
 * Whether a realtime audio delta arriving now should be DROPPED because a
 * barge-in happened since this speaking turn began. interrupt() bumps an
 * "interrupt epoch"; the audio branch captures the epoch at the start of the
 * turn. If the live epoch has advanced past the captured one, every late delta
 * (the realtime model's tail, still streaming after response.cancel) must be
 * ignored — neither played nor allowed to re-arm "responding" — or Ava resumes
 * talking over Sir despite the barge-in.
 */
export function shouldDropAudioDelta(turnEpoch: number, currentEpoch: number): boolean {
  return currentEpoch !== turnEpoch;
}

// OpenAI rejects a committed input buffer under 100ms of audio. PCM16 mono at
// 24kHz → 100ms = 2400 samples × 2 bytes = 4800 bytes. The push-to-talk commit
// guards on this so a too-quick tap never sends an empty/sub-100ms buffer
// ("Error committing input audio buffer: buffer too small … 0.00ms").
export const MIN_COMMIT_BYTES = 4800;

export function hasEnoughAudio(bytes: number): boolean {
  return bytes >= MIN_COMMIT_BYTES;
}
