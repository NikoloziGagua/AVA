// server/src/tools/ava-mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";

export type RunCtx = {
  runId: string;
  /** The run's abort signal. Threaded into long-running tools (computer_use,
   *  claude_code) so the red Stop button can interrupt work already in flight,
   *  not just the model read-loop. Optional so existing call sites/tests that
   *  build a ctx without it still type-check. */
  signal?: AbortSignal;
};

export type ToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>, ctx: RunCtx) => Promise<{
    text: string;
    ok: boolean;
    verification?: ToolVerificationEvidence;
  }>;
};

export function buildAvaMcp(opts: { tools: ToolDef[]; ctx: RunCtx }): Server {
  const s = new Server(
    { name: "ava", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const byName = new Map(opts.tools.map((t) => [t.tool.name, t]));

  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => t.tool),
  }));

  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    const td = byName.get(req.params.name);
    if (!td) throw new Error(`unknown tool: ${req.params.name}`);
    const args = (req.params.arguments as Record<string, unknown>) ?? {};
    const r = await td.run(args, opts.ctx);
    return { content: [{ type: "text", text: r.text }] };
  });

  return s;
}
