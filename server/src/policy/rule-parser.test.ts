import { describe, it, expect } from "vitest";
import { parseRule } from "./rule-parser.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

describe("parseRule", () => {
  it("returns ok with parsed JSON when the model returns valid JSON matching the schema", async () => {
    const provider = new MockLLMProvider({
      completions: ['{"match":{"tool":"shell","args.command":["**rm**"]},"action":"deny"}'],
    });
    const r = await parseRule({ provider, source: "never let shell delete files" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parsed).toEqual({ match: { tool: "shell", "args.command": ["**rm**"] }, action: "deny" });
  });

  it("fails with reason on invalid JSON", async () => {
    const provider = new MockLLMProvider({ completions: ["{not json"] });
    const r = await parseRule({ provider, source: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid JSON/i);
  });

  it("fails with reason on schema mismatch (missing match)", async () => {
    const provider = new MockLLMProvider({ completions: ['{"action":"allow"}'] });
    const r = await parseRule({ provider, source: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/schema/i);
  });

  it("fails with reason on schema mismatch (bad action)", async () => {
    const provider = new MockLLMProvider({ completions: ['{"match":{},"action":"maybe"}'] });
    const r = await parseRule({ provider, source: "x" });
    expect(r.ok).toBe(false);
  });

  it("fails when provider throws (rate limit, network)", async () => {
    const provider = new MockLLMProvider({ completions: [] });
    const r = await parseRule({ provider, source: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MockLLMProvider/);
  });
});
