import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headSha, swapTo, revertTo } from "./swap.js";

function tmpRepo(): { dir: string; initBranch: string } {
  const dir = mkdtempSync(join(tmpdir(), "ava-swap-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "f.txt"), "v1"); git("add", "."); git("commit", "-qm", "v1");
  const initBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir }).toString().trim();
  return { dir, initBranch };
}

describe("swap", () => {
  let repo: string; let initBranch: string;
  beforeEach(() => { const r = tmpRepo(); repo = r.dir; initBranch = r.initBranch; });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("fast-forwards live tree to a commit and can revert to known-good", () => {
    const known = headSha(repo);
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "v2");
    execFileSync("git", ["commit", "-qam", "v2"], { cwd: repo });
    const candSha = headSha(repo);
    execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });

    swapTo(repo, candSha);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v2");

    revertTo(repo, known);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v1");
  });
});
