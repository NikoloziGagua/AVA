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
