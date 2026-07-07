// Server-side gate that decides whether a speech-to-text transcript represents
// real speech worth acting on — or noise/silence that the transcriber
// hallucinated into words.
//
// Why this exists: OpenAI's realtime server-VAD + whisper will, on silence or
// background noise, emit a confident-looking transcript that is actually a
// hallucination ("you", "Thank you.", "Thanks for watching."). Acting on those
// produces phantom user turns and unsolicited replies. This gate is the single
// chokepoint every transcript passes through before it can become a real turn.
//
// It is intentionally a pure function (no I/O, no SDK types) so the policy is
// trivially unit-testable. The realtime WS proxy is the only producer of voice
// transcripts; it runs every finished transcript through this gate before the
// browser may submit it to the /api/chat agent.

export interface TranscriptGateConfig {
  /** Reject transcripts shorter than this many characters (after normalization). */
  minChars: number;
  /**
   * Reject when the measured speech segment (VAD speech_started→speech_stopped)
   * is shorter than this. Real words take time; a sub-threshold blip is noise.
   * Only enforced when a duration is supplied.
   */
  minSpeechMs: number;
  /**
   * Reject when the transcriber's no-speech probability is above this. Only
   * enforced when the transcriber actually reports it (whisper-1 over the
   * realtime API often does not, so this is best-effort).
   */
  maxNoSpeechProb: number;
  /**
   * Reject when the transcriber's average token logprob is below this (i.e.
   * very low confidence). Only enforced when supplied.
   */
  minAvgLogprob: number;
  /**
   * Exact, normalized phrases that whisper emits on silence. A transcript whose
   * entire content is one of these is dropped regardless of length. Compared
   * case-insensitively with surrounding/trailing punctuation stripped.
   */
  hallucinationPhrases: string[];
}

export const DEFAULT_TRANSCRIPT_GATE: TranscriptGateConfig = {
  minChars: 2,
  minSpeechMs: 200,
  maxNoSpeechProb: 0.6,
  minAvgLogprob: -1.2,
  // The canonical whisper "silence words". Lowercased, punctuation-stripped.
  hallucinationPhrases: [
    "you",
    "thank you",
    "thanks",
    "thanks for watching",
    "thank you for watching",
    "thank you very much",
    "please subscribe",
    "bye",
    "okay",
    "ok",
    "so",
    "uh",
    "um",
    "hmm",
    "mm",
    "yeah",
    ".",
    "...",
  ],
};

export interface TranscriptGateInput {
  text: string;
  /** Speech duration in ms from VAD, if known. */
  speechMs?: number | null;
  /** Transcriber no-speech probability, if reported. */
  noSpeechProb?: number | null;
  /** Transcriber average logprob, if reported. */
  avgLogprob?: number | null;
  /**
   * True when the transcript comes from an EXPLICIT push-to-talk commit — the
   * owner physically held to talk and released. A held commit can't be a silence
   * hallucination, so the anti-hallucination heuristics (the phrase denylist plus
   * the too-brief / no-speech / low-confidence signals, which all exist to reject
   * whisper's silence words under automatic VAD) are skipped and only the
   * empty/whitespace check applies. This is why deliberate short commands
   * ("okay", "yeah", "thanks", "so", "bye") were silently vanishing.
   */
  pushToTalk?: boolean;
}

export type TranscriptGateReason =
  | "ok"
  | "empty"
  | "too_short"
  | "too_brief"
  | "low_confidence"
  | "hallucination_phrase";

export interface TranscriptGateResult {
  accept: boolean;
  reason: TranscriptGateReason;
  /** The normalized (trimmed, whitespace-collapsed) transcript. */
  text: string;
}

/** Collapse internal whitespace and trim. Preserves the user's words/casing. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Lowercase and strip leading/trailing punctuation for denylist comparison. */
function normalizeForMatch(text: string): string {
  return normalize(text)
    .toLowerCase()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "")
    .trim();
}

/**
 * Decide whether a transcript should become a real user turn.
 *
 * Order matters: cheap structural checks (empty/short) first, then the
 * hallucination denylist, then the optional confidence/duration signals that
 * are only present on some transcribers.
 */
export function gateTranscript(
  input: TranscriptGateInput,
  config: TranscriptGateConfig = DEFAULT_TRANSCRIPT_GATE,
): TranscriptGateResult {
  const text = normalize(input.text ?? "");

  if (text.length === 0) {
    return { accept: false, reason: "empty", text };
  }

  // Push-to-talk short-circuit: an explicit held commit is real speech by
  // construction, so past the empty/whitespace check above it is always accepted.
  // The denylist + brevity/confidence heuristics below only make sense for
  // automatic VAD (which fires on silence); applying them to a deliberate commit
  // is exactly what dropped one-word commands like "okay" / "yeah" / "thanks".
  if (input.pushToTalk) {
    return { accept: true, reason: "ok", text };
  }

  if (text.length < config.minChars) {
    return { accept: false, reason: "too_short", text };
  }

  const matchKey = normalizeForMatch(text);
  if (matchKey.length === 0) {
    // Punctuation-only transcript (e.g. "...", "."), reads as empty speech.
    return { accept: false, reason: "hallucination_phrase", text };
  }
  if (config.hallucinationPhrases.some((p) => normalizeForMatch(p) === matchKey)) {
    return { accept: false, reason: "hallucination_phrase", text };
  }

  if (typeof input.speechMs === "number" && input.speechMs < config.minSpeechMs) {
    return { accept: false, reason: "too_brief", text };
  }

  if (
    typeof input.noSpeechProb === "number" &&
    input.noSpeechProb > config.maxNoSpeechProb
  ) {
    return { accept: false, reason: "low_confidence", text };
  }
  if (
    typeof input.avgLogprob === "number" &&
    input.avgLogprob < config.minAvgLogprob
  ) {
    return { accept: false, reason: "low_confidence", text };
  }

  return { accept: true, reason: "ok", text };
}

/**
 * Build a gate config from environment overrides, falling back to the defaults.
 * Lets the owner tune sensitivity without a redeploy:
 *   VOICE_MIN_CHARS, VOICE_MIN_SPEECH_MS, VOICE_MAX_NO_SPEECH_PROB,
 *   VOICE_MIN_AVG_LOGPROB, VOICE_HALLUCINATION_PHRASES (comma-separated).
 */
export function loadTranscriptGateConfig(
  env: Record<string, string | undefined> = process.env,
): TranscriptGateConfig {
  const num = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw == null || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const phrases = env.VOICE_HALLUCINATION_PHRASES;
  return {
    minChars: num("VOICE_MIN_CHARS", DEFAULT_TRANSCRIPT_GATE.minChars),
    minSpeechMs: num("VOICE_MIN_SPEECH_MS", DEFAULT_TRANSCRIPT_GATE.minSpeechMs),
    maxNoSpeechProb: num("VOICE_MAX_NO_SPEECH_PROB", DEFAULT_TRANSCRIPT_GATE.maxNoSpeechProb),
    minAvgLogprob: num("VOICE_MIN_AVG_LOGPROB", DEFAULT_TRANSCRIPT_GATE.minAvgLogprob),
    hallucinationPhrases:
      phrases != null && phrases.trim() !== ""
        ? phrases.split(",").map((p) => p.trim()).filter(Boolean)
        : DEFAULT_TRANSCRIPT_GATE.hallucinationPhrases,
  };
}
