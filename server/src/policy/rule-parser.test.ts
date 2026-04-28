import { describe, it, expect, vi } from "vitest";
import { parseRule } from "./rule-parser.js";

describe("parseRule", () => {
  it("returns ok with parsed JSON when the model returns valid JSON matching the schema", async () => {
    const fake = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '{"match":{"tool":"shell","args.command":["**rm**"]},"action":"deny"}' }],
        }),
      },
    };
    const r = await parseRule({ client: fake as never, source: "never let shell delete files" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.parsed).toEqual({ match: { tool: "shell", "args.command": ["**rm**"] }, action: "deny" });
  });

  it("fails with reason on invalid JSON", async () => {
    const fake = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "{not json" }] }) } };
    const r = await parseRule({ client: fake as never, source: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid JSON/i);
  });

  it("fails with reason on schema mismatch (missing match)", async () => {
    const fake = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: '{"action":"allow"}' }] }) } };
    const r = await parseRule({ client: fake as never, source: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/schema/i);
  });

  it("fails with reason on schema mismatch (bad action)", async () => {
    const fake = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: '{"match":{},"action":"maybe"}' }] }) } };
    const r = await parseRule({ client: fake as never, source: "x" });
    expect(r.ok).toBe(false);
  });

  it("fails when model returns no text block", async () => {
    const fake = { messages: { create: vi.fn().mockResolvedValue({ content: [] }) } };
    const r = await parseRule({ client: fake as never, source: "x" });
    expect(r.ok).toBe(false);
  });

  it("fails when client throws (rate limit, network)", async () => {
    const fake = { messages: { create: vi.fn().mockRejectedValue(new Error("429 rate limited")) } };
    const r = await parseRule({ client: fake as never, source: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/rate limited/);
  });
});
