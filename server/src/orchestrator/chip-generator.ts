import type { Db } from "../state/db.js";
import { listChips, type ChipOverride } from "../state/chip-overrides.js";
import { loadProjectIndex, detectProject } from "../memory/project-index.js";
import { getCachedLabel, hashPrompt } from "../state/chip-label-cache.js";

export type SuggestedChip = {
  /** Stable id; derived for auto chips, real for pinned ones. */
  id: string;
  source: "pinned" | "auto";
  label: string;
  prompt: string;
};

const MAX_CHIPS = 5;

export type GenerateChipsOpts = {
  db: Db;
  deviceId: string;
  memoryDir: string;
  /** Now ms; injectable for tests. Defaults to Date.now(). */
  now?: number;
};

/**
 * Build the merged chip list shown below the composer:
 *   1) all pinned chips (max 5)
 *   2) "Resume yesterday" — when a prior-day session exists
 *   3) "Open <slug>" — most recent project mentioned in the last 7 days
 *   4) top recurring user-message starts from the last 7 days
 *
 * Total capped at 5. Pinned always win; auto fills the rest.
 */
export function generateChips(opts: GenerateChipsOpts): SuggestedChip[] {
  const now = opts.now ?? Date.now();
  const pinned = listChips(opts.db, opts.deviceId)
    .filter((c) => c.pinned === 1)
    .slice(0, MAX_CHIPS)
    .map((c) => pinnedToChip(c));

  if (pinned.length >= MAX_CHIPS) return pinned;

  const auto: SuggestedChip[] = [];
  const seenLabels = new Set(pinned.map((c) => c.label.toLowerCase()));

  const yesterday = mostRecentSessionInRange(opts.db, now - 36 * 3600_000, now - 12 * 3600_000);
  if (yesterday) {
    push(auto, seenLabels, {
      id: "auto:resume-yesterday",
      source: "auto",
      label: "Resume yesterday",
      prompt: "What did we leave off on yesterday?",
    });
  }

  const recentMessages = recentUserMessages(opts.db, now - 7 * 24 * 3600_000);
  const projectIndex = loadProjectIndex(opts.memoryDir);
  if (projectIndex.length > 0) {
    for (const m of recentMessages) {
      const p = detectProject(m, projectIndex);
      if (p) {
        push(auto, seenLabels, {
          id: `auto:open-${p.slug}`,
          source: "auto",
          label: `Open ${p.slug}`,
          prompt: `Open the ${p.slug} project and summarize where we left off.`,
        });
        break;
      }
    }
  }

  for (const phrase of topRecurringStarts(recentMessages)) {
    if (auto.length + pinned.length >= MAX_CHIPS) break;
    push(auto, seenLabels, {
      id: `auto:phrase-${slugify(phrase)}`,
      source: "auto",
      label: capitalize(phrase),
      prompt: phrase,
    });
  }

  const merged = [...pinned, ...auto].slice(0, MAX_CHIPS);
  return merged.map((c) => {
    if (c.source !== "auto") return c;
    const cached = getCachedLabel(opts.db, opts.deviceId, hashPrompt(c.prompt), now);
    return cached ? { ...c, label: cached } : c;
  });
}

function pinnedToChip(c: ChipOverride): SuggestedChip {
  return { id: c.id, source: "pinned", label: c.label, prompt: c.prompt };
}

function push(out: SuggestedChip[], seen: Set<string>, c: SuggestedChip): void {
  const k = c.label.toLowerCase();
  if (seen.has(k)) return;
  if (out.length >= MAX_CHIPS) return;
  out.push(c);
  seen.add(k);
}

function mostRecentSessionInRange(db: Db, fromMs: number, toMs: number): boolean {
  const row = db
    .prepare("SELECT id FROM messages WHERE created_at >= ? AND created_at <= ? LIMIT 1")
    .get(fromMs, toMs) as { id: number } | undefined;
  return !!row;
}

function recentUserMessages(db: Db, sinceMs: number): string[] {
  const rows = db
    .prepare(
      "SELECT content FROM messages WHERE role = 'user' AND created_at >= ? ORDER BY created_at DESC LIMIT 200",
    )
    .all(sinceMs) as Array<{ content: string }>;
  return rows.map((r) => r.content);
}

function topRecurringStarts(messages: string[]): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const key = m.replace(/\s+/g, " ").trim().slice(0, 40);
    if (key.length < 6) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
