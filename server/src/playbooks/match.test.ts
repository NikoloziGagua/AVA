import { describe, it, expect } from "vitest";
import { matchPlaybook } from "./match.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

const reply = (text: string) => new MockLLMProvider({ scripts: [[{ kind: "delta", text }, { kind: "done", stop_reason: "end_turn" }]] });
const index = [
  { slug: "download-electricity-bill", trigger: "download the electricity bill" },
  { slug: "post-tweet", trigger: "post a tweet" },
];

describe("matchPlaybook", () => {
  it("returns the slug the model picks", async () => {
    const slug = await matchPlaybook({ prompt: "grab my power bill", index, provider: reply("download-electricity-bill") });
    expect(slug).toBe("download-electricity-bill");
  });
  it("returns null when the model says none", async () => {
    const slug = await matchPlaybook({ prompt: "what's the weather", index, provider: reply("none") });
    expect(slug).toBeNull();
  });
  it("returns null when the model names a slug not in the index", async () => {
    const slug = await matchPlaybook({ prompt: "x", index, provider: reply("hallucinated-slug") });
    expect(slug).toBeNull();
  });
  it("returns null with an empty index without calling the model", async () => {
    let called = false;
    const base = reply("x");
    const provider = { ...base, stream: (...a: unknown[]) => { called = true; return (base.stream as any)(...a); } } as any;
    const slug = await matchPlaybook({ prompt: "x", index: [], provider });
    expect(slug).toBeNull();
    expect(called).toBe(false);
  });
});
