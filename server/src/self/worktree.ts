import { execFileSync } from "node:child_process";
import {
  mkdtempSync, existsSync, readdirSync, symlinkSync, lstatSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export type Worktree = { path: string; branch: string };

// A fresh `git worktree add` checks out source but NOT node_modules (gitignored),
// so verify's `npm test` can't resolve vitest/etc. We junction the repo's existing
// node_modules (root + each workspace) into the worktree — instant, reuses the
// already-built native modules, no reinstall.
function nodeModulesRels(repoRoot: string): string[] {
  const rels: string[] = [];
  if (existsSync(join(repoRoot, "node_modules"))) rels.push("node_modules");
  try {
    for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== "node_modules"
        && existsSync(join(repoRoot, e.name, "node_modules"))) {
        rels.push(join(e.name, "node_modules"));
      }
    }
  } catch { /* repoRoot unreadable — nothing to link */ }
  return rels;
}

export function addWorktree(repoRoot: string, id: string): Worktree {
  const path = mkdtempSync(join(tmpdir(), "ava-imp-"));
  const branch = `self/${id}`;
  execFileSync("git", ["worktree", "add", "-B", branch, path], { cwd: repoRoot });
  for (const rel of nodeModulesRels(repoRoot)) {
    const target = join(repoRoot, rel);
    const link = join(path, rel);
    // Only link where the worktree parent already exists (root + tracked
    // workspaces); never invent directories. Best-effort: a missing link only
    // makes verify fail loudly, it can never be unsafe.
    if (!existsSync(dirname(link))) continue;
    try { symlinkSync(target, link, "junction"); } catch { /* leave it to verify */ }
  }
  return { path, branch };
}

export function removeWorktree(repoRoot: string, wt: Worktree): void {
  // Remove the node_modules junctions BEFORE git deletes the worktree, and
  // remove them NON-recursively. rmSync(recursive:false) on a junction is a
  // plain rmdir of the reparse point — it unlinks the junction and can NEVER
  // delete the real node_modules it points at. If a path is somehow a real
  // directory instead of a junction, the non-recursive rm throws and we leave
  // it for git to clean inside the worktree (which is safe — it's not the repo's).
  for (const rel of nodeModulesRels(repoRoot)) {
    const link = join(wt.path, rel);
    try {
      lstatSync(link); // throws if absent
      rmSync(link, { recursive: false, force: true });
    } catch { /* absent, or a real dir we deliberately don't recurse into */ }
  }
  try { execFileSync("git", ["worktree", "remove", "--force", wt.path], { cwd: repoRoot }); } catch { /* */ }
  try { execFileSync("git", ["branch", "-D", wt.branch], { cwd: repoRoot }); } catch { /* */ }
}
