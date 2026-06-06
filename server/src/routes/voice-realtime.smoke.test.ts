import { describe, it, expect } from "vitest";
import { buildRealtimeProxy } from "./voice-realtime.js";
import { resolveVoiceProvider } from "./voice-provider-config.js";

describe("voice-realtime module", () => {
  it("exports buildRealtimeProxy", () => {
    expect(typeof buildRealtimeProxy).toBe("function");
  });

  it("builds with the default OpenAI provider (fallback remains available)", () => {
    const logs: unknown[][] = [];
    const proxy = buildRealtimeProxy({
      db: {} as never,
      apiKey: "sk-test",
      memoryDir: "/tmp",
      providerConfig: resolveVoiceProvider({ AVA_VOICE_PROVIDER: "hume" }), // no key → falls back
      log: { info: (...a) => logs.push(a), warn: () => {}, error: () => {} },
    });
    expect(typeof proxy.attach).toBe("function");
    // The non-secret provider summary is logged at build; it must show OpenAI and
    // never carry a key value.
    const flat = JSON.stringify(logs);
    expect(flat).toContain("openai");
    expect(flat).not.toContain("sk-");
    proxy.close();
  });

  it("builds with a Hume provider config without throwing or logging the key", () => {
    const logs: unknown[][] = [];
    const proxy = buildRealtimeProxy({
      db: {} as never,
      apiKey: "sk-test",
      memoryDir: "/tmp",
      providerConfig: resolveVoiceProvider({ AVA_VOICE_PROVIDER: "hume", HUME_API_KEY: "hume-super-secret" }),
      log: { info: (...a) => logs.push(a), warn: () => {}, error: () => {} },
    });
    const flat = JSON.stringify(logs);
    expect(flat).toContain("hume");
    expect(flat).not.toContain("hume-super-secret");
    proxy.close();
  });
});
