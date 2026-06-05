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

export type IntentStatusSummary = {
  id: string;
  goal: string;
  status: string;
  trigger: string;
  error: string | null;
  outcome: string | null;
  created_at: number;
};

export function buildSelfImproveStatusTool(deps: { list: () => IntentStatusSummary[] }): ToolDef {
  return {
    tool: {
      name: "self_improve_status",
      description:
        "Report the state of my self-improvement tasks: queued, reflecting, implementing, " +
        "verifying, swapped (=shipped/live), failed, or rolled_back. Use when Sir asks what " +
        "self-development is running, pending, or finished — or to check on a task he kicked " +
        "off earlier. Optional { id } to report just one task.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "optional intent id to report just that one task" } },
      },
    },
    run: async (args) => {
      const all = deps.list();
      if (all.length === 0) return { ok: true, text: "No self-improvement tasks yet." };
      const id = String(args.id ?? "").trim();
      const rows = id ? all.filter((r) => r.id === id) : all.slice(0, 12);
      if (rows.length === 0) return { ok: true, text: `No self-improvement task ${id}.` };
      const line = (r: IntentStatusSummary) => {
        const tail =
          r.status === "failed" && r.error ? ` — ${r.error.slice(0, 160)}`
            : r.status === "swapped" ? " — shipped (live)"
              : "";
        return `• ${r.id} [${r.status}] ${r.goal}${tail}`;
      };
      return { ok: true, text: rows.map(line).join("\n") };
    },
  };
}
