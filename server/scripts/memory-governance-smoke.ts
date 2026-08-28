import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MemoryIndexService } from "../src/memory-index/store.js";
import { openDb } from "../src/state/db.js";
import { appendMessage } from "../src/state/messages.js";
import { createSession } from "../src/state/sessions.js";

async function capture(
  service: MemoryIndexService,
  db: ReturnType<typeof openDb>,
  title: string,
  summary: string,
) {
  const session = createSession(db, { title });
  const user = appendMessage(db, { sessionId: session.id, role: "user", content: `Develop ${title}.` });
  const assistant = appendMessage(db, { sessionId: session.id, role: "assistant", content: summary });
  return (await service.capture({
    sessionId: session.id,
    fromMessageId: user.id,
    throughMessageId: assistant.id,
    kind: "idea",
    title,
    summary,
    tags: title.toLocaleLowerCase().split(/\s+/),
  })).result;
}

async function main(): Promise<void> {
  const childDbPath = process.env.AVA_MEMORY_GOVERNANCE_SMOKE_DB;
  if (!childDbPath) {
    const smokeDir = mkdtempSync(join(tmpdir(), "ava-memory-governance-smoke-"));
    const dbPath = join(smokeDir, "ava-smoke.sqlite");
    const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url)], {
      cwd: process.cwd(),
      env: { ...process.env, AVA_MEMORY_GOVERNANCE_SMOKE_DB: dbPath },
      encoding: "utf8",
      timeout: 30_000,
    });
    rmSync(smokeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    const cleaned = !existsSync(smokeDir);
    assert.equal(cleaned, true, "manual smoke data must be removed after the SQLite child exits");
    if (child.status !== 0) throw new Error(child.stderr || child.stdout || `governance smoke child exited ${child.status}`);
    const evidence = JSON.parse(child.stdout) as { checks: string[] };
    process.stdout.write(`${JSON.stringify({ ...evidence, cleanup: cleaned }, null, 2)}\n`);
    return;
  }

  const dbPath = childDbPath;
  {
    let db = openDb(dbPath);
    let service = new MemoryIndexService(db, null);
    const correctedBase = await capture(service, db, "Launch calendar", "The launch is scheduled for Monday.");
    const pinnedBase = await capture(service, db, "Priority indexing plan", "The priority indexing plan uses source verification.");
    const conflictWinner = await capture(service, db, "Cache policy short", "Cache policy keeps results for five minutes.");
    const conflictLoser = await capture(service, db, "Cache policy long", "Cache policy keeps results for thirty minutes.");
    const obsolete = await capture(service, db, "Old retention policy", "Retention policy keeps detail for ten days.");
    const replacement = await capture(service, db, "Current retention policy", "Retention policy keeps detail for thirty days.");

    const corrected = await service.correct({
      threadId: correctedBase.lineage.threadId,
      entryId: correctedBase.entry.id,
      expectedVersion: correctedBase.governance.threadVersion,
      actor: "user",
      reason: "Niko corrected the agreed launch day.",
      requestKey: "smoke-correct-launch",
      correction: { summary: "The launch is scheduled for Tuesday." },
    });
    assert.equal(corrected.ok, true);
    if (!corrected.ok) throw new Error(corrected.message);
    assert.match(corrected.result.entry.summary, /Tuesday/);
    assert.match(corrected.result.originalEntry.summary, /Monday/);
    const replay = await service.correct({
      threadId: correctedBase.lineage.threadId,
      entryId: correctedBase.entry.id,
      expectedVersion: correctedBase.governance.threadVersion,
      actor: "user",
      reason: "Niko corrected the agreed launch day.",
      requestKey: "smoke-correct-launch",
      correction: { summary: "A replay cannot replace the first correction." },
    });
    assert.equal(replay.ok && replay.event.id, corrected.event.id);

    const pinned = service.setPinned({
      threadId: pinnedBase.lineage.threadId,
      expectedVersion: pinnedBase.governance.threadVersion,
      pinned: true,
      actor: "user",
      reason: "Keep the source-verified indexing plan prominent.",
      requestKey: "smoke-pin-priority",
    });
    assert.equal(pinned.ok, true);
    assert.equal(service.listRecent().results[0]?.lineage.threadId, pinnedBase.lineage.threadId);

    const opened = service.openConflict({
      threadId: conflictWinner.lineage.threadId,
      expectedVersion: conflictWinner.governance.threadVersion,
      otherThreadId: conflictLoser.lineage.threadId,
      otherExpectedVersion: conflictLoser.governance.threadVersion,
      actor: "user",
      reason: "These cache durations contradict each other.",
      requestKey: "smoke-open-cache-conflict",
    });
    assert.equal(opened.ok, true);
    const conflictSearch = await service.search("cache policy minutes");
    assert.equal(conflictSearch.results.some((item) => item.lineage.threadId === conflictWinner.lineage.threadId), false);
    assert.equal(conflictSearch.results.some((item) => item.lineage.threadId === conflictLoser.lineage.threadId), false);
    if (!opened.ok) throw new Error(opened.message);
    const loserState = service.get(conflictLoser.entry.id);
    assert.ok(loserState);
    const resolved = service.resolveConflict({
      threadId: conflictWinner.lineage.threadId,
      expectedVersion: opened.result.governance.threadVersion,
      losingThreadId: conflictLoser.lineage.threadId,
      losingExpectedVersion: loserState.governance.threadVersion,
      actor: "user",
      reason: "Five minutes is the approved cache policy.",
      requestKey: "smoke-resolve-cache-conflict",
    });
    assert.equal(resolved.ok, true);
    const afterResolution = await service.search("cache policy minutes");
    assert.equal(afterResolution.results.some((item) => item.lineage.threadId === conflictWinner.lineage.threadId), true);
    assert.equal(afterResolution.results.some((item) => item.lineage.threadId === conflictLoser.lineage.threadId), false);

    const superseded = service.supersede({
      threadId: obsolete.lineage.threadId,
      expectedVersion: obsolete.governance.threadVersion,
      replacementThreadId: replacement.lineage.threadId,
      replacementExpectedVersion: replacement.governance.threadVersion,
      actor: "user",
      reason: "The thirty-day retention decision replaces the obsolete one.",
      requestKey: "smoke-supersede-retention",
    });
    assert.equal(superseded.ok, true);
    assert.equal((await service.search("retention policy days")).results.some((item) => item.lineage.threadId === obsolete.lineage.threadId), false);

    db.close();
    db = openDb(dbPath);
    service = new MemoryIndexService(db, null);
    const restored = service.get(correctedBase.entry.id);
    assert.match(restored?.entry.summary ?? "", /Tuesday/);
    assert.match(restored?.originalEntry.summary ?? "", /Monday/);
    assert.equal(restored?.governance.events[0]?.actor, "user");
    assert.equal(service.get(conflictLoser.entry.id)?.governance.state, "superseded");
    const history = await service.search("retention policy days", { includeHistory: true });
    assert.equal(history.results.some((item) => item.governance.state === "superseded"), true);
    db.close();

    process.stdout.write(`${JSON.stringify({
      ok: true,
      checks: [
        "immutable correction overlay",
        "request replay idempotency",
        "pin priority",
        "conflict suppression and resolution",
        "explicit supersession with visible history",
        "restart persistence",
      ],
    }, null, 2)}\n`);
  }
}

void main().catch((error) => {
  process.stderr.write(`memory governance smoke failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
