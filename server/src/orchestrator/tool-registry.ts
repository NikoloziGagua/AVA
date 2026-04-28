import type { ToolDef, RunCtx } from "../tools/ava-mcp.js";
import type { ToolDefinition, ToolCall, ToolResult } from "./llm/types.js";

export type ToolRegistry = {
  toolDefinitions(): ToolDefinition[];
  dispatch(call: ToolCall): Promise<ToolResult>;
  has(name: string): boolean;
};

export function buildToolRegistry(opts: { tools: ToolDef[]; ctx: RunCtx }): ToolRegistry {
  const byName = new Map(opts.tools.map((t) => [t.tool.name, t]));

  return {
    toolDefinitions(): ToolDefinition[] {
      return opts.tools.map((t) => {
        const schema = t.tool.inputSchema as { type?: string; properties?: Record<string, unknown>;
          required?: string[]; additionalProperties?: boolean } | undefined;
        return {
          name: t.tool.name,
          description: t.tool.description ?? "",
          input_schema: {
            type: "object",
            properties: schema?.properties ?? {},
            ...(schema?.required ? { required: schema.required } : {}),
            ...(typeof schema?.additionalProperties === "boolean"
              ? { additionalProperties: schema.additionalProperties } : {}),
          },
        };
      });
    },
    has(name: string): boolean {
      return byName.has(name);
    },
    async dispatch(call: ToolCall): Promise<ToolResult> {
      const td = byName.get(call.name);
      if (!td) {
        return { call_id: call.id, output: `unknown tool: ${call.name}`, is_error: true };
      }
      try {
        const args = (typeof call.args === "object" && call.args !== null)
          ? (call.args as Record<string, unknown>) : {};
        const r = await td.run(args, opts.ctx);
        return { call_id: call.id, output: r.text, is_error: !r.ok };
      } catch (err) {
        return {
          call_id: call.id,
          output: err instanceof Error ? err.message : String(err),
          is_error: true,
        };
      }
    },
  };
}
