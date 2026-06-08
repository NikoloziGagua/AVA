import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent } from "./intents.js";
import { runImprovement, cancelImprovement, cancelAllImprovements, approveImprovement, rejectImprovement } from "./improver.js";

function db() { return openDb(join(mkdtempSync(join(tmpdir(), "ava-imp-")), "x.db")); }
const deps = (over: Partial<any> = {}) => ({
  reflect: async () => "CHANGE: x", addWorktree: () => ({ path: "W", branch: "self/i" }),
  removeWorktree: () => {}, implement: async () => ({ ok: true, output: "" }),
  verify: async () => ({ ok: true, log: "ok" }),
  headSha: () => "good", commitWorktree: () => "cand", swapTo: () => {}, revertTo: () => {},
  restart: async () => {}, watch: async () => {}, emit: () => {}, ...over,
});

describe("runImprovement", () => {
  it("happy path: verified change is swapped and marked swapped", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    await runImprovement(d, id, deps());
    expect(getIntent(d, id)!.status).toBe("swapped");
    expect(getIntent(d, id)!.last_known_good).toBe("good");
  });

  it("verify failure: discards worktree, never swaps, marks failed", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    let swapped = false;
    await runImprovement(d, id, deps({ verify: async () => ({ ok: false, log: "tests failed" }), swapTo: () => { swapped = true; } }));
    expect(swapped).toBe(false);
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(getIntent(d, id)!.error).toContain("tests failed");
  });

  it("records the brief and worker output for diagnosis", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    await runImprovement(d, id, deps({
      reflect: async () => "CHANGE: add a log line",
      implement: async () => ({ ok: true, output: "edited index.ts" }),
    }));
    const ds = getIntent(d, id)!.diff_summary ?? "";
    expect(ds).toContain("add a log line");
    expect(ds).toContain("edited index.ts");
  });

  it("a safety-guard throw in swapTo fails the intent (no live swap)", async () => {
    // Simulates assertSwapSafe refusing a candidate that touches guardrail code:
    // swapTo throws → the intent is marked failed instead of clobbering.
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "weaken classify.ts" });
    let watched = false;
    await runImprovement(d, id, deps({
      swapTo: () => { throw new Error("guard: refusing to swap — change touches safety-critical code:\nserver/src/policy/classify.ts"); },
      watch: async () => { watched = true; },
    }));
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(getIntent(d, id)!.error).toMatch(/safety-critical/);
    expect(watched).toBe(false); // never reached the watchdog/restart
  });

  it("passes last_known_good through to swapTo for the guard diff", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    let seen: { sha: string; lkg: string } | null = null;
    await runImprovement(d, id, deps({
      headSha: () => "LKG_SHA",
      commitWorktree: () => "CAND_SHA",
      swapTo: (sha: string, lkg: string) => { seen = { sha, lkg }; },
    }));
    expect(seen).toEqual({ sha: "CAND_SHA", lkg: "LKG_SHA" });
  });

  it("a no-op commit surfaces as a clear failure", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    await runImprovement(d, id, deps({
      commitWorktree: () => { throw new Error("implement produced no changes — the worker reported success but edited nothing"); },
    }));
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(getIntent(d, id)!.error).toContain("produced no changes");
  });

  // `implement` that blocks until the run's abort signal fires (mimics the claude
  // worker being killed), telling the test once it has started so cancels are
  // deterministic — no timers.
  function blockingDeps(over: Partial<any> = {}) {
    let resolveStarted!: () => void;
    const started = new Promise<void>((r) => { resolveStarted = r; });
    return {
      deps: deps({
        implement: (_b: string, _c: string, signal?: AbortSignal) =>
          new Promise((resolve) => {
            resolveStarted();
            signal!.addEventListener("abort", () => resolve({ ok: false, output: "aborted" }), { once: true });
          }),
        ...over,
      }),
      started,
    };
  }

  it("cancelImprovement aborts the RUNNING improvement and marks it cancelled (no swap)", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    let swapped = false;
    const { deps: bd, started } = blockingDeps({ swapTo: () => { swapped = true; } });
    const run = runImprovement(d, id, bd);
    await started; // it's now blocked inside implement
    expect(cancelImprovement(d, id)).toBe(true);
    await run;
    expect(swapped).toBe(false);
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(getIntent(d, id)!.outcome).toBe("cancelled");
  });

  it("cancelAllImprovements stops the running one (the red-button path)", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    const { deps: bd, started } = blockingDeps();
    const run = runImprovement(d, id, bd);
    await started;
    expect(cancelAllImprovements(d)).toBe(1);
    await run;
    expect(getIntent(d, id)!.outcome).toBe("cancelled");
  });

  it("cancelImprovement on an unknown id returns false", () => {
    const d = db();
    expect(cancelImprovement(d, "nope")).toBe(false);
  });

  // ── Plan-approval gate (Part B) ──────────────────────────────────────────
  // Deps that park at awaiting_approval and signal the test once parked, so the
  // approve/reject is deterministic.
  function gatedDeps(over: Partial<any> = {}) {
    let resolveParked!: (plan: string) => void;
    const parked = new Promise<string>((r) => { resolveParked = r; });
    let implemented = false;
    return {
      deps: deps({
        requireApproval: () => true,
        onAwaitingApproval: (_id: string, plan: string) => resolveParked(plan),
        implement: async () => { implemented = true; return { ok: true, output: "" }; },
        ...over,
      }),
      parked,
      wasImplemented: () => implemented,
    };
  }

  it("a gated improvement parks at awaiting_approval, then approve runs it through", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    const { deps: gd, parked, wasImplemented } = gatedDeps();
    const run = runImprovement(d, id, gd);
    const plan = await parked;
    expect(plan).toContain("CHANGE"); // the drafted plan was surfaced for review
    expect(getIntent(d, id)!.status).toBe("awaiting_approval");
    expect(getIntent(d, id)!.diff_summary).toContain("PLAN");
    expect(wasImplemented()).toBe(false); // nothing written before approval
    expect(approveImprovement(id)).toBe(true);
    await run;
    expect(wasImplemented()).toBe(true);
    expect(getIntent(d, id)!.status).toBe("swapped");
  });

  it("reject stops a gated improvement before any code is written", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    const { deps: gd, parked, wasImplemented } = gatedDeps();
    const run = runImprovement(d, id, gd);
    await parked;
    expect(rejectImprovement(id)).toBe(true);
    await run;
    expect(wasImplemented()).toBe(false);
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(getIntent(d, id)!.outcome).toBe("rejected");
  });

  it("cancel while awaiting approval marks it cancelled (not rejected)", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    const { deps: gd, parked, wasImplemented } = gatedDeps();
    const run = runImprovement(d, id, gd);
    await parked;
    expect(cancelImprovement(d, id)).toBe(true);
    await run;
    expect(wasImplemented()).toBe(false);
    expect(getIntent(d, id)!.outcome).toBe("cancelled");
  });

  it("without requireApproval (the overnight loop) it does NOT gate", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "schedule", goal: "g" });
    await runImprovement(d, id, deps()); // no requireApproval dep → straight through
    expect(getIntent(d, id)!.status).toBe("swapped");
  });

  it("approve/reject on an id that isn't waiting returns false", () => {
    expect(approveImprovement("nope")).toBe(false);
    expect(rejectImprovement("nope")).toBe(false);
  });
});
