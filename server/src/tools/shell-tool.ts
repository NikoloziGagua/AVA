import type { ToolDef } from "./ava-mcp.js";
import { runShell } from "./shell.js";
import { scrubSecrets } from "../security/scrub.js";
import type { PidfileRegistry } from "../process/pidfile.js";

// Raised 4096 → 8192 (matches fs_read): the old cap chopped build/test logs in
// half, blinding the model to the failures it needed to read.
const MAX_STREAM_CHARS = 8192;
// The tool enforces its own timeout (tree-kill at expiry). Default 30s; the
// model may request up to 2 minutes for installs/builds via `timeoutMs`. The
// orchestrator budget (timeout.ts) sits above the max as a backstop.
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

function truncate(s: string): string {
  if (s.length <= MAX_STREAM_CHARS) return s;
  return s.slice(0, MAX_STREAM_CHARS) + `\n... [truncated, ${s.length - MAX_STREAM_CHARS} more chars]`;
}

export function buildShellTool(opts: { signal: AbortSignal; pidfiles?: PidfileRegistry }): ToolDef {
  return {
    tool: {
      name: "shell",
      description:
        "Run commands and launch apps on Sir's Windows PC. The shell is Windows PowerShell " +
        "5.1, so: chain steps with ';' (NOT '&&'/'||' — 5.1 doesn't support them), prefer " +
        "single-quoted strings, and read env vars as $env:VAR. Launch apps with Start-Process " +
        "(e.g. `Start-Process whatsapp:`, `Start-Process spotify:`, `Start-Process " +
        "'C:\\path\\App.exe'`), open files/folders (`Invoke-Item <file>`, `explorer <dir>`), and " +
        "run system commands (dir/ls, git, npm, node, python, …); piping works. Destructive " +
        "operations (deleting/formatting/registry/shutdown) require Sir's approval; .env/secrets " +
        "are blocked.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The full shell command to execute (e.g. 'ls -la')." },
          cwd: { type: "string", description: "Working directory for the command (optional; defaults to the server's cwd). Use this instead of Set-Location chains." },
          timeoutMs: { type: "number", description: "Per-command timeout in ms (default 30000, max 120000). Raise it for installs/builds/downloads." },
        },
        required: ["command"],
      },
    },
    run: async (args, ctx) => {
      const command = String(args.command ?? "");
      const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : undefined;
      const requested = Number(args.timeoutMs);
      const timeoutMs = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.max(requested, 1_000), MAX_TIMEOUT_MS)
        : DEFAULT_TIMEOUT_MS;
      const runId = ctx?.runId;
      const reg = opts.pidfiles;
      const r = await runShell({
        command,
        cwd,
        timeoutMs,
        signal: opts.signal,
        // Register/unregister the child PID so the Stop button's killTree() loop
        // tree-kills this shell (and its descendants), not just claude_code.
        onSpawn: reg && runId ? (pid) => reg.add(runId, pid) : undefined,
        onExit: reg && runId ? (pid) => reg.remove(runId, pid) : undefined,
      });
      // Scrub secrets BEFORE truncating so a token can't be split mid-pattern,
      // then truncate the redacted text. The model never sees raw credentials.
      const stdout = truncate(scrubSecrets(r.stdout));
      const stderr = truncate(scrubSecrets(r.stderr));
      if (r.ok) {
        return { ok: true, text: `EXIT 0\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}` };
      }
      return { ok: false, text: `ERROR: ${r.error}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}` };
    },
  };
}
