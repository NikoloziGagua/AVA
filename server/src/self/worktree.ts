import { execFileSync } from "node:child_process";
import {
  mkdtempSync, existsSync, readdirSync, symlinkSync, lstatSync, rmSync,
  readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export type Worktree = { path: string; branch: string; baseSha?: string };
export type BasedWorktree = Worktree & { baseSha: string };

const CANDIDATE_REF_ROOT = "refs/ava/self-candidates";

export class CandidateReconcileError extends Error {
  readonly conflicts: string[];

  constructor(message: string, conflicts: string[] = []) {
    super(message);
    this.name = "CandidateReconcileError";
    this.conflicts = conflicts;
  }
}

function candidateRef(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("invalid self-improvement id");
  return `${CANDIDATE_REF_ROOT}/${id}`;
}

/** Keep a verified candidate reachable after its temporary worktree/branch is
 * removed. This ref is internal Git evidence, not a branch users can edit. */
export function preserveCandidateRef(repoRoot: string, id: string, sha: string): void {
  execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot });
  execFileSync("git", ["update-ref", candidateRef(id), sha], { cwd: repoRoot });
}

export function releaseCandidateRef(repoRoot: string, id: string): void {
  try { execFileSync("git", ["update-ref", "-d", candidateRef(id)], { cwd: repoRoot }); } catch { /* idempotent */ }
}

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

function gitText(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd }).toString();
}

function conflictedPaths(cwd: string): string[] {
  return gitText(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"])
    .split("\0").map((path) => path.trim()).filter(Boolean);
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

/** Merge the one repository file whose contract is explicitly append-only.
 * Both sides must be literal extensions of the candidate commit's parent;
 * otherwise we fail closed like every other conflict. */
function resolveAppendOnlyBoard(cwd: string, commit: string, boardBefore: string): boolean {
  const boardPath = "coord/BOARD.md";
  let parentBoard: string;
  let candidateBoard: string;
  try {
    parentBoard = gitText(cwd, ["show", `${commit}^:${boardPath}`]);
    candidateBoard = gitText(cwd, ["show", `${commit}:${boardPath}`]);
  } catch {
    return false;
  }
  // `git show` returns canonical LF content while a Windows checkout may use
  // CRLF. Compare normalized text so line-ending conversion cannot turn a
  // provably append-only history into a false conflict.
  const parent = normalizeLf(parentBoard);
  const current = normalizeLf(boardBefore);
  const candidate = normalizeLf(candidateBoard);
  if (!candidate.startsWith(parent) || !current.startsWith(parent)) return false;
  const candidateAppend = candidate.slice(parent.length);
  const separator = current.endsWith("\n") || candidateAppend.startsWith("\n") ? "" : "\n";
  writeFileSync(join(cwd, boardPath), current + separator + candidateAppend, "utf8");
  execFileSync("git", ["add", "--", boardPath], { cwd });
  try {
    execFileSync("git", ["-c", "core.editor=true", "cherry-pick", "--continue"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/** Replay an already-approved candidate onto the recovery worktree's current
 * HEAD. Every candidate commit is replayed; conflicts fail closed, except for a
 * provably append-only BOARD.md extension where both histories are retained. */
export function reconcileCandidate(
  cwd: string,
  originalBaseSha: string,
  candidateSha: string,
): string {
  const ancestry = spawnGit(cwd, ["merge-base", "--is-ancestor", originalBaseSha, candidateSha]);
  if (ancestry !== 0) {
    throw new CandidateReconcileError("candidate no longer contains its recorded base commit");
  }
  const commits = gitText(cwd, ["rev-list", "--reverse", `${originalBaseSha}..${candidateSha}`])
    .split(/\r?\n/).map((sha) => sha.trim()).filter(Boolean);
  if (commits.length === 0) throw new CandidateReconcileError("candidate contains no commits to recover");

  for (const commit of commits) {
    const boardPath = join(cwd, "coord/BOARD.md");
    const boardBefore = existsSync(boardPath) ? readFileSync(boardPath, "utf8") : "";
    try {
      execFileSync("git", ["cherry-pick", commit], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const conflicts = conflictedPaths(cwd);
      if (conflicts.length === 1 && conflicts[0] === "coord/BOARD.md"
        && resolveAppendOnlyBoard(cwd, commit, boardBefore)) {
        continue;
      }
      try { execFileSync("git", ["cherry-pick", "--abort"], { cwd }); } catch { /* isolated worktree is discarded */ }
      const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
      throw new CandidateReconcileError(
        `candidate conflicts with current HEAD${conflicts.length ? ` in ${conflicts.join(", ")}` : ""}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
        conflicts,
      );
    }
  }
  return gitText(cwd, ["rev-parse", "HEAD"]).trim();
}

function spawnGit(cwd: string, args: string[]): number | null {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore" });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? null;
  }
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
