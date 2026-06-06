import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent } from "./intents.js";
import { runImprovement } from "./improver.js";

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
});
