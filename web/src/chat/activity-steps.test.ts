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
});
