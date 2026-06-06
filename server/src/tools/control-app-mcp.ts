// server/src/tools/control-app-mcp.ts
//
// Local native-app control for Ava on Sir's Windows PC — UI Automation +
// keystrokes/hotkeys, driven by PowerShell, with NO Anthropic API cost (unlike
// computer_use, which needs credits and is the fallback).
//
// HARD-WON LESSON (do not regress): a real session failed two ways when the
// PowerShell was routed through `cmd.exe /c` — inline `$wshell` got its `$` var
// stripped, and a saved `.ps1` failed "Illegal characters in path" from the
// cmd quoting. The fix, enforced here, is to (1) WRITE the script to a `.ps1`
// file and (2) spawn `powershell.exe` DIRECTLY as an argv array (never through
// cmd, never inlining a `$`-containing string). That argv form avoids both the
// variable-stripping and the path-quoting failures.
//
// Risk classification lives in policy/classify.ts: a benign control_app script
// is "low" (auto-allow, no approval stall — Sir wants frictionless local
// control); a destructive script is "high"; `.env` is hard-blocked.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolDef } from "./ava-mcp.js";
import { TOOL_BUDGET_MS } from "../orchestrator/timeout.js";
import { isAllowed } from "./shell-allowlist.js";
import { scrubSecrets } from "../security/scrub.js";

const MAX_OUT_CHARS = 6000;

function truncate(s: string): string {
  if (s.length <= MAX_OUT_CHARS) return s;
  return s.slice(0, MAX_OUT_CHARS) + `\n... [truncated, ${s.length - MAX_OUT_CHARS} more chars]`;
}

// Monotonic-ish counter so two scripts in the same run never collide on a file
// name (runId is shared across a run's tool calls).
let seq = 0;

/** Build the absolute `.ps1` path for a script, under Sir's home profile
 *  (inside the writable fsRoots `C:/Users/nikug/**`). Exported pure so the
 *  path-building can be unit-tested without spawning PowerShell. os.tmpdir is
 *  deliberately NOT used — it is outside fsRoots. */
export function controlScriptPath(runId: string): string {
  const dir = path.join(os.homedir(), "AppData", "Local", "Ava", "scripts");
  return path.join(dir, `ctl-${runId}-${seq++}-${process.hrtime.bigint()}.ps1`);
}

type RunResult = { ok: boolean; stdout: string; stderr: string; error?: string };

function runPowerShellFile(file: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    // Spawn powershell.exe DIRECTLY as argv (never via cmd /c). This is what
    // avoids the `$`-stripping and "Illegal characters in path" failures.
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file],
      { windowsHide: true, signal },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr, error: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, stdout, stderr, error: "timeout exceeded" });
        return;
      }
      resolve({ ok: code === 0, stdout, stderr, ...(code === 0 ? {} : { error: `exit ${code}` }) });
    });
  });
}

export function buildControlAppTool(deps: { signal?: AbortSignal }): ToolDef {
  return {
    tool: {
      name: "control_app",
      description:
        "Control native Windows apps locally with PowerShell — UI Automation " +
        "(find/click/set UI elements) and keystrokes/hotkeys (SendKeys). Use this " +
        "to do things INSIDE an app (e.g. focus WhatsApp's search box and type a " +
        "name, click a button). Runs locally with no API cost. Provide a PowerShell " +
        "`script`. Prefer this over computer_use for native apps.",
      inputSchema: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description:
              "PowerShell script: UI Automation (Add-Type -AssemblyName " +
              "UIAutomationClient,UIAutomationTypes; [System.Windows.Automation.AutomationElement]) " +
              "and/or keystrokes (Add-Type -AssemblyName System.Windows.Forms; " +
              "[System.Windows.Forms.SendKeys]::SendWait('...'); or WScript.Shell " +
              "AppActivate to focus a window).",
          },
        },
        required: ["script"],
      },
    },
    run: async (args, ctx) => {
      const script = String(args.script ?? "");
      if (!script) return { ok: false, text: "missing script" };

      // Gate the arbitrary PowerShell through the same destructive/secret safety
      // net as the shell tool. A blocked script (force-delete, .env/secret-file
      // read, exfil, etc.) is refused WITHOUT running — control_app must not be a
      // bypass around the shell gate.
      const verdict = isAllowed(script);
      if (!verdict.allowed) {
        return { ok: false, text: `blocked: ${verdict.reason}` };
      }

      // Write the script to a `.ps1` under Sir's home profile (writable fsRoot),
      // then spawn powershell.exe -File against it. The file is kept (not
      // deleted) — handy for debugging a failed control sequence.
      const file = controlScriptPath(ctx.runId);
      mkdirSync(path.dirname(file), { recursive: true });
      // Windows PowerShell 5.1 reads `-File` as the system ANSI codepage unless a
      // UTF-8 BOM marks it, and emits stdout in the console codepage — both corrupt
      // non-ASCII (names, search terms). Write the file BOM-first so it's read as
      // UTF-8, and prepend a line forcing UTF-8 stdout so output round-trips too.
      const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
      const utf8Out = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\r\n";
      writeFileSync(file, Buffer.concat([BOM, Buffer.from(utf8Out + script, "utf8")]));

      const timeoutMs = TOOL_BUDGET_MS["control_app"] ?? 30_000;
      const r = await runPowerShellFile(file, timeoutMs, deps.signal ?? ctx.signal);

      // Scrub secrets BEFORE truncating so the model never sees raw credentials
      // a UI-Automation/PowerShell read might surface.
      const out = truncate(scrubSecrets(r.stdout));
      const err = truncate(scrubSecrets(r.stderr));
      if (r.ok) {
        return { ok: true, text: out || "done" };
      }
      // On failure surface stderr (then stdout) so the model can see what broke.
      const detail = err || out || (r.error ? scrubSecrets(r.error) : "") || "control_app failed";
      return { ok: false, text: detail };
    },
  };
}
