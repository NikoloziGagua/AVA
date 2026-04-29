import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { summarizeChips } from "./chip-summarizer.js";
import { setCachedLabel, hashPrompt } from "../state/chip-label-cache.js";
import { MockLLMProvider } from "./llm/mock-provider.js";

const TTL_24H = 24 * 60 * 60 * 1000;

describe("summarizeChips", () => {
  it("returns cached labels without calling the provider", async () => {
    const db = openInMemoryDb();
    const provider = new MockLLMProvider({ completions: [] });
    setCachedLabel(db, "dev1", hashPrompt("foo"), "Cached label",
      Date.now() + TTL_24H);
    const out = await summarizeChips(
      [{ id: "a", prompt: "foo" }],
      { db, deviceId: "dev1", provider, nowMs: Date.now() },
    );
    expect(out).toEqual([{ id: "a", label: "Cached label" }]);
    expect(provider.calls.complete).toHaveLength(0);
  });

  it("batches all misses into a single provider call and returns mapped labels", async () => {
    const db = openInMemoryDb();
    const provider = new MockLLMProvider({
      completions: [JSON.stringify({
        labels: [
          { id: "a", label: "List home" },
          { id: "b", label: "Open yov" },
        ],
      })],
    });
    const now = Date.now();
    const out = await summarizeChips(
      [{ id: "a", prompt: "list ~ contents" },
       { id: "b", prompt: "open the yov project" }],
      { db, deviceId: "dev1", provider, nowMs: now },
    );
    expect(provider.calls.complete).toHaveLength(1);
    expect(out).toEqual([
      { id: "a", label: "List home" },
      { id: "b", label: "Open yov" },
    ]);
    // Cached for next call
    const cached = await summarizeChips(
      [{ id: "a", prompt: "list ~ contents" }],
      { db, deviceId: "dev1", provider, nowMs: now },
    );
    expect(cached).toEqual([{ id: "a", label: "List home" }]);
    expect(provider.calls.complete).toHaveLength(1); // still 1 — cached
  });

  it("falls back to the original prompt when LLM output is malformed", async () => {
    const db = openInMemoryDb();
    const provider = new MockLLMProvider({ completions: ["not json"] });
    const out = await summarizeChips(
      [{ id: "a", prompt: "list contents" }],
      { db, deviceId: "dev1", provider, nowMs: Date.now() },
    );
    expect(out[0]!.id).toBe("a");
    expect(out[0]!.label.length).toBeGreaterThan(0);
  });
});
