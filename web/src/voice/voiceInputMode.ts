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
