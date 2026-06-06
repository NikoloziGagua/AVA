import { spawn } from "node:child_process";
import { isAllowed } from "./shell-allowlist.js";
import { killTree } from "../process/kill-tree.js";

export type ShellResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; error: string; stdout: string; stderr: string };

export async function runShell(opts: {
  command: string;
  timeoutMs: number;
  cwd?: string;
  signal?: AbortSignal;
  /** Called with the child's PID right after spawn so the caller can register it
   *  with the run's pidfile registry — that is what lets the Stop button's
   *  killTree() loop reach a shell child (and its descendants). */
  onSpawn?: (pid: number) => void;
  /** Called with the PID when the child settles, to unregister it. */
  onExit?: (pid: number) => void;
}): Promise<ShellResult> {
  const verdict = isAllowed(opts.command);
  if (!verdict.allowed) {
    return { ok: false, error: verdict.reason, stdout: "", stderr: "" };
  }
  return await new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "bash";
    const args = isWin ? ["/c", opts.command] : ["-c", opts.command];
    // No { signal } here: Node's spawn-abort only kills the DIRECT child
    // (cmd.exe/bash), orphaning any grandchildren it launched. We handle both
    // abort and timeout below with a TREE kill (taskkill /T on Windows) so the
    // whole subtree dies — this is what makes the Stop button actually stop work.
    const child = spawn(shell, args, { cwd: opts.cwd });
    const pid = child.pid;
    if (typeof pid === "number") opts.onSpawn?.(pid);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;

    const treeKill = () => {
      if (typeof pid === "number") void killTree(pid, "SIGTERM");
      else child.kill();
    };

    const timer = setTimeout(() => { timedOut = true; treeKill(); }, opts.timeoutMs);
    const onAbort = () => { aborted = true; treeKill(); };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (typeof pid === "number") opts.onExit?.(pid);
    };

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (e) => {
      cleanup();
      resolve({ ok: false, error: String(e), stdout, stderr });
    });
    child.on("close", (code) => {
      cleanup();
      if (timedOut) {
        resolve({ ok: false, error: "timeout exceeded", stdout, stderr });
        return;
      }
      if (aborted) {
        resolve({ ok: false, error: "aborted", stdout, stderr });
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
