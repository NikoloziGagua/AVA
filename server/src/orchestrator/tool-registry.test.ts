import { describe, it, expect, vi } from "vitest";
import { buildToolRegistry } from "./tool-registry.js";
import type { ToolDef } from "../tools/ava-mcp.js";

function defOf(name: string, run = vi.fn().mockResolvedValue({ text: "ok", ok: true })): ToolDef {
  return {
    tool: { name, description: `desc ${name}`,
      inputSchema: { type: "object", properties: { x: { type: "string" } } } as const },
    run,
  };
}

describe("buildToolRegistry", () => {
  it("converts ToolDef[] to ToolDefinition[] for the provider", () => {
    const reg = buildToolRegistry({ tools: [defOf("a"), defOf("b")], ctx: { runId: "r1" } });
    const defs = reg.toolDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0]).toEqual({
      name: "a",
      description: "desc a",
      input_schema: { type: "object", properties: { x: { type: "string" } } },
    });
  });

  it("dispatches a ToolCall to the right ToolDef and packages the result", async () => {
    const run = vi.fn().mockResolvedValue({ text: "result-text", ok: true });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "a", args: { x: "y" } });
    expect(run).toHaveBeenCalledWith({ x: "y" }, { runId: "r1" });
    expect(r).toEqual({ call_id: "c1", output: "result-text", is_error: false });
  });

  it("threads the abort signal from ctx into the tool's run (so Stop reaches tools)", async () => {
    const run = vi.fn().mockResolvedValue({ text: "ok", ok: true });
    const ac = new AbortController();
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1", signal: ac.signal } });
    await reg.dispatch({ id: "c1", name: "a", args: { x: "y" } });
    expect(run).toHaveBeenCalledWith({ x: "y" }, { runId: "r1", signal: ac.signal });
  });

  it("packages an error when the ToolDef returns ok:false", async () => {
    const run = vi.fn().mockResolvedValue({ text: "boom", ok: false });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "a", args: {} });
    expect(r).toEqual({ call_id: "c1", output: "boom", is_error: true });
  });

  it("returns an error result for an unknown tool", async () => {
    const reg = buildToolRegistry({ tools: [defOf("a")], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "ghost", args: {} });
    expect(r).toEqual({ call_id: "c1", output: expect.stringContaining("unknown tool: ghost"), is_error: true });
  });

  it("malformed tool args ({_raw}) return an error WITHOUT running the tool", async () => {
    const run = vi.fn().mockResolvedValue({ text: "ran", ok: true });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "a", args: { _raw: '{"x": "broke' } });
    expect(run).not.toHaveBeenCalled();
    expect(r.is_error).toBe(true);
    expect(r.output).toContain("malformed tool arguments");
    expect(r.output).toContain('{"x": "broke');
    expect(r.call_id).toBe("c1");
  });

  it("truncates a very long _raw blob in the error message", async () => {
    const run = vi.fn().mockResolvedValue({ text: "ran", ok: true });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    const big = "x".repeat(500);
    const r = await reg.dispatch({ id: "c1", name: "a", args: { _raw: big } });
    expect(run).not.toHaveBeenCalled();
    expect(r.output).toContain("…");
    expect(r.output.length).toBeLessThan(300);
  });

  it("a legitimate arg literally named _raw alongside others still dispatches", async () => {
    // The sentinel is ONLY an object whose sole key is _raw. A real arg that
    // happens to include _raw among other keys must not be misclassified.
    const run = vi.fn().mockResolvedValue({ text: "ran", ok: true });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    await reg.dispatch({ id: "c1", name: "a", args: { _raw: "v", x: "y" } });
    expect(run).toHaveBeenCalledWith({ _raw: "v", x: "y" }, { runId: "r1" });
  });

  it("fills inputSchema defaults when the ToolDef has no properties key", () => {
    const td: ToolDef = {
      tool: { name: "z", description: "z", inputSchema: { type: "object" } as const },
      run: vi.fn(),
    };
    const reg = buildToolRegistry({ tools: [td], ctx: { runId: "r1" } });
    const def = reg.toolDefinitions()[0];
    expect(def?.input_schema).toEqual({ type: "object", properties: {} });
  });
});
