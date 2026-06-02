import { spawn } from "node:child_process";
import type { RunFn, RunResult } from "./verify.js";

// Production RunFn: runs a shell command line in `cwd`, resolving its exit code
// and combined output (tail-capped). `shell: true` lets command strings like
// "npm test" resolve on Windows + POSIX. Never rejects — a spawn error becomes
// a nonzero RunResult so verify() can treat it as a failed check.
export function buildRunner(): RunFn {
  return (cmd: string, cwd: string): Promise<RunResult> =>
    new Promise<RunResult>((resolve) => {
      const child = spawn(cmd, { cwd, shell: true, windowsHide: true });
      let output = "";
      const cap = (d: Buffer) => { output += d.toString(); if (output.length > 16_384) output = output.slice(-16_384); };
      child.stdout?.on("data", cap);
      child.stderr?.on("data", cap);
      child.on("error", (err) => resolve({ code: 1, output: `${output}\nspawn error: ${err.message}` }));
      child.on("close", (code) => resolve({ code: code ?? 1, output }));
    });
}
