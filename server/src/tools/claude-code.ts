import { spawn } from "node:child_process";
import type { PidfileRegistry } from "../process/pidfile.js";
import type { AllowDecision } from "../security/path-allowlist.js";
import { scrubSecrets } from "../security/scrub.js";

export type ClaudeCodeRunArgs = {
  prompt: string; cwd: string; runId: string; model?: string;
  /** Persistent conversation. Create it (`--session-id`) on first use, then
   *  `--resume` it so Ava and Claude keep one ongoing chat across calls. */
  session?: { id: string; resume: boolean };
  /** Hard cap on the run. If set, the child is killed and the call resolves
   *  `{ ok: false, reason: "timed out after <ms>ms" }` so it can never hang. */
  timeoutMs?: number;
};
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

/**
 * Default CLI args for the worker. `-p` is non-interactive print mode, so there
 * is no human to approve tool use; `--permission-mode acceptEdits` auto-approves
 * FILE EDITS (Edit/Write) only — without it the worker can't change any code and
 * silently no-ops. This is NOT the hard-blocked `--dangerously-skip-permissions`:
 * it doesn't bypass other permissions (bash, etc.).
 */
export function defaultClaudeArgs(prompt: string, _cwd: string, model?: string): string[] {
  const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
  if (model) args.push("--model", model);
  return args;
}

/**
 * Environment for the worker process. The worker must authenticate as the user's
 * logged-in `claude` subscription — exactly like an interactive user — NOT an API
 * key. Claude Code prefers an API key found in its environment over the
 * subscription login, which silently bills a separate pay-as-you-go account
 * (and fails with "credit balance too low" when that account is empty). Strip the
 * override vars so the worker falls back to the subscription login.
 */
export function workerEnv(parentEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...parentEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/**
 * CLI flags for a persistent conversation. First use pins the UUID with
 * `--session-id`; afterwards `--resume` reopens the same chat so context carries
 * across calls (verified: a codeword seeded in one call is recalled in the next).
 */
export function sessionArgs(session?: { id: string; resume: boolean }): string[] {
  if (!session) return [];
  return [session.resume ? "--resume" : "--session-id", session.id];
}

export function buildClaudeCode(cfg: ClaudeCodeConfig): ClaudeCode {
  const claudeBinary = cfg.claudeBinary ?? "claude";
  const buildArgs = cfg.claudeArgs ?? defaultClaudeArgs;

  return {
    async run({ prompt, cwd, runId, model, session, timeoutMs }) {
      if (DANGEROUS_FLAG.test(prompt)) {
        return { ok: false, reason: "prompt contains --dangerously-skip-permissions (hard-blocked)" };
      }
      const cwdDecision = cfg.check(cwd);
      if (!cwdDecision.ok) return { ok: false, reason: cwdDecision.reason };

      const args = [...buildArgs(prompt, cwd, model), ...sessionArgs(session)];
      // env: workerEnv strips the API key so claude uses the user's subscription.
      // stdin "ignore": claude -p otherwise waits ~3s for stdin that never comes.
      const child = spawn(claudeBinary, args, {
        cwd, windowsHide: true, env: workerEnv(), stdio: ["ignore", "pipe", "pipe"],
      });
      const childPid = child.pid;
      if (typeof childPid === "number") cfg.pidfiles.add(runId, childPid);

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
        let settled = false;
        // Hard timeout: SIGTERM, then SIGKILL after 1s if it ignores the term.
        // Resolve immediately with the timeout reason so the caller never hangs;
        // the later kill-induced "close" is ignored via `settled`.
        let timer: NodeJS.Timeout | undefined;
        let killTimer: NodeJS.Timeout | undefined;
        if (typeof timeoutMs === "number") {
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill("SIGTERM"); } catch { /* already gone */ }
            killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, 1000);
            killTimer.unref?.();
            if (typeof childPid === "number") cfg.pidfiles.remove(runId, childPid);
            resolve({ ok: false, reason: `timed out after ${timeoutMs}ms` });
          }, timeoutMs);
          timer.unref?.();
        }
        const clear = () => { if (timer) clearTimeout(timer); if (killTimer) clearTimeout(killTimer); };
        child.on("error", (err) => {
          if (settled) return;
          settled = true;
          clear();
          if (typeof childPid === "number") cfg.pidfiles.remove(runId, childPid);
          resolve({ ok: false, reason: String(err.message) });
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clear();
          if (typeof childPid === "number") cfg.pidfiles.remove(runId, childPid);
          const output = scrubSecrets(buf.trim());
          resolve({ ok: true, output, exitCode: code ?? 0 });
        });
      });
    },
  };
}
