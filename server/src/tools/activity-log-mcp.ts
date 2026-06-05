import type { ToolDef } from "./ava-mcp.js";
import { readRecentLogs, type SelectOpts } from "./activity-log.js";

export function buildReadLogsTool(deps: { logsDir: string }): ToolDef {
  return {
    tool: {
      name: "read_logs",
      description:
        "Read my own recent activity and error logs — what I did, which tools ran, and what failed — " +
        "so I can tell Sir what happened on a task or diagnose what went wrong. Use when Sir asks " +
        "'what did you do', 'what happened', 'how did that go', or 'what went wrong'. " +
        "Args: { level?: 'all'|'errors', contains?: keyword, limit?: number }.",
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["all", "errors"], description: "'errors' = warnings + errors only; default 'all'" },
          contains: { type: "string", description: "only lines containing this keyword, e.g. 'screenshot' or 'bing'" },
          limit: { type: "number", description: "max entries to return (default 30, max 100)" },
        },
      },
    },
    run: async (args) => {
      const opts: SelectOpts = {
        level: args.level === "errors" ? "errors" : "all",
        contains: typeof args.contains === "string" && args.contains.trim() ? args.contains.trim() : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      };
      const text = await readRecentLogs(deps.logsDir, opts);
      return { ok: true, text };
    },
  };
}
