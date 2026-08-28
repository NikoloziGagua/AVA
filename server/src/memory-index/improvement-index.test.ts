import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { GitImprovementCommitSource, ImprovementIndexCoordinator, type CommittedImprovement, type ImprovementCommitSource } from "./improvement-index.js";
import { MemoryIndexService } from "./store.js";

class FixtureCommits implements ImprovementCommitSource {
  readonly commits = new Map<string, CommittedImprovement>();

  existsOnCurrentBranch(sha: string): boolean {
    return this.commits.has(sha);
  }

  listRecent(limit: number): string[] {
    return [...this.commits.keys()].slice(0, limit);
  }

  read(sha: string): CommittedImprovement {
    const commit = this.commits.get(sha);
    if (!commit) throw new Error("missing fixture commit");
    return commit;
  }
}

function committed(sha: string, over: Partial<CommittedImprovement> = {}): CommittedImprovement {
  return {
    sha,
    subject: "feat(ufo): run pinned Microsoft UFO fixture",
    body: "Adds the genuine bounded adapter and committed verification evidence.",
    authorName: "OpenAI Codex",
    authorEmail: "codex@example.test",
    committedAt: Date.UTC(2026, 7, 28),
    files: ["server/src/ufo/service.ts", "server/src/ufo/service.test.ts", "docs/features/microsoft-ufo-experiment.md"],
    featureDocumentation: "# Microsoft UFO\n\n## Status\n\nThe genuine pinned runtime completed a benign disposable Notepad fixture through AVA.\n",
    ...over,
  };
}

describe("committed improvement indexing", () => {
  it("backfills real product commits, preserves provenance and is replay idempotent", async () => {
    const sha = "1".repeat(40);
    const commits = new FixtureCommits();
    commits.commits.set(sha, committed(sha));
    const db = openInMemoryDb();
    const memory = new MemoryIndexService(db, null, (candidate) => commits.existsOnCurrentBranch(candidate));
    const coordinator = new ImprovementIndexCoordinator(memory, commits);

    expect(await coordinator.reconcileRecent()).toEqual({ indexed: 1, reused: 0, skipped: 0, failed: 0 });
    expect(await coordinator.reconcileRecent()).toEqual({ indexed: 0, reused: 1, skipped: 0, failed: 0 });

    const result = (await memory.search("What update added Microsoft UFO Notepad support?", { limit: 5 })).results[0];
    expect(result).toMatchObject({
      entry: {
        kind: "improvement",
        title: "Run pinned Microsoft UFO fixture",
        summary: "The genuine pinned runtime completed a benign disposable Notepad fixture through AVA.",
      },
      source: { type: "improvement_record", commitSha: sha, status: "verified" },
      usable: true,
    });
  });

  it("skips coordination, documentation and test-only commits rather than calling them product improvements", async () => {
    const sha = "2".repeat(40);
    const commits = new FixtureCommits();
    commits.commits.set(sha, committed(sha, {
      subject: "docs(coord): complete task",
      files: ["coord/BOARD.md", "docs/features/example.md", "server/src/example.test.ts"],
    }));
    const db = openInMemoryDb();
    const coordinator = new ImprovementIndexCoordinator(
      new MemoryIndexService(db, null, (candidate) => commits.existsOnCurrentBranch(candidate)),
      commits,
    );

    expect(await coordinator.reconcileRecent()).toEqual({ indexed: 0, reused: 0, skipped: 1, failed: 0 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM improvement_records").get()).toEqual({ count: 0 });
  });

  it("redacts source metadata before it becomes a searchable record", async () => {
    const sha = "3".repeat(40);
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const commits = new FixtureCommits();
    commits.commits.set(sha, committed(sha, {
      body: `The implementation used ${secret} in a redaction fixture.`,
      featureDocumentation: null,
    }));
    const db = openInMemoryDb();
    const memory = new MemoryIndexService(db, null, (candidate) => commits.existsOnCurrentBranch(candidate));
    await new ImprovementIndexCoordinator(memory, commits).indexCommit(sha);

    const row = db.prepare("SELECT summary FROM improvement_records WHERE commit_sha = ?").get(sha) as { summary: string };
    expect(row.summary).not.toContain(secret);
    expect(JSON.stringify(await memory.search("UFO fixture"))).not.toContain(secret);
  });
});

const temporaryRepositories: string[] = [];
afterEach(() => {
  for (const path of temporaryRepositories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("GitImprovementCommitSource", () => {
  it("reads an exact reachable commit and rejects non-commit identities", () => {
    const root = mkdtempSync(join(tmpdir(), "ava-improvement-git-"));
    temporaryRepositories.push(root);
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    git("init");
    git("config", "user.name", "OpenAI Codex");
    git("config", "user.email", "codex@example.test");
    writeFileSync(join(root, "feature.ts"), "export const improvement = true;\n", "utf8");
    git("add", "feature.ts");
    git("commit", "-m", "feat(core): add fixture improvement");
    const sha = git("rev-parse", "HEAD");
    const source = new GitImprovementCommitSource(root);

    expect(source.existsOnCurrentBranch(sha)).toBe(true);
    expect(source.existsOnCurrentBranch("not-a-sha")).toBe(false);
    expect(source.listRecent(5)).toEqual([sha]);
    expect(source.read(sha)).toMatchObject({ sha, subject: "feat(core): add fixture improvement", files: ["feature.ts"] });
    expect(() => source.read("0".repeat(40))).toThrow(/not reachable/i);
  });
});
