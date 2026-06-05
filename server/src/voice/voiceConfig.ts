// Centralized voice delivery config.
//
// Speech rate lives here (not inline in the TTS route) so it is testable and has
// a single source of truth. Sir prefers a snappier, faster-than-default delivery,
// so the baseline is bumped above the TTS engine's neutral 1.0.

/**
 * Default TTS speech rate. OpenAI's speech models accept `speed` in [0.25, 4.0]
 * where 1.0 is neutral. 1.15 reads noticeably faster without clipping clarity —
 * Sir's preference for snappy delivery.
 */
export const DEFAULT_SPEECH_RATE = 1.15;

/** Hard bounds the TTS engine accepts; out-of-range requests are clamped. */
export const MIN_SPEECH_RATE = 0.25;
export const MAX_SPEECH_RATE = 4.0;

/**
 * Resolve the speech rate for a TTS request: use the caller's value when it is a
 * finite number (clamped to the engine's accepted range), otherwise fall back to
 * the faster default. Centralizing this keeps the default in one place and makes
 * the "faster by default" behaviour unit-testable.
 */
export function resolveSpeechRate(requested?: unknown): number {
  let n: number;
  if (typeof requested === "number") n = requested;
  else if (typeof requested === "string" && requested.trim() !== "") n = Number(requested);
  else return DEFAULT_SPEECH_RATE;
  if (!Number.isFinite(n)) return DEFAULT_SPEECH_RATE;
  return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, n));
}
