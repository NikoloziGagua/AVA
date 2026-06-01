import { describe, it, expect, vi } from "vitest";
import { buildSelfImproveTool } from "./self-improve-mcp.js";

describe("self_improve tool", () => {
  it("queues the goal and returns the id in the text", async () => {
    const queue = vi.fn((_goal: string) => "imp-123");
    const t = buildSelfImproveTool({ queue });
    const r = await t.run({ goal: "be faster" }, { runId: "r" });
    expect(queue).toHaveBeenCalledWith("be faster");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("imp-123");
  });

  it("rejects an empty goal without queueing", async () => {
    const queue = vi.fn();
    const t = buildSelfImproveTool({ queue });
    const r = await t.run({ goal: "  " }, { runId: "r" });
    expect(queue).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});
