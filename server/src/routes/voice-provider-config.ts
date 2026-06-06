// Voice realtime PROVIDER selection.
//
// The realtime voice proxy (voice-realtime.ts) speaks one of two upstreams:
//   - "openai"  — the GA gpt-realtime websocket (the existing, proven default).
//   - "hume"    — Hume EVI, selected only when fully configured.
//
// Selection is driven by `AVA_VOICE_PROVIDER` and reads ONLY `process.env`; it
// never opens or parses a `.env` file. If Hume is requested but its required
// config is missing, selection transparently falls back to OpenAI so voice keeps
// working. Crucially, NOTHING here ever logs or embeds a secret value — only the
// non-secret shape of the config (presence booleans, the public voice name) is
// ever surfaced, so a thrown/logged message can never leak `HUME_API_KEY`.

export type VoiceProviderName = "openai" | "hume";

/** Hume's default voice when the user hasn't pinned a specific one. */
export const DEFAULT_HUME_VOICE_NAME = "Alice Bennett";

/** Resolved, non-empty Hume settings. `apiKey` is the one hard requirement. */
export interface HumeProviderConfig {
  /** HUME_API_KEY — required for Hume to be selected. */
  apiKey: string;
  /** HUME_CONFIG_ID — optional EVI config id. */
  configId: string | null;
  /** HUME_VOICE_ID — optional exact voice id (preferred over the name). */
  voiceId: string | null;
  /** HUME_VOICE_NAME — defaults to "Alice Bennett". */
  voiceName: string;
}

export interface VoiceProviderConfig {
  /** Effective provider AFTER the readiness/fallback check. */
  provider: VoiceProviderName;
  /** What `AVA_VOICE_PROVIDER` asked for (before fallback). */
  requested: VoiceProviderName;
  /** Present only when `provider === "hume"`. */
  hume: HumeProviderConfig | null;
  /** True when Hume was requested but we fell back to OpenAI. */
  fellBack: boolean;
  /** Non-secret, human-readable explanation of the choice. Safe to log. */
  reason: string;
}

type Env = Record<string, string | undefined>;

/** Trim a string env var, returning null for missing/blank. */
function str(env: Env, key: string): string | null {
  const raw = env[key];
  if (raw == null) return null;
  const v = raw.trim();
  return v === "" ? null : v;
}

/** Parse `AVA_VOICE_PROVIDER` → a known provider name (defaults to openai). */
export function parseRequestedProvider(env: Env = process.env): VoiceProviderName {
  const raw = (env.AVA_VOICE_PROVIDER ?? "").trim().toLowerCase();
  return raw === "hume" ? "hume" : "openai";
}

/**
 * Resolve the effective voice provider from the environment.
 *
 * Defaults to OpenAI. Selects Hume only when `AVA_VOICE_PROVIDER=hume` AND
 * `HUME_API_KEY` is set; otherwise falls back to OpenAI with a non-secret reason.
 * `HUME_VOICE_NAME` defaults to "Alice Bennett"; `HUME_CONFIG_ID` / `HUME_VOICE_ID`
 * are optional and left null when unset.
 */
export function resolveVoiceProvider(env: Env = process.env): VoiceProviderConfig {
  const requested = parseRequestedProvider(env);
  if (requested !== "hume") {
    return { provider: "openai", requested, hume: null, fellBack: false, reason: "AVA_VOICE_PROVIDER=openai (default)" };
  }

  const apiKey = str(env, "HUME_API_KEY");
  if (!apiKey) {
    // Requested Hume but it's not usable — fall back. Never echo the (absent) key.
    return {
      provider: "openai",
      requested,
      hume: null,
      fellBack: true,
      reason: "AVA_VOICE_PROVIDER=hume but HUME_API_KEY is not set — falling back to OpenAI",
    };
  }

  const hume: HumeProviderConfig = {
    apiKey,
    configId: str(env, "HUME_CONFIG_ID"),
    voiceId: str(env, "HUME_VOICE_ID"),
    voiceName: str(env, "HUME_VOICE_NAME") ?? DEFAULT_HUME_VOICE_NAME,
  };
  return { provider: "hume", requested, hume, fellBack: false, reason: "AVA_VOICE_PROVIDER=hume (configured)" };
}

/**
 * A non-secret, log-safe summary of a resolved provider config. Reports only
 * PRESENCE of secrets/ids (never their values) plus the public voice name, so it
 * is always safe to log or include in an error message.
 */
export function describeVoiceProvider(cfg: VoiceProviderConfig): Record<string, unknown> {
  return {
    provider: cfg.provider,
    requested: cfg.requested,
    fellBack: cfg.fellBack,
    hasApiKey: cfg.hume != null,
    hasConfigId: !!cfg.hume?.configId,
    hasVoiceId: !!cfg.hume?.voiceId,
    voiceName: cfg.hume?.voiceName ?? null,
  };
}

/**
 * Redact known secret substrings from an arbitrary message before it is logged
 * or thrown. Used as a defense-in-depth so an upstream library error that echoes
 * a URL/header containing the API key can never surface the raw secret.
 */
export function redactSecrets(message: string, secrets: Array<string | null | undefined>): string {
  let out = message;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  }
  return out;
}

/**
 * Build the Hume EVI chat websocket URL. The API key and optional config id are
 * passed as query params (Hume EVI's documented browser/ws auth). The returned
 * URL contains the secret, so it must NEVER be logged — use describeVoiceProvider
 * for diagnostics instead.
 */
export function buildHumeRealtimeUrl(hume: HumeProviderConfig): string {
  const params = new URLSearchParams({ api_key: hume.apiKey });
  if (hume.configId) params.set("config_id", hume.configId);
  return `wss://api.hume.ai/v0/evi/chat?${params.toString()}`;
}
