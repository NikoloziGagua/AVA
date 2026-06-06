import type { ToolDef } from "./ava-mcp.js";
import { readDevLog, currentInProgress, type DevLogEntry } from "../self/dev-log.js";

export type UpdateLogToolDeps = { dataDir: string };

function formatEntry(e: DevLogEntry): string {
  let line = `[${e.phase}] ${e.title}`;
  if (e.detail) line += ` — ${e.detail}`;
  if (e.commits && e.commits.length > 0) line += ` (commits: ${e.commits.join(", ")})`;
  return line;
}

export function buildUpdateLogTools(deps: UpdateLogToolDeps): ToolDef[] {
  return [
    {
      tool: {
        name: "read_claude_updates",
        description:
          "Read the notes Claude — Sir's developer/coding agent — leaves about changes to your own code. Use this whenever Sir asks what's happening, what changed, what Claude did, or whether an update is running. Attribute Claude's actions to Claude and your own requests to yourself; never claim Claude's work as your own.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "how many recent entries to show (default 10)" },
          },
        },
      },
      run: async (args) => {
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const inProgress = currentInProgress(deps.dataDir);
        const entries = readDevLog(deps.dataDir, limit);
        if (entries.length === 0) return { ok: true, text: "No Claude update notes yet." };
        const lines: string[] = [];
        if (inProgress) {
          lines.push(`IN PROGRESS — Claude is currently: ${inProgress.title}`);
          if (inProgress.detail) lines.push(inProgress.detail);
          lines.push("");
        }
        lines.push("Recent updates:");
        for (const e of entries) lines.push(formatEntry(e));
        return { ok: true, text: lines.join("\n") };
      },
    },
  ];
}
