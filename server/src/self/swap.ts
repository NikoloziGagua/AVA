import { execFileSync, spawnSync } from "node:child_process";

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

export function swapTo(repoRoot: string, sha: string): void {
  // SAFETY: only ever fast-forward. If commits landed on the live branch AFTER
  // the self-improve worktree was created (Sir editing, a concurrent session,
  // another improvement), the current HEAD is NOT an ancestor of the candidate
  // — resetting onto the candidate would silently DROP those in-between commits.
  // Refuse: runImprovement's try/catch then marks the intent failed instead of
  // clobbering work (recoverable only via reflog otherwise).
  const head = headSha(repoRoot);
  if (head !== sha && !isAncestor(repoRoot, head, sha)) {
    throw new Error(
      `refusing non-fast-forward swap: HEAD (${head.slice(0, 12)}) has commits not in the candidate (${sha.slice(0, 12)})`,
    );
  }
  // Move the live working tree + current branch to the verified commit.
  execFileSync("git", ["reset", "--hard", sha], { cwd: repoRoot });
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
