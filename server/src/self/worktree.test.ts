import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, lstatSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree, commitWorktreeChanges, removeWorktree, pruneOrphanWorktrees,
  type BasedWorktree,
} from "./worktree.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-wt-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "f.txt"), "hi"); git("add", "."); git("commit", "-qm", "init");
  return dir;
}

describe("worktree", () => {
  let repo: string; let wt: BasedWorktree | null = null;
  beforeEach(() => { repo = tmpRepo(); wt = null; });
  afterEach(() => { if (wt) removeWorktree(repo, wt); wt = null; rmSync(repo, { recursive: true, force: true }); });

  it("adds an isolated worktree on a new branch and removes it", () => {
    wt = addWorktree(repo, "imp-1");
    expect(existsSync(join(wt.path, "f.txt"))).toBe(true);
    expect(wt.branch).toBe("self/imp-1");
    expect(wt.baseSha).toMatch(/^[a-f0-9]{40}$/);
    removeWorktree(repo, wt); wt = null;
  });

  it("commits ordinary worker edits after verification", () => {
    wt = addWorktree(repo, "imp-edit");
    writeFileSync(join(wt.path, "f.txt"), "changed");
    const sha = commitWorktreeChanges(wt.path, "self: edit", wt.baseSha);
    expect(sha).not.toBe(wt.baseSha);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: wt.path }).toString()).toBe("");
  });

  it("reuses a scoped commit created by the coding worker", () => {
    wt = addWorktree(repo, "imp-precommit");
    writeFileSync(join(wt.path, "f.txt"), "worker committed");
    execFileSync("git", ["add", "-A"], { cwd: wt.path });
    execFileSync("git", ["commit", "-qm", "worker: scoped change"], { cwd: wt.path });
    const workerSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt.path }).toString().trim();
    expect(commitWorktreeChanges(wt.path, "self: wrapper", wt.baseSha)).toBe(workerSha);
  });

  it("still rejects a true no-op worker", () => {
    wt = addWorktree(repo, "imp-noop");
    expect(() => commitWorktreeChanges(wt!.path, "self: no-op", wt!.baseSha))
      .toThrow("implement produced no changes");
  });

  it("junctions the repo's node_modules into the worktree so verify can resolve deps", () => {
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "marker.txt"), "dep");
    wt = addWorktree(repo, "imp-nm");
    // The dependency is visible through the link, and the link is a junction/symlink.
    expect(existsSync(join(wt.path, "node_modules", "marker.txt"))).toBe(true);
    expect(lstatSync(join(wt.path, "node_modules")).isSymbolicLink()).toBe(true);
    removeWorktree(repo, wt); wt = null;
  });

  it("removing a worktree never deletes the real node_modules behind the junction", () => {
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "marker.txt"), "dep");
    const w = addWorktree(repo, "imp-safe");
    removeWorktree(repo, w);
    // Worktree gone, but the real node_modules + its contents survive.
    expect(existsSync(w.path)).toBe(false);
    expect(existsSync(join(repo, "node_modules", "marker.txt"))).toBe(true);
  });

  // ── Item 4: prune orphaned self-improve worktrees + branches at boot ──────
  const branches = (r: string) =>
    execFileSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], { cwd: r })
      .toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  it("deletes a dangling self/* branch whose worktree dir was removed", () => {
    const w = addWorktree(repo, "orphan-1");
    expect(branches(repo)).toContain("self/orphan-1");
    // Simulate a crash mid-improvement: the temp worktree dir vanishes but the
    // branch + git's admin entry are left behind (the "prunable" leak).
    rmSync(w.path, { recursive: true, force: true });

    const deleted = pruneOrphanWorktrees(repo);
    expect(deleted).toContain("self/orphan-1");
    expect(branches(repo)).not.toContain("self/orphan-1");
  });

  it("keeps a self/* branch that still backs a live worktree", () => {
    wt = addWorktree(repo, "alive-1"); // cleaned up in afterEach
    const deleted = pruneOrphanWorktrees(repo);
    expect(deleted).not.toContain("self/alive-1");
    expect(branches(repo)).toContain("self/alive-1");
  });

  it("never touches non-self branches", () => {
    execFileSync("git", ["branch", "feature/keep-me"], { cwd: repo });
    const w = addWorktree(repo, "orphan-2");
    rmSync(w.path, { recursive: true, force: true });
    pruneOrphanWorktrees(repo);
    expect(branches(repo)).toContain("feature/keep-me");
    expect(branches(repo)).not.toContain("self/orphan-2");
  });

  it("is a no-op (no throw) on a repo with no self/* branches", () => {
    expect(() => pruneOrphanWorktrees(repo)).not.toThrow();
    expect(pruneOrphanWorktrees(repo)).toEqual([]);
  });
});
