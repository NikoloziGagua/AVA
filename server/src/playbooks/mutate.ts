import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_PLAYBOOK_LEARNING,
  listPlaybooks,
  readPlaybook,
  writePlaybook,
  type Playbook,
} from "./store.js";
import type { PlaybookLearningEvidence, PlaybookLearningOutcome } from "./learning.js";

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function bumpUse(memoryDir: string, slug: string, today: string): void {
  const pb = readPlaybook(memoryDir, slug);
  if (!pb) return;
  writePlaybook(memoryDir, { ...pb, uses: pb.uses + 1, last_used: today });
}

/**
 * Record the terminal evidence outcome for a recalled playbook. Legacy
 * succ/fail counters are frozen. Only verified outcomes update the duration
 * trend; stable task IDs make replay idempotent.
 */
export function recordOutcome(
  memoryDir: string, slug: string,
  o: { outcome: PlaybookLearningOutcome; secs?: number; evidence: PlaybookLearningEvidence },
): void {
  const pb = readPlaybook(memoryDir, slug);
  if (!pb) return;
  const learning = { ...EMPTY_PLAYBOOK_LEARNING, ...pb.learning };
  if (learning.recent_task_ids.includes(o.evidence.taskId)) return;
  learning[o.outcome] += 1;
  learning.last_task_id = o.evidence.taskId;
  learning.last_method = o.evidence.method ?? "";
  learning.last_evidence_at = o.evidence.observedAt;
  learning.recent_task_ids = [...learning.recent_task_ids, o.evidence.taskId].slice(-32);
  const next = { ...pb, learning };
  if (o.outcome === "verified") {
    if (o.secs && o.secs > 0) {
      const priorVerified = Math.max(0, learning.verified - 1);
      next.avg_secs = pb.avg_secs > 0
        ? Math.round((pb.avg_secs * priorVerified + o.secs) / (priorVerified + 1))
        : Math.round(o.secs);
    }
  }
  writePlaybook(memoryDir, next);
}

/**
 * Merge a freshly-distilled playbook into an existing one covering the same
 * task class. Identity (slug, created) and track record (uses/succ/fail) are
 * the existing playbook's; the PROCEDURE (steps) is the fresh distillation —
 * newest knowledge wins — and lessons/keywords accumulate. version bumps so
 * the evolution is visible. The shorter trigger wins: canonicalization
 * pressure toward broad, matchable task classes.
 */
export function mergePlaybook(
  memoryDir: string, existingSlug: string, fresh: Playbook, today: string,
): void {
  const base = readPlaybook(memoryDir, existingSlug);
  if (!base) { writePlaybook(memoryDir, fresh); return; }
  const keywords = [...new Set([...base.keywords, ...fresh.keywords])].slice(0, 10);
  const lessons = [...new Set([...base.lessons, ...fresh.lessons])].slice(0, 8);
  const trigger = fresh.trigger.length < base.trigger.length ? fresh.trigger : base.trigger;
  const baseLearning = { ...EMPTY_PLAYBOOK_LEARNING, ...base.learning };
  const freshLearning = { ...EMPTY_PLAYBOOK_LEARNING, ...fresh.learning };
  const addsFreshEvidence = freshLearning.recent_task_ids.some(
    (taskId) => !baseLearning.recent_task_ids.includes(taskId),
  );
  const freshFactor = addsFreshEvidence ? 1 : 0;
  const totalVerified = baseLearning.verified + freshLearning.verified * freshFactor;
  const avg_secs = totalVerified > 0
    ? Math.round(
        ((base.avg_secs * baseLearning.verified) +
          (fresh.avg_secs * freshLearning.verified * freshFactor)) /
        totalVerified,
      )
    : (fresh.avg_secs || base.avg_secs);
  writePlaybook(memoryDir, {
    ...base,
    trigger, keywords, lessons, avg_secs,
    learning: {
      verified: totalVerified,
      partially_verified: baseLearning.partially_verified + freshLearning.partially_verified * freshFactor,
      unverified: baseLearning.unverified + freshLearning.unverified * freshFactor,
      contradicted: baseLearning.contradicted + freshLearning.contradicted * freshFactor,
      failed: baseLearning.failed + freshLearning.failed * freshFactor,
      not_applicable: baseLearning.not_applicable + freshLearning.not_applicable * freshFactor,
      last_task_id: freshLearning.last_task_id || baseLearning.last_task_id,
      last_method: freshLearning.last_method || baseLearning.last_method,
      last_evidence_at: Math.max(baseLearning.last_evidence_at, freshLearning.last_evidence_at),
      recent_task_ids: [...new Set([
        ...baseLearning.recent_task_ids,
        ...freshLearning.recent_task_ids,
      ])].slice(-32),
    },
    steps: fresh.steps,
    stakes: base.stakes === "consequential" || fresh.stakes === "consequential"
      ? "consequential" : "routine",
    version: base.version + 1,
    last_used: today,
  });
}

export function prunePlaybooks(
  memoryDir: string,
  opts: { today: string; maxAgeDays: number; softCap: number },
): void {
  const drop = (slug: string) => rmSync(join(memoryDir, "playbooks", `${slug}.md`), { force: true });
  // 1. drop stale one-offs (uses <= 1 AND older than maxAgeDays), and proven
  //    losers (recalled 5+ times, never once carried a run to success).
  for (const p of listPlaybooks(memoryDir)) {
    if (p.uses <= 1 && daysBetween(p.last_used || p.created, opts.today) > opts.maxAgeDays) drop(p.slug);
    else if (((p.learning?.contradicted ?? 0) >= 3) ||
      ((p.learning?.failed ?? 0) >= 5 && (p.learning?.verified ?? 0) === 0) ||
      ((p.learning?.verified ?? 0) + (p.learning?.partially_verified ?? 0) + (p.learning?.unverified ?? 0) +
        (p.learning?.contradicted ?? 0) + (p.learning?.failed ?? 0) + (p.learning?.not_applicable ?? 0) === 0 &&
        p.fail >= 5 && p.succ === 0)) drop(p.slug);
  }
  // 2. enforce soft cap, keeping most-used (tie-break newest last_used)
  const all = listPlaybooks(memoryDir);
  if (all.length > opts.softCap) {
    const ranked = [...all].sort((a, b) => b.uses - a.uses || b.last_used.localeCompare(a.last_used));
    for (const p of ranked.slice(opts.softCap)) drop(p.slug);
  }
}
