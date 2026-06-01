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
});
