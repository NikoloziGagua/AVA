import { execFileSync } from "node:child_process";

export function headSha(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
}

export function swapTo(repoRoot: string, sha: string): void {
  // Move the live working tree + current branch to the verified commit.
  execFileSync("git", ["reset", "--hard", sha], { cwd: repoRoot });
}

export function revertTo(repoRoot: string, sha: string): void {
  execFileSync("git", ["reset", "--hard", sha], { cwd: repoRoot });
}
