import { rmSync } from "node:fs";
import { join } from "node:path";
import { listPlaybooks, readPlaybook, writePlaybook } from "./store.js";

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function bumpUse(memoryDir: string, slug: string, today: string): void {
  const pb = readPlaybook(memoryDir, slug);
  if (!pb) return;
  writePlaybook(memoryDir, { ...pb, uses: pb.uses + 1, last_used: today });
}

export function prunePlaybooks(
  memoryDir: string,
  opts: { today: string; maxAgeDays: number; softCap: number },
): void {
  const drop = (slug: string) => rmSync(join(memoryDir, "playbooks", `${slug}.md`), { force: true });
  // 1. drop stale one-offs (uses <= 1 AND older than maxAgeDays)
  for (const p of listPlaybooks(memoryDir)) {
    if (p.uses <= 1 && daysBetween(p.last_used || p.created, opts.today) > opts.maxAgeDays) drop(p.slug);
  }
  // 2. enforce soft cap, keeping most-used (tie-break newest last_used)
  const all = listPlaybooks(memoryDir);
  if (all.length > opts.softCap) {
    const ranked = [...all].sort((a, b) => b.uses - a.uses || b.last_used.localeCompare(a.last_used));
    for (const p of ranked.slice(opts.softCap)) drop(p.slug);
  }
}
