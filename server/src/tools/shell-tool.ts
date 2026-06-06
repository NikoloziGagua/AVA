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
        "Run commands and launch apps on Sir's Windows PC (cmd.exe). You can launch apps " +
        "(e.g. `start whatsapp:`, `start spotify:`, `start \"\" \"C:\\path\\App.exe\"`), open " +
        "files/folders (`start <file>`, `explorer <dir>`), and run system commands (dir, git, " +
        "npm, etc.); chaining and piping work. Destructive operations (deleting/formatting/" +
        "registry/shutdown) require Sir's approval; .env/secrets are blocked.",
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
