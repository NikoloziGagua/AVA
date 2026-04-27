import { spawn } from "node:child_process";
import type { PidfileRegistry } from "../process/pidfile.js";
import type { AllowDecision } from "../security/path-allowlist.js";
import { scrubSecrets } from "../security/scrub.js";

export type ClaudeCodeRunArgs = { prompt: string; cwd: string; runId: string; model?: string };
export type ClaudeCodeResult =
  | { ok: true; output: string; exitCode: number }
  | { ok: false; reason: string };

export type ClaudeCode = {
  run: (args: ClaudeCodeRunArgs) => Promise<ClaudeCodeResult>;
};

export type ClaudeCodeConfig = {
  pidfiles: PidfileRegistry;
  check: (path: string) => AllowDecision;
  claudeBinary?: string;
  // Allow tests to override how arguments are built. In production, defaults to claude -p.
  claudeArgs?: (prompt: string, cwd: string, model?: string) => string[];
};

const DANGEROUS_FLAG = /--dangerously-skip-permissions/i;
const MAX_OUTPUT = 16_384;

export function buildClaudeCode(cfg: ClaudeCodeConfig): ClaudeCode {
  const claudeBinary = cfg.claudeBinary ?? "claude";
  const buildArgs =
    cfg.claudeArgs ??
    ((prompt: string, _cwd: string, model?: string) => {
      const args = ["-p", prompt];
      if (model) args.push("--model", model);
      return args;
    });

  return {
    async run({ prompt, cwd, runId, model }) {
      if (DANGEROUS_FLAG.test(prompt)) {
        return { ok: false, reason: "prompt contains --dangerously-skip-permissions (hard-blocked)" };
      }
      const cwdDecision = cfg.check(cwd);
      if (!cwdDecision.ok) return { ok: false, reason: cwdDecision.reason };

      const args = buildArgs(prompt, cwd, model);
      const child = spawn(claudeBinary, args, { cwd, windowsHide: true });
      if (typeof child.pid === "number") cfg.pidfiles.add(runId, child.pid);

      let buf = "";
      const append = (data: Buffer) => {
        if (buf.length >= MAX_OUTPUT) return;
        buf += data.toString();
        if (buf.length > MAX_OUTPUT) {
          buf =
            buf.slice(0, MAX_OUTPUT) +
            `\n... [truncated, more chars suppressed]`;
        }
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);

      return await new Promise<ClaudeCodeResult>((resolve) => {
        child.on("error", (err) => {
          if (typeof child.pid === "number") cfg.pidfiles.clear(runId);
          resolve({ ok: false, reason: String(err.message) });
        });
        child.on("close", (code) => {
          if (typeof child.pid === "number") {
            // remove just this pid; if it was the only one, clear() removes the dir
            cfg.pidfiles.clear(runId);
          }
          const output = scrubSecrets(buf.trim());
          resolve({ ok: true, output, exitCode: code ?? 0 });
        });
      });
    },
  };
}
