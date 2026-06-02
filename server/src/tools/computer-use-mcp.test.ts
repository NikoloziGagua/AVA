import { describe, it, expect, vi } from "vitest";

vi.mock("./computer-use.js", () => ({
  runComputerUse: vi.fn(async () => ({ ok: true, summary: "did it", screenshots: [] })),
  runComputerUseOpenAI: vi.fn(async () => ({ ok: true, summary: "did it", screenshots: [] })),
}));

import { buildComputerUseTool } from "./computer-use-mcp.js";

describe("buildComputerUseTool (lazy chrome)", () => {
  it("does not boot chrome at construction time", () => {
    const getChrome = vi.fn();
    buildComputerUseTool({ anthropic: {} as any, openai: null, getChrome, emit: () => {} });
    expect(getChrome).not.toHaveBeenCalled();
  });

  it("boots chrome only when a provider actually runs the task", async () => {
    const chrome = {} as any;
    const getChrome = vi.fn(async () => chrome);
    const t = buildComputerUseTool({ anthropic: {} as any, openai: null, getChrome, emit: () => {} });

    expect(getChrome).not.toHaveBeenCalled();
    await t.run({ task: "open example" });
    expect(getChrome).toHaveBeenCalledTimes(1);
  });

  it("does not boot chrome when no provider key is configured", async () => {
    const getChrome = vi.fn();
    const t = buildComputerUseTool({ anthropic: null, openai: null, getChrome, emit: () => {} });
    const r = await t.run({ task: "open example" });
    expect(getChrome).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});
