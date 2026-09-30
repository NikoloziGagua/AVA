import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitImprovementCommitSource, ImprovementIndexCoordinator } from "../src/memory-index/improvement-index.js";
import { MemoryIndexService } from "../src/memory-index/store.js";
import { openDb } from "../src/state/db.js";

const repoRoot = resolve(process.cwd(), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "ava-improvement-index-smoke-"));
const dbPath = join(fixtureRoot, "ava-smoke.db");
const commits = new GitImprovementCommitSource(repoRoot);

try {
  let db = openDb(dbPath);
  let memory = new MemoryIndexService(db, null, (sha) => commits.existsOnCurrentBranch(sha));
  let coordinator = new ImprovementIndexCoordinator(memory, commits);
  const initial = await coordinator.reconcileRecent(1_000);
  if (initial.indexed < 1) throw new Error("no committed AVA product improvements were indexed");
  db.close();

  db = openDb(dbPath);
  memory = new MemoryIndexService(db, null, (sha) => commits.existsOnCurrentBranch(sha));
  coordinator = new ImprovementIndexCoordinator(memory, commits);
  const replay = await coordinator.reconcileRecent(1_000);
  if (replay.indexed !== 0 || replay.reused < 1) throw new Error("restart reconciliation was not idempotent");

  const search = await memory.search("What AVA update added the genuine Microsoft UFO Notepad workflow?", { limit: 10 });
  const ufo = search.results.find((result) => result.entry.kind === "improvement" && result.entry.title.toLocaleLowerCase().includes("ufo"));
  if (!ufo?.usable || ufo.source.type !== "improvement_record" || !ufo.source.commitSha) {
    throw new Error("the real Microsoft UFO improvement was not returned with verified Git provenance");
  }
  const source = memory.readSource(ufo.entry.id);
  if (!source?.messages[0]?.content.includes(`Git commit: ${ufo.source.commitSha}`)) {
    throw new Error("the improvement source did not preserve its exact Git commit");
  }
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM improvement_records) AS records,
      (SELECT COUNT(*) FROM memory_index_entries WHERE kind = 'improvement') AS entries
  `).get() as { records: number; entries: number };
  if (counts.records !== counts.entries) throw new Error("improvement record and memory entry counts diverged");

  console.log(JSON.stringify({
    ok: true,
    initial,
    replay,
    indexedImprovements: counts.entries,
    ufo: {
      id: ufo.entry.id,
      title: ufo.entry.title,
      commitSha: ufo.source.commitSha,
      sourceStatus: ufo.source.status,
      matchMode: ufo.match.mode,
    },
    restartPersistence: true,
    cleanup: "temporary database removed",
  }, null, 2));
  db.close();
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
