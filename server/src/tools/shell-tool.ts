import type { ToolDef } from "./ava-mcp.js";
import { runShell } from "./shell.js";
import { TOOL_BUDGET_MS } from "../orchestrator/timeout.js";

const MAX_STREAM_CHARS = 4096;

function truncate(s: string): string {
  if (s.length <= MAX_STREAM_CHARS) return s;
  return s.slice(0, MAX_STREAM_CHARS) + `\n... [truncated, ${s.length - MAX_STREAM_CHARS} more chars]`;
}

export function buildShellTool(opts: { signal: AbortSignal }): ToolDef {
  return {
    tool: {
      name: "shell",
      description:
        "Run a shell command (allowlisted commands only). Use this for read-only inspection of the user's machine: ls, cat, git status, etc. Do not attempt destructive operations.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The full shell command to execute (e.g. 'ls -la')." },
        },
        required: ["command"],
      },
    },
    run: async (args) => {
      const command = String(args.command ?? "");
      const r = await runShell({ command, timeoutMs: TOOL_BUDGET_MS["shell"] ?? 30_000, signal: opts.signal });
      const stdout = truncate(r.stdout);
      const stderr = truncate(r.stderr);
      if (r.ok) {
        return { ok: true, text: `EXIT 0\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}` };
      }
      return { ok: false, text: `ERROR: ${r.error}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}` };
    },
  };
}
