import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runShell } from "./shell.js";

const MAX_STREAM_CHARS = 4096;

function truncate(s: string): string {
  if (s.length <= MAX_STREAM_CHARS) return s;
  return (
    s.slice(0, MAX_STREAM_CHARS) +
    `\n... [truncated, ${s.length - MAX_STREAM_CHARS} more chars]`
  );
}

export type ShellEvent =
  | { kind: "shell.call"; args: { command: string } }
  | { kind: "shell.result"; ok: boolean; result: string };

export function buildShellMcp(opts: {
  emit: (e: ShellEvent) => void;
  signalForRun: () => AbortSignal | undefined;
}): Server {
  const s = new Server(
    { name: "ava-shell", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "shell",
        description:
          "Run a shell command (allowlisted commands only). Use this for read-only inspection of the user's machine: ls, cat, git status, etc. Do not attempt destructive operations.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The full shell command to execute (e.g. 'ls -la').",
            },
          },
          required: ["command"],
        },
      },
    ],
  }));

  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "shell") throw new Error(`unknown tool: ${req.params.name}`);
    const command = String(
      (req.params.arguments as { command?: string })?.command ?? ""
    );
    opts.emit({ kind: "shell.call", args: { command } });
    const r = await runShell({
      command,
      timeoutMs: 30_000,
      signal: opts.signalForRun(),
    });
    const stdout = truncate(r.stdout);
    const stderr = truncate(r.stderr);
    const summary = r.ok
      ? `EXIT 0\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
      : `ERROR: ${r.error}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
    opts.emit({ kind: "shell.result", ok: r.ok, result: summary });
    return { content: [{ type: "text", text: summary }] };
  });

  return s;
}
