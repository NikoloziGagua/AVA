// Local Chatterbox TTS client.
//
// Chatterbox is a LOCAL text-to-speech server running Ava's cloned voice. When
// the voice engine is "chatterbox" or "hybrid", /api/speak synthesizes through
// it instead of OpenAI's gpt-4o-mini-tts, so task narration / results come back
// in the cloned voice.
//
// Contract: POST {CHATTERBOX_TTS_URL} with JSON {text} → audio/wav bytes.
// The URL comes from process.env.CHATTERBOX_TTS_URL, defaulting to the local
// server. This module owns the request (with a timeout) so the route stays thin.

export const DEFAULT_CHATTERBOX_TTS_URL = "http://127.0.0.1:8123/speak";

/** Resolve the Chatterbox endpoint from env, falling back to the local default. */
export function chatterboxUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.CHATTERBOX_TTS_URL;
  return raw && raw.trim() !== "" ? raw : DEFAULT_CHATTERBOX_TTS_URL;
}

/**
 * Synthesize `text` via the local Chatterbox server and return the WAV bytes.
 * Throws on a non-2xx response, network error, or timeout — the caller decides
 * whether to fall back to OpenAI. The request is bounded by `timeoutMs` (~30s)
 * so a hung local server never wedges the /api/speak handler.
 */
export async function chatterboxSpeak(
  text: string,
  opts: { url?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Buffer> {
  const url = opts.url ?? chatterboxUrl();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`chatterbox HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
