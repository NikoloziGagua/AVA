import { spawn } from "node:child_process";
import { scrubSecrets } from "../security/scrub.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { killTree } from "../process/kill-tree.js";

export type CodexUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type CodexConsultResult =
  | { ok: true; text: string; threadId: string; usage: CodexUsage | null }
  | { ok: false; error: string; threadId: string | null };

export type CodexConsultInput = {
  prompt: string;
  cwd: string;
  runId: string;
  threadId?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CodexConsultant = {
  consult(input: CodexConsultInput): Promise<CodexConsultResult>;
  probe(): Promise<{ available: boolean; version: string | null; error: string | null }>;
};

type ParseState = {
  threadId: string | null;
  finalText: string;
  usage: CodexUsage | null;
  error: string | null;
};

/** Read-only, non-interactive Codex invocation. The prompt is sent over stdin
 * so long room transcripts never hit Windows' command-line length limit. */
export function codexConsultArgs(threadId?: string | null): string[] {
  if (threadId) {
    return ["-a", "never", "-s", "read-only", "exec", "resume", "--json", threadId, "-"];
  }
  return ["-a", "never", "-s", "read-only", "exec", "--json", "--cd", ".", "-"];
}

export function consumeCodexJsonLine(line: string, state: ParseState): void {
  if (!line.trim()) return;
  let event: Record<string, any>;
  try { event = JSON.parse(line) as Record<string, any>; } catch { return; }
  if (event.type === "thread.started" && typeof event.thread_id === "string") {
    state.threadId = event.thread_id;
    return;
  }
  if (
    event.type === "item.completed" &&
    event.item?.type === "agent_message" &&
    typeof event.item.text === "string"
  ) {
    // Keep only public agent messages. Reasoning items are deliberately ignored.
    state.finalText = scrubSecrets(event.item.text).slice(0, 32_000);
    return;
  }
  if (event.type === "turn.completed" && event.usage) {
    state.usage = {
      inputTokens: Number(event.usage.input_tokens ?? 0),
      cachedInputTokens: Number(event.usage.cached_input_tokens ?? 0),
      outputTokens: Number(event.usage.output_tokens ?? 0),
    };
    return;
  }
  if (event.type === "turn.failed" || event.type === "error") {
    state.error = scrubSecrets(String(event.message ?? event.error?.message ?? "Codex turn failed")).slice(0, 4_000);
  }
}

function codexWorkerEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...parent };
  // Strategy Room uses the owner's existing Codex/ChatGPT login. Never leak or
  // silently switch to a repository API key inherited from AVA's `.env`.
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

export function buildCodexConsultant(config: {
  pidfiles: PidfileRegistry;
  binary?: string;
}): CodexConsultant {
  const binary = config.binary ?? process.env.CODEX_BINARY ?? "codex";
  let cachedProbe: { at: number; value: { available: boolean; version: string | null; error: string | null } } | null = null;

  return {
    async probe() {
      if (cachedProbe && Date.now() - cachedProbe.at < 30_000) return cachedProbe.value;
      const value = await new Promise<{ available: boolean; version: string | null; error: string | null }>((resolve) => {
        const child = spawn(binary, ["--version"], {
          windowsHide: true,
          env: codexWorkerEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        const timer = setTimeout(() => {
          if (typeof child.pid === "number") void killTree(child.pid, "SIGTERM");
          resolve({ available: false, version: null, error: "Codex availability check timed out" });
        }, 5_000);
        timer.unref?.();
        child.stdout?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(0, 500); });
        child.on("error", (error) => {
          clearTimeout(timer);
          resolve({ available: false, version: null, error: scrubSecrets(error.message) });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve(code === 0
            ? { available: true, version: output.trim() || null, error: null }
            : { available: false, version: null, error: `Codex exited ${code ?? "unknown"}` });
        });
      });
      cachedProbe = { at: Date.now(), value };
      return value;
    },

    async consult(input) {
      if (input.signal?.aborted) return { ok: false, error: "aborted", threadId: input.threadId ?? null };
      const args = codexConsultArgs(input.threadId);
      // The first invocation's --cd argument is intentionally `.` while cwd is
      // set on spawn. This avoids duplicating a potentially sensitive path in
      // process command-line inspection while preserving the correct repo root.
      const child = spawn(binary, args, {
        cwd: input.cwd,
        windowsHide: true,
        env: codexWorkerEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pid = child.pid;
      if (typeof pid === "number") config.pidfiles.add(input.runId, pid);

      const state: ParseState = {
        threadId: input.threadId ?? null,
        finalText: "",
        usage: null,
        error: null,
      };
      let pending = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          consumeCodexJsonLine(pending.slice(0, newline).replace(/\r$/, ""), state);
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
        // A valid JSONL event is bounded. Refuse unbounded output without a
        // delimiter while still keeping enough tail to diagnose a bad worker.
        if (pending.length > 256_000) pending = pending.slice(-16_000);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < 8_000) stderr = (stderr + chunk.toString()).slice(0, 8_000);
      });

      return await new Promise<CodexConsultResult>((resolve) => {
        let settled = false;
        let killTimer: NodeJS.Timeout | null = null;
        let timer: NodeJS.Timeout | null = null;
        const finish = (result: CodexConsultResult) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          input.signal?.removeEventListener("abort", onAbort);
          if (typeof pid === "number") config.pidfiles.remove(input.runId, pid);
          resolve(result);
        };
        const stopTree = () => {
          if (typeof pid === "number") {
            void killTree(pid, "SIGTERM");
            killTimer = setTimeout(() => { void killTree(pid, "SIGKILL"); }, 1_000);
            killTimer.unref?.();
          }
        };
        const onAbort = () => {
          stopTree();
          finish({ ok: false, error: "aborted", threadId: state.threadId });
        };
        input.signal?.addEventListener("abort", onAbort, { once: true });
        const timeoutMs = Math.max(5_000, Math.min(5 * 60_000, input.timeoutMs ?? 3 * 60_000));
        timer = setTimeout(() => {
          stopTree();
          finish({ ok: false, error: `Codex timed out after ${Math.round(timeoutMs / 1000)}s`, threadId: state.threadId });
        }, timeoutMs);
        timer.unref?.();

        child.on("error", (error) => {
          finish({ ok: false, error: scrubSecrets(error.message), threadId: state.threadId });
        });
        child.on("close", (code) => {
          if (pending.trim()) consumeCodexJsonLine(pending.replace(/\r$/, ""), state);
          if (code !== 0 || state.error || !state.threadId || !state.finalText) {
            const detail = state.error || scrubSecrets(stderr.trim()) || `Codex exited ${code ?? "unknown"}`;
            finish({ ok: false, error: detail.slice(0, 4_000), threadId: state.threadId });
            return;
          }
          finish({ ok: true, text: state.finalText, threadId: state.threadId, usage: state.usage });
        });
        try {
          child.stdin?.end(input.prompt);
        } catch (error) {
          finish({
            ok: false,
            error: scrubSecrets(error instanceof Error ? error.message : String(error)),
            threadId: state.threadId,
          });
        }
      }).finally(() => {
        try { child.stdin?.destroy(); } catch { /* already closed */ }
      });
    },
  };
}
