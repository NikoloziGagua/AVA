import { describe, it, expect } from "vitest";
import { buildProvider } from "./factory.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, flush: async () => {} };

describe("buildProvider", () => {
  it("returns OpenAIProvider when preferred=openai and openai key set", () => {
    const p = buildProvider({ preferred: "openai", openaiApiKey: "sk-x", anthropicApiKey: null, log });
    expect(p?.name).toBe("openai");
  });

  it("returns AnthropicProvider when preferred=anthropic and anthropic key set", () => {
    const p = buildProvider({ preferred: "anthropic", openaiApiKey: null, anthropicApiKey: "sk-ant-x", log });
    expect(p?.name).toBe("anthropic");
  });

  it("falls back to the only available key when preferred is unavailable", () => {
    const p = buildProvider({ preferred: "openai", openaiApiKey: null, anthropicApiKey: "sk-ant-x", log });
    expect(p?.name).toBe("anthropic");
  });

  it("returns null when no provider is available", () => {
    const p = buildProvider({ preferred: "openai", openaiApiKey: null, anthropicApiKey: null, log });
    expect(p).toBeNull();
  });
});
