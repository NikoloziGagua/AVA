import { describe, it, expect } from "vitest";
import { buildAvaMcp, type ToolDef } from "./ava-mcp.js";
import { buildScreenshotTool } from "./screenshot/screenshot-mcp.js";

/** Reach into the MCP server's registered request-handler map (keyed by method). */
function handlerFor(s: ReturnType<typeof buildAvaMcp>, method: string) {
  const map = (s as unknown as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<any>> })._requestHandlers;
  const h = map.get(method);
  if (!h) throw new Error(`no handler for ${method}`);
  return h;
}

async function listTools(tools: ToolDef[]) {
  const s = buildAvaMcp({ tools, ctx: { runId: "test" } });
  return handlerFor(s, "tools/list")({ method: "tools/list", params: {} }, {});
}

describe("buildAvaMcp tool registry", () => {
  it("lists take_screenshot among the available tools", async () => {
    const tools = [buildScreenshotTool() as ToolDef];
    const res = await listTools(tools);
    const names = res.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("take_screenshot");
  });

  it("routes a take_screenshot call to its run handler", async () => {
    const screenshot = buildScreenshotTool() as ToolDef;
    const s = buildAvaMcp({ tools: [screenshot], ctx: { runId: "test" } });
    const handler = handlerFor(s, "tools/call");
    // Disallowed path so no real capture runs; proves the call is wired through.
    const out = await handler(
      { method: "tools/call", params: { name: "take_screenshot", arguments: { path: "C:/not/allowed.png" } } },
      {} as any,
    );
    expect(out.content[0].text).toContain("disallowed_path");
  });
});
