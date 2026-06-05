// Shared voice-output defaults.
//
// The HTTP TTS route (voice.ts) and the realtime hybrid proxy (voice-realtime.ts)
// both need a default speaker when the caller has saved no preference. They used
// to hardcode that id independently ("nova" vs "alloy"), which let them drift —
// one female, one neutral. Centralizing it here gives both paths a single source
// of truth so the no-preference default is the same female voice everywhere.

/**
 * Default voice/speaker id used when no saved preference is supplied.
 *
 * "shimmer" is a female voice supported by BOTH the `gpt-4o-mini-tts` HTTP speech
 * model and the GA `gpt-realtime` audio-output model, so a single constant can
 * back both delivery paths. Callers may still override per request; only this
 * unspecified-preference fallback is defined here.
 */
export const DEFAULT_VOICE = "shimmer";
