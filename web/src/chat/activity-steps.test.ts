import { describe, it, expect } from "vitest";
import { deriveSteps, isExecuting, currentTool } from "./activity-steps.js";
import type { StreamEvent } from "./useChatStream.js";

const ev = (id: number, kind: StreamEvent["kind"], payload: unknown): StreamEvent =>
  ({ id, runEpoch: 1, kind, payload } as StreamEvent);

describe("activity-steps", () => {
  it("a tool_call is a running step with a humanized label until its result lands", () => {
    const calling = [ev(1, "tool_call", { tool: "chrome_navigate", args: { url: "https://bing.com" } })];
    expect(deriveSteps(calling)).toEqual([{ key: "c-1", label: "Opening bing.com", status: "running" }]);
    expect(isExecuting(calling)).toBe(true);
    expect(currentTool(calling)).toBe("Opening bing.com");
  });

  it("a tool_result completes the matching call (with ok), keeping the humanized label", () => {
    const done = [
      ev(1, "tool_call", { tool: "chrome_navigate", args: { url: "https://bing.com" } }),
      ev(2, "tool_result", { tool: "chrome_navigate", ok: true, result: "6 results" }),
    ];
    const steps = deriveSteps(done);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: "done", ok: true, label: "Opening bing.com" });
    expect(isExecuting(done)).toBe(false);
    expect(currentTool(done)).toBeNull();
  });

  it("tracks multiple sequential tools", () => {
    const steps = deriveSteps([
      ev(1, "tool_call", { tool: "fs_read", args: { path: "a.txt" } }),
      ev(2, "tool_result", { tool: "fs_read", ok: true, result: "" }),
      ev(3, "tool_call", { tool: "shell", args: { command: "git status" } }),
    ]);
    expect(steps.map((s) => s.status)).toEqual(["done", "running"]);
    expect(currentTool([
      ev(1, "tool_call", { tool: "fs_read", args: { path: "a.txt" } }),
      ev(3, "tool_call", { tool: "shell", args: { command: "git status" } }),
    ])).toBe("Running git status");
  });

  it("overlapping calls to the same tool complete first-in-first-out", () => {
    const overlapping = [
      ev(1, "tool_call", { tool: "shell", args: { command: "sleep 5" } }),
      ev(2, "tool_call", { tool: "shell", args: { command: "git status" } }),
      ev(3, "tool_result", { tool: "shell", ok: false, result: "timed out" }),
    ];
    const mid = deriveSteps(overlapping);
    expect(mid.map((s) => s.status)).toEqual(["done", "running"]);
    expect(mid[0]).toMatchObject({ label: "Running sleep 5", ok: false });
    expect(currentTool(overlapping)).toBe("Running git status");

    const both = deriveSteps([...overlapping, ev(4, "tool_result", { tool: "shell", ok: true, result: "clean" })]);
    expect(both.map((s) => s.status)).toEqual(["done", "done"]);
    expect(both[0]).toMatchObject({ label: "Running sleep 5", ok: false });
    expect(both[1]).toMatchObject({ label: "Running git status", ok: true });
    expect(isExecuting(both)).toBe(false);
  });

  it("a failed result carries a short single-line reason plus a fuller tooltip reason", () => {
    const messy = "ENOENT: no such file\n   or directory,  open 'C:/x.txt'" + " deep stack".repeat(40);
    const steps = deriveSteps([
      ev(1, "tool_call", { tool: "fs_read", args: { path: "x.txt" } }),
      ev(2, "tool_result", { tool: "fs_read", ok: false, result: messy }),
    ]);
    const step = steps[0]!;
    expect(step).toMatchObject({ status: "done", ok: false });
    expect(step.reason!.startsWith("ENOENT: no such file or directory, open 'C:/x.txt'")).toBe(true);
    expect(step.reason!.length).toBeLessThanOrEqual(90);
    expect(step.reason).not.toMatch(/\n/);
    expect(step.reason!.endsWith("…")).toBe(true);
    expect(step.reasonFull!.length).toBeLessThanOrEqual(300);
    expect(step.reasonFull!.length).toBeGreaterThan(step.reason!.length);
  });

  it("successful results carry no reason", () => {
    const steps = deriveSteps([
      ev(1, "tool_call", { tool: "shell", args: { command: "ls" } }),
      ev(2, "tool_result", { tool: "shell", ok: true, result: "a very long stdout dump that must not leak into the panel" }),
    ]);
    expect(steps[0]!.reason).toBeUndefined();
    expect(steps[0]!.reasonFull).toBeUndefined();
  });

  it("an unmatched failed result still shows its reason", () => {
    const steps = deriveSteps([ev(9, "tool_result", { tool: "shell", ok: false, result: "  killed \n by signal " })]);
    expect(steps[0]).toMatchObject({ status: "done", ok: false, reason: "killed by signal" });
  });
});
