import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Worktree = { path: string; branch: string };

export function addWorktree(repoRoot: string, id: string): Worktree {
  const path = mkdtempSync(join(tmpdir(), "ava-imp-"));
  const branch = `self/${id}`;
  execFileSync("git", ["worktree", "add", "-B", branch, path], { cwd: repoRoot });
  return { path, branch };
}

export function removeWorktree(repoRoot: string, wt: Worktree): void {
  try { execFileSync("git", ["worktree", "remove", "--force", wt.path], { cwd: repoRoot }); } catch { /* */ }
  try { execFileSync("git", ["branch", "-D", wt.branch], { cwd: repoRoot }); } catch { /* */ }
}
