import type { ToolDef } from "./ava-mcp.js";

export function buildSelfImproveTool(deps: { queue: (goal: string) => string | Promise<string> }): ToolDef {
  return {
    tool: {
      name: "self_improve",
      description:
        "Queue an improvement to Ava's OWN code using the worker selected in the Self screen (Claude Code or Codex). It will draft a PLAN and PAUSE for Sir's approval before writing any code. Never claim it is done when it was only queued. Args: { goal }.",
      inputSchema: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
    },
    run: async (args) => {
      const goal = String(args.goal ?? "").trim();
      if (!goal) return { ok: false, text: "missing goal" };
      const id = await deps.queue(goal);
      return {
        ok: true,
        text: `Queued self-improvement ${id}: "${goal}". I'll draft a plan and pause for your approval before changing any code — review and approve it in the Self screen.`,
      };
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
  /** What the change set out to do (the reflect brief) — so Sir sees what it involved. */
  detail: string | null;
  /** The shipped commit sha, when swapped. */
  commit: string | null;
  worker?: string;
};

export function buildSelfImproveStatusTool(deps: { list: () => IntentStatusSummary[] }): ToolDef {
  return {
    tool: {
      name: "self_improve_status",
      description:
        "Report my self-improvement tasks and explain what each one involved. States: " +
        "queued, reflecting, awaiting_approval (=plan drafted, waiting for Sir to approve " +
        "it before any code is written), implementing, verifying, recovering, " +
        "blocked (=verified candidate preserved, waiting for safe installation), " +
        "swapped (=shipped/live), failed, rolled_back. Use when Sir asks what " +
        "self-development is running, pending, or " +
        "finished, what I changed, or to recap improvements he missed while away. Pass " +
        "{ id } for the full detail of one task (what it changed + the commit).",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "optional intent id for the full detail of that one task" } },
      },
    },
    run: async (args) => {
      const all = deps.list();
      if (all.length === 0) return { ok: true, text: "No self-improvement tasks yet." };
      const id = String(args.id ?? "").trim();

      // Detail view: a full account of one task — what it set out to change, the
      // commit, and the outcome.
      if (id) {
        const r = all.find((x) => x.id === id);
        if (!r) return { ok: true, text: `No self-improvement task ${id}.` };
        const out = [`${r.id} — ${r.status === "swapped" ? "shipped (live)" : r.status}`, `Goal: ${r.goal}`];
        out.push(`Worker: ${r.worker ?? "claude"}`);
        if (r.detail) out.push(`What it involves: ${r.detail}`);
        if (r.commit) out.push(`Commit: ${r.commit.slice(0, 8)}`);
        if ((r.status === "failed" || r.status === "blocked") && r.error) {
          out.push(`${r.status === "blocked" ? "Installation blocked" : "Failed"}: ${r.error.slice(0, 200)}`);
        }
        return { ok: true, text: out.join("\n") };
      }

      // List view: one concise line per task; the goal says what it involves, and
      // Sir can ask about an id for the full change detail.
      const rows = all.slice(0, 12);
      const line = (r: IntentStatusSummary) => {
        const tail =
          (r.status === "failed" || r.status === "blocked") && r.error ? ` — ${r.error.slice(0, 120)}`
            : r.status === "swapped" ? " — shipped (live)"
              : "";
        return `• ${r.id} [${r.status}] (${r.worker ?? "claude"}) ${r.goal}${tail}`;
      };
      return {
        ok: true,
        text: rows.map(line).join("\n") + "\n\n(ask me about any id for the full detail of what it changed)",
      };
    },
  };
}
