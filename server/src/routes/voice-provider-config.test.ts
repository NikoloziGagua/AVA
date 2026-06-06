import { describe, it, expect } from "vitest";
import {
  resolveVoiceProvider,
  parseRequestedProvider,
  describeVoiceProvider,
  redactSecrets,
  buildHumeRealtimeUrl,
  DEFAULT_HUME_VOICE_NAME,
} from "./voice-provider-config.js";

describe("parseRequestedProvider", () => {
  it("defaults to openai when unset or unknown", () => {
    expect(parseRequestedProvider({})).toBe("openai");
    expect(parseRequestedProvider({ AVA_VOICE_PROVIDER: "" })).toBe("openai");
    expect(parseRequestedProvider({ AVA_VOICE_PROVIDER: "azure" })).toBe("openai");
  });
  it("selects hume case-insensitively", () => {
    expect(parseRequestedProvider({ AVA_VOICE_PROVIDER: "hume" })).toBe("hume");
    expect(parseRequestedProvider({ AVA_VOICE_PROVIDER: " HUME " })).toBe("hume");
  });
});

describe("resolveVoiceProvider", () => {
  it("defaults to OpenAI with an empty environment", () => {
    const cfg = resolveVoiceProvider({});
    expect(cfg.provider).toBe("openai");
    expect(cfg.requested).toBe("openai");
    expect(cfg.hume).toBeNull();
    expect(cfg.fellBack).toBe(false);
  });

  it("selects Hume only when AVA_VOICE_PROVIDER=hume AND HUME_API_KEY is set", () => {
    const cfg = resolveVoiceProvider({ AVA_VOICE_PROVIDER: "hume", HUME_API_KEY: "sk-secret" });
    expect(cfg.provider).toBe("hume");
    expect(cfg.requested).toBe("hume");
    expect(cfg.fellBack).toBe(false);
    expect(cfg.hume?.apiKey).toBe("sk-secret");
  });

  it("falls back to OpenAI when Hume is requested but HUME_API_KEY is missing", () => {
    const cfg = resolveVoiceProvider({ AVA_VOICE_PROVIDER: "hume" });
    expect(cfg.provider).toBe("openai");
    expect(cfg.requested).toBe("hume");
    expect(cfg.fellBack).toBe(true);
    expect(cfg.hume).toBeNull();
    // The fallback reason must not contain a secret (there is none, but be sure).
    expect(cfg.reason).not.toContain("sk-");
  });

  it("defaults HUME_VOICE_NAME to 'Alice Bennett'", () => {
    const cfg = resolveVoiceProvider({ AVA_VOICE_PROVIDER: "hume", HUME_API_KEY: "k" });
    expect(cfg.hume?.voiceName).toBe("Alice Bennett");
    expect(cfg.hume?.voiceName).toBe(DEFAULT_HUME_VOICE_NAME);
  });

  it("honors an explicit HUME_VOICE_NAME and passes HUME_VOICE_ID / HUME_CONFIG_ID when present", () => {
    const cfg = resolveVoiceProvider({
      AVA_VOICE_PROVIDER: "hume",
      HUME_API_KEY: "k",
      HUME_VOICE_NAME: "Ito",
      HUME_VOICE_ID: "voice-123",
      HUME_CONFIG_ID: "cfg-456",
    });
    expect(cfg.hume?.voiceName).toBe("Ito");
    expect(cfg.hume?.voiceId).toBe("voice-123");
    expect(cfg.hume?.configId).toBe("cfg-456");
  });

  it("leaves optional ids null when blank", () => {
    const cfg = resolveVoiceProvider({ AVA_VOICE_PROVIDER: "hume", HUME_API_KEY: "k", HUME_VOICE_ID: "  ", HUME_CONFIG_ID: "" });
    expect(cfg.hume?.voiceId).toBeNull();
    expect(cfg.hume?.configId).toBeNull();
  });
});

describe("describeVoiceProvider — log-safe summary (no secrets)", () => {
  it("reports only presence booleans + the public voice name, never the key", () => {
    const cfg = resolveVoiceProvider({
      AVA_VOICE_PROVIDER: "hume",
      HUME_API_KEY: "super-secret-key",
      HUME_VOICE_ID: "vid",
    });
    const summary = describeVoiceProvider(cfg);
    expect(JSON.stringify(summary)).not.toContain("super-secret-key");
    expect(summary).toMatchObject({ provider: "hume", hasApiKey: true, hasVoiceId: true, hasConfigId: false, voiceName: "Alice Bennett" });
  });
});

describe("redactSecrets", () => {
  it("replaces secret substrings with [redacted]", () => {
    const msg = redactSecrets("connect failed for key=super-secret-key at host", ["super-secret-key", null, undefined]);
    expect(msg).not.toContain("super-secret-key");
    expect(msg).toContain("[redacted]");
  });
  it("ignores very short secrets to avoid mangling messages", () => {
    expect(redactSecrets("abc", ["ab"])).toBe("abc");
  });
});

describe("buildHumeRealtimeUrl", () => {
  it("includes the api key and config id as query params", () => {
    const url = buildHumeRealtimeUrl({ apiKey: "k1", secretKey: null, configId: "c1", voiceId: null, voiceName: "Alice Bennett" });
    expect(url.startsWith("wss://api.hume.ai/v0/evi/chat?")).toBe(true);
    expect(url).toContain("api_key=k1");
    expect(url).toContain("config_id=c1");
  });
  it("omits config_id when absent", () => {
    const url = buildHumeRealtimeUrl({ apiKey: "k1", secretKey: null, configId: null, voiceId: null, voiceName: "Alice Bennett" });
    expect(url).toContain("api_key=k1");
    expect(url).not.toContain("config_id");
  });
});
