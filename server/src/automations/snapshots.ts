import type { Db } from "../state/db.js";
import type { AutomationOperationsSnapshot, AutomationSystemSnapshot } from "./types.js";

type NumberRow = Record<string, number | bigint | null>;

function count(value: number | bigint | null | undefined): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

/**
 * Build the non-secret operational input for the pinned operations brief.
 * Only aggregate counts cross the executor boundary: no prompts, titles, note
 * bodies, memory text, tool arguments, provider payloads or error strings.
 */
export function buildOperationsBriefSnapshot(
  db: Db,
  readiness: AutomationSystemSnapshot,
  now = Date.now(),
): AutomationOperationsSnapshot {
  const since = now - 24 * 60 * 60 * 1_000;
  const runs = db.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status NOT IN ('completed','failed','cancelled','timed_out','orphaned') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('failed','orphaned') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status='timed_out' THEN 1 ELSE 0 END) AS timed_out,
      SUM(CASE WHEN verification_status='verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status IN ('completed','failed','cancelled','timed_out','orphaned')
        AND verification_status!='verified' THEN 1 ELSE 0 END) AS not_verified
    FROM observability_runs WHERE started_at >= ?`).get(since) as NumberRow;
  const approvals = db.prepare("SELECT COUNT(*) AS total FROM approvals WHERE status='pending'").get() as NumberRow;
  const self = db.prepare(`SELECT
      SUM(CASE WHEN status NOT IN ('blocked','swapped','failed','rolled_back','rejected','cancelled') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN outcome='shipped' OR status='swapped' THEN 1 ELSE 0 END) AS shipped
    FROM self_improvements`).get() as NumberRow;
  const watches = db.prepare(`SELECT
      SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) AS enabled,
      SUM(CASE WHEN successor_status='blocked' THEN 1 ELSE 0 END) AS successor_blocked
    FROM watches`).get() as NumberRow;
  const notes = db.prepare(`SELECT
      SUM(CASE WHEN pinned=1 THEN 1 ELSE 0 END) AS pinned,
      SUM(CASE WHEN status='doing' THEN 1 ELSE 0 END) AS doing,
      SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) AS review
    FROM notes`).get() as NumberRow;
  const memory = db.prepare(`SELECT
      SUM(CASE WHEN e.status='active' THEN 1 ELSE 0 END) AS active,
      COUNT(DISTINCT CASE WHEN e.status='active' AND s.availability='verified' THEN e.id END) AS verified
    FROM memory_index_entries e
    LEFT JOIN memory_index_sources s ON s.entry_id=e.id`).get() as NumberRow;

  return {
    generatedAt: now,
    generatedAtIso: new Date(now).toISOString(),
    windowHours: 24,
    readiness: {
      ready: readiness.ready,
      provider: readiness.provider,
      brainReady: readiness.core.brainReady,
      voiceReady: readiness.core.voiceReady,
      browserReady: readiness.core.browserReady,
      memoryReady: readiness.core.memoryReady,
    },
    recentRuns: {
      total: count(runs.total),
      active: count(runs.active),
      completed: count(runs.completed),
      failed: count(runs.failed),
      cancelled: count(runs.cancelled),
      timedOut: count(runs.timed_out),
      verified: count(runs.verified),
      notVerified: count(runs.not_verified),
    },
    attention: {
      pendingApprovals: count(approvals.total),
      blockedSelfImprovements: count(self.blocked),
      blockedWatcherSuccessors: count(watches.successor_blocked),
    },
    work: {
      pinnedNotes: count(notes.pinned),
      notesDoing: count(notes.doing),
      notesInReview: count(notes.review),
      activeSelfImprovements: count(self.active),
      shippedSelfImprovements: count(self.shipped),
      enabledWatches: count(watches.enabled),
    },
    knowledge: {
      activeMemoryEntries: count(memory.active),
      verifiedMemorySources: count(memory.verified),
    },
  };
}
