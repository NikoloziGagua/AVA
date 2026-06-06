import { spawn } from "node:child_process";
import type { RunFn, RunResult } from "./verify.js";
import { killTree } from "../process/kill-tree.js";

// Hard wall-clock cap per verify check. A self-improvement's `npm test` / build
// must never hang the whole self-dev pipeline (and pin its worktree) forever — e.g.
// a watch flag slipping in, a test awaiting input. 10 min is comfortably above a
// real full build+test on this repo.
const RUN_TIMEOUT_MS = 10 * 60_000;

// Production RunFn: runs a shell command line in `cwd`, resolving its exit code
// and combined output (tail-capped). `shell: true` lets command strings like
// "npm test" resolve on Windows + POSIX. Never rejects — a spawn error or a
// timeout becomes a nonzero RunResult so verify() treats it as a failed check.
export function buildRunner(timeoutMs: number = RUN_TIMEOUT_MS): RunFn {
  return (cmd: string, cwd: string): Promise<RunResult> =>
    new Promise<RunResult>((resolve) => {
      const child = spawn(cmd, { cwd, shell: true, windowsHide: true });
      let output = "";
      let settled = false;
      const done = (r: RunResult) => { if (settled) return; settled = true; clearTimeout(timer); resolve(r); };
      const cap = (d: Buffer) => { output += d.toString(); if (output.length > 16_384) output = output.slice(-16_384); };
      // Tree-kill on timeout so the npm.cmd -> node subtree dies (a bare kill
      // would orphan node), then resolve a failed check.
      const timer = setTimeout(() => {
        if (typeof child.pid === "number") void killTree(child.pid, "SIGTERM");
        else child.kill();
        done({ code: 1, output: `${output}\n[verify check timed out after ${timeoutMs}ms]` });
      }, timeoutMs);
      timer.unref?.();
      child.stdout?.on("data", cap);
      child.stderr?.on("data", cap);
      child.on("error", (err) => done({ code: 1, output: `${output}\nspawn error: ${err.message}` }));
      child.on("close", (code) => done({ code: code ?? 1, output }));
    });
}
