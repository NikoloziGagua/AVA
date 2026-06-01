import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../state/db.js";
import { openDb } from "../state/db.js";
import { createIntent, getIntent } from "./intents.js";
import { runImprovement } from "./improver.js";
import { addWorktree, removeWorktree } from "./worktree.js";
import { headSha, swapTo, revertTo } from "./swap.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-e2e-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "marker.txt"), "v1"); git("add", "."); git("commit", "-qm", "v1");
  return dir;
}
const commitWorktree = (cwd: string, msg: string) => {
  execFileSync("git", ["add", "-A"], { cwd }); execFileSync("git", ["commit", "-qm", msg], { cwd });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
};

describe("self-improvement integration", () => {
  let repo: string;
  // The DB lives at repo/state.db. better-sqlite3 keeps an open OS handle on it,
  // so on Windows rmSync(repo) fails with EPERM unless we close the handle first.
  // (This is the only test-side accommodation for the in-repo state.db; assertions
  // are unchanged and the real worktree/swap modules are exercised as-is.)
  let db: Db | null = null;
  const open = () => { db = openDb(join(repo, "state.db")); return db; };
  beforeEach(() => { repo = tmpRepo(); db = null; });
  afterEach(() => { db?.close(); db = null; rmSync(repo, { recursive: true, force: true }); });

  const baseDeps = (over: any) => ({
    reflect: async () => "CHANGE: edit marker",
    addWorktree: (id: string) => addWorktree(repo, id),
    removeWorktree: (wt: any) => removeWorktree(repo, wt),
    headSha: () => headSha(repo),
    commitWorktree, swapTo: (sha: string) => swapTo(repo, sha), revertTo: (sha: string) => revertTo(repo, sha),
    restart: async () => {}, watch: async () => {}, emit: () => {}, ...over,
  });

  it("ships a verified change into the live tree", async () => {
    const d = open();
    const id = createIntent(d, { trigger: "explicit", goal: "bump marker" });
    await runImprovement(d, id, baseDeps({
      implement: async (_b: string, cwd: string) => { writeFileSync(join(cwd, "marker.txt"), "v2"); return { ok: true, output: "" }; },
      verify: async () => ({ ok: true, log: "ok" }),
    }));
    expect(getIntent(d, id)!.status).toBe("swapped");
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("v2");
  });

  it("rejects a change that fails verify and leaves the live tree untouched", async () => {
    const d = open();
    const id = createIntent(d, { trigger: "explicit", goal: "bad change" });
    await runImprovement(d, id, baseDeps({
      implement: async (_b: string, cwd: string) => { writeFileSync(join(cwd, "marker.txt"), "broken"); return { ok: true, output: "" }; },
      verify: async () => ({ ok: false, log: "tests failed" }),
    }));
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("v1"); // live tree untouched
  });
});
