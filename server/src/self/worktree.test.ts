import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorktree, removeWorktree } from "./worktree.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-wt-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "f.txt"), "hi"); git("add", "."); git("commit", "-qm", "init");
  return dir;
}

describe("worktree", () => {
  let repo: string; let wt: { path: string; branch: string } | null = null;
  beforeEach(() => { repo = tmpRepo(); });
  afterEach(() => { if (wt) removeWorktree(repo, wt); rmSync(repo, { recursive: true, force: true }); });

  it("adds an isolated worktree on a new branch and removes it", () => {
    wt = addWorktree(repo, "imp-1");
    expect(existsSync(join(wt.path, "f.txt"))).toBe(true);
    expect(wt.branch).toBe("self/imp-1");
    removeWorktree(repo, wt); wt = null;
  });
});
