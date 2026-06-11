import type { ToolDef, RunCtx } from "../tools/ava-mcp.js";
import type { ToolDefinition, ToolCall, ToolResult } from "./llm/types.js";

export type ToolRegistry = {
  toolDefinitions(): ToolDefinition[];
  /**
   * `signal`, when provided, replaces ctx.signal for THIS dispatch — the agent
   * loop passes a per-call signal it aborts on budget timeout, so a timed-out
   * tool (e.g. computer_use's inner vision loop) is actually cancelled instead
   * of running on as an orphan against the shared browser.
   */
  dispatch(call: ToolCall, signal?: AbortSignal): Promise<ToolResult>;
  has(name: string): boolean;
};

/**
 * True when args is the parse-failure sentinel both LLM providers emit for
 * unparseable tool-call JSON: an object whose only own key is `_raw`.
 */
function isRawArgsSentinel(args: unknown): args is { _raw: unknown } {
  if (typeof args !== "object" || args === null) return false;
  const keys = Object.keys(args as Record<string, unknown>);
  return keys.length === 1 && keys[0] === "_raw";
}

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
    async dispatch(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
      const td = byName.get(call.name);
      if (!td) {
        return { call_id: call.id, output: `unknown tool: ${call.name}`, is_error: true };
      }
      // Malformed tool-args JSON: both providers surface an unparseable args blob
      // as the `{ _raw: "..." }` sentinel. Dispatching that runs the tool with
      // garbage (e.g. shell with an empty command). Instead, return a tool ERROR
      // the model can read and recover from — without ever invoking the tool.
      if (isRawArgsSentinel(call.args)) {
        const raw = String((call.args as { _raw: unknown })._raw ?? "");
        const truncated = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
        return {
          call_id: call.id,
          output: `malformed tool arguments: ${truncated}`,
          is_error: true,
        };
      }
      try {
        const args = (typeof call.args === "object" && call.args !== null)
          ? (call.args as Record<string, unknown>) : {};
        const r = await td.run(args, signal ? { ...opts.ctx, signal } : opts.ctx);
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
