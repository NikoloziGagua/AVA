import { execFileSync } from "node:child_process";

// Single source of truth for the self-improvement safety guard. A swap whose
// diff touches security/policy/auth, the self-improvement machinery, the
// approval flow, the path allowlist, secret scrubbing, etc. is REFUSED — Ava
// must not hot-swap a change that weakens its own guardrails. Both the live
// interactive path (src/index.ts → improver) and the overnight loop
// (scripts/auto-improve-loop.ts) import this so there is exactly one regex.
export const SAFETY_RE =
  /(\/(security|policy|auth)\/|\/self\/(verify|swap|watchdog|boot-smoke|improver|suggest|claude-session|auto-improve|model-policy|intents|safety-guard)|approval|settings\.local|\.claude\/|path-allowlist|workerEnv|scrub)/i;

/** List the files changed between two commits. */
export function changedFiles(repoRoot: string, fromSha: string, toSha: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", fromSha, toSha], { cwd: repoRoot }).toString();
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Throw if swapping `sha` (relative to last-known-good `lkg`) would change any
 * safety-critical file. Call this BEFORE the actual `swapTo`, so the intent is
 * failed instead of the weakened guardrail being shipped live.
 */
export function assertSwapSafe(repoRoot: string, lkg: string, sha: string): void {
  const files = changedFiles(repoRoot, lkg, sha);
  const offending = files.filter((f) => SAFETY_RE.test(f));
  if (offending.length > 0) {
    throw new Error(
      `guard: refusing to swap — change touches safety-critical code:\n${offending.join("\n")}`,
    );
  }
}
