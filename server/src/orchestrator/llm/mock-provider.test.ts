import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "./mock-provider.js";
import type { StreamEvent } from "./types.js";

describe("MockLLMProvider", () => {
  it("emits scripted stream events", async () => {
    const events: StreamEvent[] = [
      { kind: "delta", text: "Hello, " },
      { kind: "delta", text: "Sir." },
      { kind: "done", stop_reason: "end_turn" },
    ];
    const p = new MockLLMProvider({ scripts: [events] });
    const ac = new AbortController();
    const out: StreamEvent[] = [];
    for await (const e of p.stream({
      model: "mock",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      abort: ac.signal,
    })) {
      out.push(e);
    }
    expect(out).toEqual(events);
  });

  it("complete returns scripted text", async () => {
    const p = new MockLLMProvider({ completions: ["Done."] });
    const r = await p.complete({ model: "mock", system: "s", user: "u", maxTokens: 10 });
    expect(r).toBe("Done.");
  });

  it("throws if scripts run out", async () => {
    const p = new MockLLMProvider({ scripts: [] });
    const ac = new AbortController();
    await expect(async () => {
      for await (const _ of p.stream({
        model: "mock", system: "", messages: [], tools: [], abort: ac.signal,
      })) { /* drain */ }
    }).rejects.toThrow(/no scripts left/i);
  });
});
