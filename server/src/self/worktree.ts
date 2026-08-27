import { execFileSync } from "node:child_process";
import {
  mkdtempSync, existsSync, readdirSync, symlinkSync, lstatSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export type Worktree = { path: string; branch: string; baseSha?: string };
export type BasedWorktree = Worktree & { baseSha: string };

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

export function addWorktree(repoRoot: string, id: string): BasedWorktree {
  const path = mkdtempSync(join(tmpdir(), "ava-imp-"));
  const branch = `self/${id}`;
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
  execFileSync("git", ["worktree", "add", "-B", branch, path, baseSha], { cwd: repoRoot });
  for (const rel of nodeModulesRels(repoRoot)) {
    const target = join(repoRoot, rel);
    const link = join(path, rel);
    // Only link where the worktree parent already exists (root + tracked
    // workspaces); never invent directories. Best-effort: a missing link only
    // makes verify fail loudly, it can never be unsafe.
    if (!existsSync(dirname(link))) continue;
    try { symlinkSync(target, link, "junction"); } catch { /* leave it to verify */ }
  }
  return { path, branch, baseSha };
}

/**
 * Finalize a verified candidate. Coding workers may leave ordinary edits or
 * create their own scoped commits (Codex repository instructions require the
 * latter). A clean worktree is therefore a no-op only when HEAD is still the
 * exact commit from which the worktree was created.
 */
export function commitWorktreeChanges(cwd: string, msg: string, baseSha: string): string {
  execFileSync("git", ["add", "-A"], { cwd });
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd }).toString().trim();
  const before = execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
  if (!dirty) {
    if (before === baseSha) {
      throw new Error("implement produced no changes — the worker reported success but edited nothing");
    }
    return before;
  }
  try {
    execFileSync("git", ["commit", "-m", msg], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`git commit failed: ${stderr || (error instanceof Error ? error.message : String(error))}`);
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
}

/** Branches currently checked out by a live worktree (refs/heads/<short>). */
function worktreeBranches(repoRoot: string): Set<string> {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot }).toString();
  const branches = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^branch\s+refs\/heads\/(.+)$/.exec(line.trim());
    if (m) branches.add(m[1]!);
  }
  return branches;
}

/**
 * Boot cleanup for leaked self-improvement state. A crash/restart mid-improvement
 * leaves a temp worktree dir + a `self/<id>` branch behind ("prunable" in
 * `git worktree list`). `failStaleIntents` reconciles the DB rows but nothing
 * touches git. This:
 *   1. `git worktree prune` — drops admin entries whose dirs are already gone,
 *   2. deletes any `self/*` branch NOT backing a live worktree.
 * Best-effort: every step is wrapped so a boot can never crash on it. Returns the
 * deleted branch names (for logging).
 */
export function pruneOrphanWorktrees(repoRoot: string): string[] {
  try {
    execFileSync("git", ["worktree", "prune"], { cwd: repoRoot });
  } catch { /* best-effort */ }

  let live: Set<string>;
  try {
    live = worktreeBranches(repoRoot);
  } catch {
    return []; // can't enumerate worktrees → don't risk deleting a live branch
  }

  let selfBranches: string[] = [];
  try {
    const out = execFileSync(
      "git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/self/"], { cwd: repoRoot },
    ).toString();
    selfBranches = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }

  const deleted: string[] = [];
  for (const branch of selfBranches) {
    if (live.has(branch)) continue; // still in use by a worktree — leave it
    try {
      execFileSync("git", ["branch", "-D", branch], { cwd: repoRoot });
      deleted.push(branch);
    } catch { /* best-effort per branch */ }
  }
  return deleted;
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
