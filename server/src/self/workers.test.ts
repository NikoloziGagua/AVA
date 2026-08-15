import { describe, expect, it, vi } from "vitest";
import {
  buildClaudeSelfWorker,
  buildCodexSelfWorker,
  buildSelfWorkerRegistry,
  codexSelfWorkerArgs,
  sanitizeWorkerEvidence,
  type SelfWorkerAdapter,
} from "./workers.js";

const adapter = (provider: "claude" | "codex", available = true): SelfWorkerAdapter => ({
  provider,
  label: provider === "claude" ? "Claude Code" : "Codex",
  probe: async () => ({
    provider, label: provider, installed: available,
    configuration: available ? "not_checked" : "unavailable",
    available, version: available ? "1.0" : null, reason: available ? null : "missing CLI",
  }),
  run: vi.fn(async (input) => ({ ok: true as const, output: `${provider}:${input.brief}` })),
});

describe("provider-neutral self worker registry", () => {
  it.each(["claude", "codex"] as const)("routes %s through its explicit adapter", async (provider) => {
    const claude = adapter("claude");
    const codex = adapter("codex");
    const registry = buildSelfWorkerRegistry([claude, codex]);
    const result = await registry.run(provider, { brief: "make the change", cwd: "W", runId: "r" });
    expect(result).toMatchObject({ ok: true, output: `${provider}:make the change` });
    expect(claude.run).toHaveBeenCalledTimes(provider === "claude" ? 1 : 0);
    expect(codex.run).toHaveBeenCalledTimes(provider === "codex" ? 1 : 0);
  });

  it("fails closed without silently falling back", async () => {
    const claude = adapter("claude");
    const codex = adapter("codex", false);
    const result = await buildSelfWorkerRegistry([claude, codex]).run("codex", {
      brief: "x", cwd: "W", runId: "r",
    });
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect(claude.run).not.toHaveBeenCalled();
    expect(codex.run).not.toHaveBeenCalled();
  });

  it("passes cancellation to the selected adapter", async () => {
    const ac = new AbortController();
    const codex = adapter("codex");
    codex.run = vi.fn(async (input) => {
      expect(input.signal).toBe(ac.signal);
      return { ok: false as const, code: "aborted" as const, output: "aborted" };
    });
    const registry = buildSelfWorkerRegistry([adapter("claude"), codex]);
    ac.abort();
    expect(await registry.run("codex", { brief: "x", cwd: "W", runId: "r", signal: ac.signal }))
      .toMatchObject({ ok: false, code: "aborted" });
  });

  it("keeps the brief off the Codex process arguments and uses the bounded sandbox", () => {
    const args = codexSelfWorkerArgs();
    expect(args).toContain("workspace-write");
    expect(args).toContain("never");
    expect(args.at(-1)).toBe("-");
    expect(args.join(" ")).not.toContain("make secret change");
  });

  it("redacts secrets from persisted worker evidence", () => {
    const redacted = sanitizeWorkerEvidence("authorization: Bearer abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redacted).toContain("***");
  });

  it("normalizes a non-zero Claude Code exit as a worker failure", async () => {
    const worker = buildClaudeSelfWorker({
      binary: process.execPath,
      claude: { run: async () => ({ ok: true, exitCode: 7, output: "authorization: Bearer very-secret-token-value" }) },
    });
    const result = await worker.run({ brief: "x", cwd: ".", runId: "r" });
    expect(result).toMatchObject({ ok: false, code: "worker_failed" });
    expect(result.output).not.toContain("very-secret-token-value");
  });

  it("normalizes Codex process failure without treating it as successful implementation", async () => {
    const pidfiles = { add: vi.fn(), remove: vi.fn() } as any;
    // Node answers --version successfully, then rejects Codex-specific args with
    // a non-zero exit. This is a deterministic no-credentials process fixture.
    const worker = buildCodexSelfWorker({ pidfiles, binary: process.execPath });
    expect((await worker.probe()).available).toBe(true);
    const result = await worker.run({ brief: "x", cwd: process.cwd(), runId: "r", timeoutMs: 10_000 });
    expect(result).toMatchObject({ ok: false, code: "worker_failed" });
  });
});
