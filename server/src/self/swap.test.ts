import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headSha, swapTo, revertTo, SwapBlockedError } from "./swap.js";

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

    revertTo(repo, known, candSha);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v1");
  });

  // ── Item 1: swapTo must be fast-forward only ──────────────────────────────
  it("swapTo succeeds when the candidate is a descendant of HEAD", () => {
    // HEAD = v1. Candidate adds v2 on top — HEAD is an ancestor, safe FF.
    const candSha = (() => {
      execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
      writeFileSync(join(repo, "f.txt"), "v2");
      execFileSync("git", ["commit", "-qam", "v2"], { cwd: repo });
      const s = headSha(repo);
      execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
      return s;
    })();
    expect(() => swapTo(repo, candSha)).not.toThrow();
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v2");
  });

  it("swapTo throws (no reset) when HEAD has commits not contained in the candidate", () => {
    // Simulate: a worktree was branched at v1 → produced `cand` (v1 + cand-edit).
    // Meanwhile the live branch advanced to v2 (Sir / another session committed).
    // `cand` does NOT contain v2, so swapping to it would silently drop v2.
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "cand-edit");
    execFileSync("git", ["commit", "-qam", "cand-edit"], { cwd: repo });
    const candSha = headSha(repo);
    execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
    // Live branch moves forward AFTER the candidate was created.
    writeFileSync(join(repo, "f.txt"), "v2");
    execFileSync("git", ["commit", "-qam", "v2"], { cwd: repo });
    const liveHead = headSha(repo);

    let error: unknown;
    try { swapTo(repo, candSha); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(SwapBlockedError);
    expect((error as SwapBlockedError).code).toBe("stale_head");
    // Live tree + HEAD untouched — v2 survives.
    expect(headSha(repo)).toBe(liveHead);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v2");
  });

  it("blocks overlapping uncommitted edits and preserves them", () => {
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "candidate");
    execFileSync("git", ["commit", "-qam", "candidate"], { cwd: repo });
    const candidate = headSha(repo);
    execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "local edit");

    let error: unknown;
    try { swapTo(repo, candidate); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(SwapBlockedError);
    expect((error as SwapBlockedError).code).toBe("overlapping_edits");
    expect((error as SwapBlockedError).blockers).toEqual(["f.txt"]);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("local edit");
  });

  it("fast-forwards while preserving unrelated uncommitted edits", () => {
    writeFileSync(join(repo, "local.txt"), "base");
    execFileSync("git", ["add", "local.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "add local"], { cwd: repo });
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "candidate");
    execFileSync("git", ["commit", "-qam", "candidate"], { cwd: repo });
    const candidate = headSha(repo);
    execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
    writeFileSync(join(repo, "local.txt"), "Niko's local preference");

    swapTo(repo, candidate);

    expect(headSha(repo)).toBe(candidate);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("candidate");
    expect(readFileSync(join(repo, "local.txt"), "utf8")).toBe("Niko's local preference");
  });

  // ── Item 2: revertTo must not clobber work committed after the swap ───────
  it("revertTo rolls back when HEAD is still the swapped commit", () => {
    const known = headSha(repo);
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "v2");
    execFileSync("git", ["commit", "-qam", "v2"], { cwd: repo });
    const candSha = headSha(repo);
    execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
    swapTo(repo, candSha);
    // HEAD == candSha, nothing committed since → revert proceeds.
    revertTo(repo, known, candSha);
    expect(headSha(repo)).toBe(known);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v1");
  });

  it("revertTo SKIPS the rollback when newer commits landed after the swap", () => {
    const known = headSha(repo);
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "v2");
    execFileSync("git", ["commit", "-qam", "v2"], { cwd: repo });
    const candSha = headSha(repo);
    execFileSync("git", ["checkout", "-q", initBranch], { cwd: repo });
    swapTo(repo, candSha);
    // Sir commits ON TOP of the swapped commit before the watchdog fires.
    writeFileSync(join(repo, "f.txt"), "v3-sir-work");
    execFileSync("git", ["commit", "-qam", "v3"], { cwd: repo });
    const afterSir = headSha(repo);

    // Watchdog rollback to last-known-good, but HEAD moved on → must NOT reset.
    revertTo(repo, known, candSha);
    expect(headSha(repo)).toBe(afterSir);               // untouched
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v3-sir-work"); // Sir's work survives
  });
});
