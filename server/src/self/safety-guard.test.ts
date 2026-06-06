import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { headSha } from "./swap.js";
import { SAFETY_RE, changedFiles, assertSwapSafe } from "./safety-guard.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-guard-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  // Seed the paths a real self-improve diff would touch.
  for (const rel of ["server/src/routes/chat.ts", "server/src/policy/classify.ts"]) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "// v1\n");
  }
  git("add", "."); git("commit", "-qm", "v1");
  return dir;
}

/** Make a commit on a candidate branch editing `rel`, return its sha. */
function candidateEditing(repo: string, branch: string, rel: string): string {
  const initBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo }).toString().trim();
  execFileSync("git", ["checkout", "-qb", branch], { cwd: repo });
  writeFileSync(join(repo, rel), "// v2 changed\n");
  execFileSync("git", ["commit", "-qam", `edit ${rel}`], { cwd: repo });
  const sha = headSha(repo);
  execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
  return sha;
}

describe("safety-guard", () => {
  describe("SAFETY_RE", () => {
    it("matches safety-critical paths", () => {
      for (const p of [
        "server/src/policy/classify.ts",
        "server/src/policy/enforce.ts",
        "server/src/security/scrub.ts",
        "server/src/auth/tokens.ts",
        "server/src/self/swap.ts",
        "server/src/self/improver.ts",
        "server/src/tools/path-allowlist.ts",
        "server/src/routes/approvals.ts",
        "server/src/self/safety-guard.ts",
      ]) {
        expect(SAFETY_RE.test(p)).toBe(true);
      }
    });
    it("does NOT match ordinary feature paths", () => {
      for (const p of [
        "server/src/routes/chat.ts",
        "server/src/routes/sessions.ts",
        "web/src/App.tsx",
        "server/src/orchestrator/agent.ts",
      ]) {
        expect(SAFETY_RE.test(p)).toBe(false);
      }
    });
  });

  describe("assertSwapSafe", () => {
    let repo: string;
    beforeEach(() => { repo = tmpRepo(); });
    afterEach(() => rmSync(repo, { recursive: true, force: true }));

    it("refuses a candidate that touches policy/classify.ts", () => {
      const lkg = headSha(repo);
      const sha = candidateEditing(repo, "bad", "server/src/policy/classify.ts");
      expect(() => assertSwapSafe(repo, lkg, sha)).toThrow(/safety-critical/i);
    });

    it("passes a candidate that touches only routes/chat.ts", () => {
      const lkg = headSha(repo);
      const sha = candidateEditing(repo, "good", "server/src/routes/chat.ts");
      expect(() => assertSwapSafe(repo, lkg, sha)).not.toThrow();
      expect(changedFiles(repo, lkg, sha)).toEqual(["server/src/routes/chat.ts"]);
    });
  });
});
