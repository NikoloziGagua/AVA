import { describe, expect, it, vi } from "vitest";
import {
  buildClaudeSelfWorker,
  buildCodexSelfWorker,
  buildSelfWorkerExecutionPrompt,
  buildSelfWorkerRegistry,
  codexSelfWorkerArgs,
  formatCodexFailureEvidence,
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

  it("turns an approved proposal into an implementation-phase prompt without reopening its gate", () => {
    const result = buildSelfWorkerExecutionPrompt({
      intentId: "intent-1",
      approvedGoal: "build receipts",
      approvedPlan: "Before any code edit, submit this proposal and pause for Sir's approval. Then implement receipts.",
      authorization: "explicit_user_approval",
    });
    expect(result.scopeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.prompt).toContain("IMPLEMENTATION PHASE");
    expect(result.prompt).toContain("explicitly approved this proposal");
    expect(result.prompt).toContain("already satisfied for this run");
    expect(result.prompt).toContain("APPROVED GOAL (immutable scope)");
    expect(result.prompt).toContain("implement receipts");
    expect(result.prompt).toContain("you may do so inside this worktree");
    expect(result.prompt.length).toBeLessThan(32_000);
  });

  it("sanitizes the immutable scope before hashing or sending it to a worker", () => {
    const first = buildSelfWorkerExecutionPrompt({
      intentId: "intent-secret",
      approvedGoal: "use authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      approvedPlan: "implement safely",
      authorization: "owner_configured_unattended_policy",
    });
    const second = buildSelfWorkerExecutionPrompt({
      intentId: "intent-secret",
      approvedGoal: "use authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      approvedPlan: "implement safely",
      authorization: "owner_configured_unattended_policy",
    });
    expect(first.prompt).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(first.prompt).toContain("***");
    expect(first.scopeSha256).toBe(second.scopeSha256);
  });

  it("keeps the real Codex failure tail and final output instead of a leading banner", () => {
    const stderr = `OpenAI Codex banner\n${"echoed approved prompt ".repeat(300)}\nERROR: repository write was denied`;
    const output = formatCodexFailureEvidence(stderr, "I stopped because the worktree was unavailable.", 1);
    expect(output).toContain("Codex exited with code 1");
    expect(output).toContain("I stopped because the worktree was unavailable");
    expect(output).toContain("ERROR: repository write was denied");
    expect(output).not.toContain("OpenAI Codex banner");
    expect(output.length).toBeLessThanOrEqual(4_000);
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

  it("honors a configured timeout longer than the former fifteen-minute ceiling", async () => {
    const claude = { run: vi.fn(async (input: { timeoutMs?: number }) => ({
      ok: false as const,
      reason: `timed out after ${input.timeoutMs}ms`,
    })) };
    const worker = buildClaudeSelfWorker({
      binary: process.execPath,
      claude,
      timeoutMs: 45 * 60_000,
    });
    await worker.run({ brief: "x", cwd: ".", runId: "r" });
    expect(claude.run).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 45 * 60_000,
    }));
  });

  it("allows a per-run timeout override while retaining a two-hour safety cap", async () => {
    const claude = { run: vi.fn(async () => ({ ok: false as const, reason: "fixture" })) };
    const worker = buildClaudeSelfWorker({ claude, binary: process.execPath });
    await worker.run({ brief: "x", cwd: ".", runId: "r", timeoutMs: 3 * 60 * 60_000 });
    expect(claude.run).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 120 * 60_000,
    }));
  });
});
