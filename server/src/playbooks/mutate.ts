import { rmSync } from "node:fs";
import { join } from "node:path";
import { listPlaybooks, readPlaybook, writePlaybook, type Playbook } from "./store.js";

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function bumpUse(memoryDir: string, slug: string, today: string): void {
  const pb = readPlaybook(memoryDir, slug);
  if (!pb) return;
  writePlaybook(memoryDir, { ...pb, uses: pb.uses + 1, last_used: today });
}

/**
 * Record how a recalled playbook's run ended. Success = the run reached a
 * final reply (recoveries count — Ava adapting mid-run is the procedure
 * working); fail = the run died in error/kill. Successful runs fold their
 * duration into a rolling average so speed trends are visible per playbook.
 */
export function recordOutcome(
  memoryDir: string, slug: string,
  o: { succeeded: boolean; secs?: number },
): void {
  const pb = readPlaybook(memoryDir, slug);
  if (!pb) return;
  const next = { ...pb };
  if (o.succeeded) {
    next.succ = pb.succ + 1;
    if (o.secs && o.secs > 0) {
      next.avg_secs = pb.avg_secs > 0
        ? Math.round((pb.avg_secs * pb.succ + o.secs) / (pb.succ + 1))
        : Math.round(o.secs);
    }
  } else {
    next.fail = pb.fail + 1;
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
  const avg_secs = base.avg_secs > 0 && fresh.avg_secs > 0
    ? Math.round((base.avg_secs + fresh.avg_secs) / 2)
    : (fresh.avg_secs || base.avg_secs);
  writePlaybook(memoryDir, {
    ...base,
    trigger, keywords, lessons, avg_secs,
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
    else if (p.fail >= 5 && p.succ === 0) drop(p.slug);
  }
  // 2. enforce soft cap, keeping most-used (tie-break newest last_used)
  const all = listPlaybooks(memoryDir);
  if (all.length > opts.softCap) {
    const ranked = [...all].sort((a, b) => b.uses - a.uses || b.last_used.localeCompare(a.last_used));
    for (const p of ranked.slice(opts.softCap)) drop(p.slug);
  }
}
