import { describe, it, expect } from "vitest";
import { autoTitle } from "./auto-title.js";
import { MockLLMProvider } from "./llm/mock-provider.js";

describe("autoTitle", () => {
  it("uses the model response when the API returns text", async () => {
    const provider = new MockLLMProvider({ completions: ["Refactor login flow"] });
    const t = await autoTitle({ provider, firstMessage: "I need to refactor the login code" });
    expect(t).toBe("Refactor login flow");
    expect(provider.calls.complete).toHaveLength(1);
    expect(provider.calls.complete[0]?.user).toBe("I need to refactor the login code");
    expect(provider.calls.complete[0]?.maxTokens).toBe(32);
    expect(provider.calls.complete[0]?.model).toBe(provider.defaultSideModel);
  });

  it("trims and truncates a model response longer than 60 chars", async () => {
    const provider = new MockLLMProvider({
      completions: [" A very long title that exceeds the cap for sure and keeps going forever "],
    });
    const t = await autoTitle({ provider, firstMessage: "x" });
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toMatch(/^\s|\s$/);
  });

  it("falls back to truncation on API error", async () => {
    // Empty completions list causes complete() to throw.
    const provider = new MockLLMProvider({ completions: [] });
    const t = await autoTitle({
      provider,
      firstMessage: "list the contents of my Downloads folder, please, please",
    });
    expect(t).toBe("list the contents of my Downloads folder, please, please".slice(0, 60));
  });

  it("falls back to truncation when the API returns an empty string", async () => {
    const provider = new MockLLMProvider({ completions: [""] });
    const t = await autoTitle({ provider, firstMessage: "hello world" });
    expect(t).toBe("hello world");
  });
});
