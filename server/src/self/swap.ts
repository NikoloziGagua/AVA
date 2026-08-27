import { execFileSync, spawnSync } from "node:child_process";

export type SwapBlockedCode = "stale_head" | "overlapping_edits" | "merge_refused";

/** A verified candidate cannot be installed right now without risking live
 * work. Callers preserve it and expose a retry boundary instead of converting
 * this into a terminal implementation failure. */
export class SwapBlockedError extends Error {
  readonly code: SwapBlockedCode;
  readonly blockers: string[];

  constructor(code: SwapBlockedCode, message: string, blockers: string[] = []) {
    super(message);
    this.name = "SwapBlockedError";
    this.code = code;
    this.blockers = blockers;
  }
}

export function headSha(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
}

/** True iff `ancestor` is reachable from `descendant` (i.e. a swap to
 *  `descendant` is a pure fast-forward that drops no commits). */
function isAncestor(repoRoot: string, ancestor: string, descendant: string): boolean {
  const r = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repoRoot });
  // exit 0 = ancestor; exit 1 = not; other = error (treat as not-safe).
  return r.status === 0;
}

function nulPaths(repoRoot: string, args: string[]): string[] {
  const raw = execFileSync("git", args, { cwd: repoRoot }).toString();
  return raw.split("\0").map((path) => path.trim()).filter(Boolean);
}

/** Tracked edits only. Untracked paths are protected by Git's own merge
 * collision check and are never removed by this module. */
export function trackedWorkingTreePaths(repoRoot: string): string[] {
  return [...new Set([
    ...nulPaths(repoRoot, ["diff", "--name-only", "-z"]),
    ...nulPaths(repoRoot, ["diff", "--cached", "--name-only", "-z"]),
  ])].sort();
}

export function swapTo(repoRoot: string, sha: string): void {
  // SAFETY: only ever fast-forward. If commits landed on the live branch AFTER
  // the self-improve worktree was created (Sir editing, a concurrent session,
  // another improvement), the current HEAD is NOT an ancestor of the candidate
  // — resetting onto the candidate would silently DROP those in-between commits.
  // Preserve the candidate and expose a resumable reconciliation boundary.
  const head = headSha(repoRoot);
  if (head !== sha && !isAncestor(repoRoot, head, sha)) {
    throw new SwapBlockedError(
      "stale_head",
      `swap blocked: HEAD (${head.slice(0, 12)}) advanced beyond candidate (${sha.slice(0, 12)}); reconcile and re-verify before installing`,
    );
  }
  // SAFETY: the fast-forward check protects COMMITS; this protects UNCOMMITTED
  // work. `reset --hard` silently destroys tracked edits in progress — the exact
  // recorded collision with concurrent dev sessions. Refuse instead.
  const dirtyPaths = trackedWorkingTreePaths(repoRoot);
  const changedPaths = new Set(nulPaths(repoRoot, ["diff", "--name-only", "-z", head, sha]));
  const overlaps = dirtyPaths.filter((path) => changedPaths.has(path));
  if (overlaps.length > 0) {
    throw new SwapBlockedError(
      "overlapping_edits",
      `swap blocked: candidate overlaps ${overlaps.length} uncommitted tracked ${overlaps.length === 1 ? "file" : "files"}:\n${overlaps.slice(0, 20).join("\n")}`,
      overlaps,
    );
  }
  // Move the live branch with Git's non-destructive fast-forward machinery.
  try {
    execFileSync("git", ["merge", "--ff-only", sha], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
    throw new SwapBlockedError(
      "merge_refused",
      `swap blocked: Git refused the safe fast-forward${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
      dirtyPaths,
    );
  }
}

/**
 * Watchdog rollback to last-known-good. Intentionally BACKWARD (it undoes a bad
 * swap), so this does NOT enforce fast-forward. It IS, however, guarded against
 * clobbering work committed after the swap: pass the sha the swap moved HEAD to
 * as `expectedHead`; if HEAD has since moved on (newer commits exist), the
 * rollback is SKIPPED rather than resetting back over them.
 */
export function revertTo(repoRoot: string, sha: string, expectedHead?: string): boolean {
  if (expectedHead !== undefined) {
    const head = headSha(repoRoot);
    if (head !== expectedHead) {
      // Something was committed after the swap — do not destroy it.
      // eslint-disable-next-line no-console
      console.warn(
        `self: skipping watchdog revert — HEAD (${head.slice(0, 12)}) moved past the swapped commit (${expectedHead.slice(0, 12)}); not rolling back over newer work`,
      );
      return false;
    }
  }
  execFileSync("git", ["reset", "--hard", sha], { cwd: repoRoot });
  return true;
}
