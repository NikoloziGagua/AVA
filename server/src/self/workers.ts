import { spawn, type ChildProcess } from "node:child_process";
import { scrubSecrets } from "../security/scrub.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { killTree } from "../process/kill-tree.js";
import type { ClaudeCode } from "../tools/claude-code.js";
import type { SelfWorkerProvider } from "./worker-selection.js";

const MAX_SUMMARY = 16_384;
const MAX_ERROR = 4_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export type SelfWorkerAvailability = {
  provider: SelfWorkerProvider;
  label: string;
  installed: boolean;
  /** A version probe never proves account authentication, so this is explicit. */
  configuration: "not_checked" | "unavailable";
  available: boolean;
  version: string | null;
  reason: string | null;
};

export type SelfWorkerRunInput = {
  brief: string;
  cwd: string;
  runId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SelfWorkerRunResult =
  | { ok: true; output: string }
  | { ok: false; output: string; code: "unavailable" | "aborted" | "timeout" | "launch_failed" | "worker_failed" };

export type SelfWorkerAdapter = {
  provider: SelfWorkerProvider;
  label: string;
  probe(): Promise<SelfWorkerAvailability>;
  run(input: SelfWorkerRunInput): Promise<SelfWorkerRunResult>;
};

export type SelfWorkerRegistry = {
  availability(provider: SelfWorkerProvider): Promise<SelfWorkerAvailability>;
  listAvailability(): Promise<SelfWorkerAvailability[]>;
  run(provider: SelfWorkerProvider, input: SelfWorkerRunInput): Promise<SelfWorkerRunResult>;
};

export function sanitizeWorkerEvidence(value: string, max = MAX_SUMMARY): string {
  return scrubSecrets(value).replace(/\u0000/g, "").slice(0, max);
}

export function buildSelfWorkerRegistry(adapters: SelfWorkerAdapter[]): SelfWorkerRegistry {
  const byProvider = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  const get = (provider: SelfWorkerProvider) => {
    const adapter = byProvider.get(provider);
    if (!adapter) throw new Error(`self worker adapter not registered: ${provider}`);
    return adapter;
  };
  return {
    availability: (provider) => get(provider).probe(),
    listAvailability: () => Promise.all(adapters.map((adapter) => adapter.probe())),
    async run(provider, input) {
      const adapter = get(provider);
      const state = await adapter.probe();
      if (!state.available) {
        return { ok: false, code: "unavailable", output: state.reason ?? `${state.label} is unavailable` };
      }
      return adapter.run({ ...input, brief: sanitizeWorkerEvidence(input.brief, 32_000) });
    },
  };
}

type ProbeResult = { installed: boolean; version: string | null; reason: string | null };

export function probeCli(binary: string, env: NodeJS.ProcessEnv, timeoutMs = 5_000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let child: ChildProcess;
    const finish = (value: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      if (typeof child?.pid === "number") void killTree(child.pid, "SIGTERM");
      finish({ installed: false, version: null, reason: "availability check timed out" });
    }, timeoutMs);
    timer.unref?.();
    try {
      child = spawn(binary, ["--version"], { windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish({ installed: false, version: null, reason: sanitizeWorkerEvidence(error instanceof Error ? error.message : String(error), 500) });
      return;
    }
    child.stdout?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(0, 500); });
    child.on("error", (error) => finish({ installed: false, version: null, reason: sanitizeWorkerEvidence(error.message, 500) }));
    child.on("close", (code) => finish(code === 0
      ? { installed: true, version: output.trim() || null, reason: null }
      : { installed: false, version: null, reason: `version check exited ${code ?? "unknown"}` }));
  });
}

function availability(
  provider: SelfWorkerProvider,
  label: string,
  result: ProbeResult,
): SelfWorkerAvailability {
  return {
    provider,
    label,
    installed: result.installed,
    configuration: result.installed ? "not_checked" : "unavailable",
    available: result.installed,
    version: result.version,
    reason: result.installed
      ? "CLI responds; sign-in is checked only when an approved run starts"
      : result.reason ?? `${label} CLI is not installed`,
  };
}

function cachedAvailability(load: () => Promise<SelfWorkerAvailability>): () => Promise<SelfWorkerAvailability> {
  let cache: { at: number; value: SelfWorkerAvailability } | null = null;
  let pending: Promise<SelfWorkerAvailability> | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < 30_000) return cache.value;
    if (pending) return pending;
    pending = load().then((value) => {
      cache = { at: Date.now(), value };
      return value;
    }).finally(() => { pending = null; });
    return pending;
  };
}

function claudeWorkerEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...parent };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

function codexWorkerEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...parent };
  // Use the owner's saved ChatGPT/Codex login, not repository-scoped API keys.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

export function buildClaudeSelfWorker(config: {
  claude: ClaudeCode;
  binary?: string;
}): SelfWorkerAdapter {
  const binary = config.binary ?? process.env.CLAUDE_BINARY ?? "claude";
  const probe = cachedAvailability(async () => availability("claude", "Claude Code", await probeCli(binary, claudeWorkerEnv())));
  return {
    provider: "claude",
    label: "Claude Code",
    probe,
    async run(input) {
      if (input.signal?.aborted) return { ok: false, code: "aborted", output: "aborted" };
      const result = await config.claude.run({
        prompt: input.brief,
        cwd: input.cwd,
        runId: input.runId,
        signal: input.signal,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      if (!result.ok) {
        const reason = sanitizeWorkerEvidence(result.reason, MAX_ERROR);
        return { ok: false, code: reason === "aborted" ? "aborted" : "worker_failed", output: reason };
      }
      if (result.exitCode !== 0) {
        return { ok: false, code: "worker_failed", output: sanitizeWorkerEvidence(result.output || `Claude Code exited ${result.exitCode}`, MAX_ERROR) };
      }
      return { ok: true, output: sanitizeWorkerEvidence(result.output) };
    },
  };
}

export function codexSelfWorkerArgs(): string[] {
  // The brief is supplied on stdin (`-`) and never placed in the process list.
  // workspace-write is sufficient because the cwd is an isolated git worktree.
  return ["-a", "never", "-s", "workspace-write", "exec", "--ephemeral", "--color", "never", "-"];
}

export function buildCodexSelfWorker(config: {
  pidfiles: PidfileRegistry;
  binary?: string;
}): SelfWorkerAdapter {
  const binary = config.binary ?? process.env.CODEX_BINARY ?? "codex";
  const env = codexWorkerEnv();
  const probe = cachedAvailability(async () => availability("codex", "Codex", await probeCli(binary, env)));
  return {
    provider: "codex",
    label: "Codex",
    probe,
    async run(input) {
      if (input.signal?.aborted) return { ok: false, code: "aborted", output: "aborted" };
      let child: ChildProcess;
      try {
        child = spawn(binary, codexSelfWorkerArgs(), {
          cwd: input.cwd,
          windowsHide: true,
          env,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        return { ok: false, code: "launch_failed", output: sanitizeWorkerEvidence(error instanceof Error ? error.message : String(error), MAX_ERROR) };
      }
      const pid = child.pid;
      if (typeof pid === "number") config.pidfiles.add(input.runId, pid);
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(0, MAX_SUMMARY); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(0, MAX_ERROR); });

      return await new Promise<SelfWorkerRunResult>((resolve) => {
        let settled = false;
        let killTimer: NodeJS.Timeout | null = null;
        const timeoutMs = Math.max(5_000, Math.min(DEFAULT_TIMEOUT_MS, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));
        const finish = (result: SelfWorkerRunResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          input.signal?.removeEventListener("abort", onAbort);
          if (typeof pid === "number") config.pidfiles.remove(input.runId, pid);
          resolve(result);
        };
        const stop = () => {
          if (typeof pid !== "number") return;
          void killTree(pid, "SIGTERM");
          killTimer = setTimeout(() => { void killTree(pid, "SIGKILL"); }, 1_000);
          killTimer.unref?.();
        };
        const onAbort = () => { stop(); finish({ ok: false, code: "aborted", output: "aborted" }); };
        input.signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(() => {
          stop();
          finish({ ok: false, code: "timeout", output: `Codex timed out after ${Math.round(timeoutMs / 1000)}s` });
        }, timeoutMs);
        timer.unref?.();
        child.on("error", (error) => finish({ ok: false, code: "launch_failed", output: sanitizeWorkerEvidence(error.message, MAX_ERROR) }));
        child.on("close", (code) => {
          if (code !== 0) {
            finish({ ok: false, code: "worker_failed", output: sanitizeWorkerEvidence(stderr.trim() || stdout.trim() || `Codex exited ${code ?? "unknown"}`, MAX_ERROR) });
            return;
          }
          finish({ ok: true, output: sanitizeWorkerEvidence(stdout.trim()) });
        });
        try { child.stdin?.end(input.brief); }
        catch (error) { finish({ ok: false, code: "launch_failed", output: sanitizeWorkerEvidence(error instanceof Error ? error.message : String(error), MAX_ERROR) }); }
      }).finally(() => { try { child.stdin?.destroy(); } catch { /* closed */ } });
    },
  };
}
