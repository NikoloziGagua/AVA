import { spawn } from "node:child_process";
import { isAllowed } from "./shell-allowlist.js";

export type ShellResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; error: string; stdout: string; stderr: string };

export async function runShell(opts: {
  command: string;
  timeoutMs: number;
  cwd?: string;
  signal?: AbortSignal;
}): Promise<ShellResult> {
  const verdict = isAllowed(opts.command);
  if (!verdict.allowed) {
    return { ok: false, error: verdict.reason, stdout: "", stderr: "" };
  }
  return await new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "bash";
    const args = isWin ? ["/c", opts.command] : ["-c", opts.command];
    const child = spawn(shell, args, { cwd: opts.cwd, signal: opts.signal });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(e), stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, error: "timeout exceeded", stdout, stderr });
        return;
      }
      resolve({
        ok: code === 0,
        ...(code === 0
          ? { stdout, stderr, exitCode: code }
          : { error: `exit ${code}`, stdout, stderr }),
      } as ShellResult);
    });
  });
}
