import { describe, it, expect, vi } from "vitest";
import { buildSelfImproveTool, buildSelfImproveStatusTool } from "./self-improve-mcp.js";

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

describe("self_improve_status tool", () => {
  const rows = [
    { id: "imp-1", goal: "add screenshots", status: "implementing", trigger: "explicit", error: null, outcome: null, created_at: 2, detail: "CHANGE: add a screenshot tool", commit: null },
    { id: "imp-2", goal: "be faster", status: "swapped", trigger: "explicit", error: null, outcome: "shipped", created_at: 1, detail: "CHANGE: cache the thing", commit: "abcdef1234567" },
    { id: "imp-3", goal: "bad idea", status: "failed", trigger: "explicit", error: "tests failed: boom", outcome: null, created_at: 0, detail: null, commit: null },
  ];

  it("lists every task with its state", async () => {
    const t = buildSelfImproveStatusTool({ list: () => rows });
    const r = await t.run({}, { runId: "r" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("imp-1");
    expect(r.text).toContain("implementing");
    expect(r.text).toContain("be faster");
    expect(r.text).toContain("imp-3");
  });

  it("surfaces the error for a failed task", async () => {
    const t = buildSelfImproveStatusTool({ list: () => rows });
    const r = await t.run({}, { runId: "r" });
    expect(r.text).toContain("tests failed: boom");
  });

  it("filters to a single task by id", async () => {
    const t = buildSelfImproveStatusTool({ list: () => rows });
    const r = await t.run({ id: "imp-2" }, { runId: "r" });
    expect(r.text).toContain("imp-2");
    expect(r.text).not.toContain("imp-1");
  });

  it("gives the full detail of one task by id — what it changed + commit", async () => {
    const t = buildSelfImproveStatusTool({ list: () => rows });
    const r = await t.run({ id: "imp-2" }, { runId: "r" });
    expect(r.text).toContain("be faster");
    expect(r.text).toContain("cache the thing"); // the change brief
    expect(r.text).toContain("abcdef12"); // short commit
    expect(r.text.toLowerCase()).toContain("shipped");
  });

  it("reports cleanly when there are no tasks", async () => {
    const t = buildSelfImproveStatusTool({ list: () => [] });
    const r = await t.run({}, { runId: "r" });
    expect(r.ok).toBe(true);
    expect(r.text.toLowerCase()).toContain("no self-improvement");
  });

  it("reports when a requested id is unknown", async () => {
    const t = buildSelfImproveStatusTool({ list: () => rows });
    const r = await t.run({ id: "nope" }, { runId: "r" });
    expect(r.ok).toBe(true);
    expect(r.text.toLowerCase()).toContain("no self-improvement");
  });
});
