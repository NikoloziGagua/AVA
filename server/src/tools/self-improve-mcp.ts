import type { ToolDef } from "./ava-mcp.js";

export function buildSelfImproveTool(deps: { queue: (goal: string) => string }): ToolDef {
  return {
    tool: {
      name: "self_improve",
      description:
        "Queue an autonomous improvement to Ava's OWN code. Use when Sir says 'improve yourself' or asks Ava to change its own behavior/capabilities. Args: { goal }.",
      inputSchema: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
    },
    run: async (args) => {
      const goal = String(args.goal ?? "").trim();
      if (!goal) return { ok: false, text: "missing goal" };
      const id = deps.queue(goal);
      return { ok: true, text: `queued self-improvement ${id}: ${goal}` };
    },
  };
}
