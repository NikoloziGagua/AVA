import { nanoid } from "nanoid";
import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";

// The mistakes ledger — Ava's record of real friction the owner hit (it
// corrected Ava, a tool failed, or the owner flagged it). This is what Ava
// brings to Claude on self-improve: grounded evidence, not invented ideas.
// Stored secret-scrubbed (writeFile scrubs) since entries quote real messages.

export type Surface = "voice" | "chat" | "tool" | "memory" | "other";

export type Mistake = {
  id: string;
  created: string;
  last_seen: string;
  count: number;
  surface: Surface;
  summary: string;   // short; used to dedup recurrences
  detail: string;    // evidence: what owner asked, what Ava did, what was wrong
  severity: number;  // 1..3 — owner can raise "fix this first"
  status: "open" | "resolved";
  reopened?: boolean;        // true if it recurred after being marked resolved
  resolved_commit?: string;
  resolved_at?: string;
};

const file = (memoryDir: string) => join(memoryDir, "friction.json");

function load(memoryDir: string): Mistake[] {
  const c = readFile(file(memoryDir));
  if (!c) return [];
  try { const j = JSON.parse(c); return Array.isArray(j) ? (j as Mistake[]) : []; } catch { return []; }
}
function save(memoryDir: string, list: Mistake[]): void {
  writeFile(file(memoryDir), JSON.stringify(list, null, 2));
}
function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

/** Record a mistake. Recurrences dedup (bump count + recency); a recurrence of
 *  an already-resolved mistake REOPENS it (the fix didn't actually hold). */
export function recordMistake(memoryDir: string, o: {
  surface: Surface; summary: string; detail: string; severity?: number; today?: string;
}): Mistake {
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const list = load(memoryDir);
  const existing = list.find((x) => norm(x.summary) === norm(o.summary));
  if (existing) {
    existing.count += 1;
    existing.last_seen = today;
    existing.detail = o.detail; // keep the freshest evidence
    if (o.severity !== undefined) existing.severity = Math.max(existing.severity, o.severity);
    if (existing.status === "resolved") { existing.status = "open"; existing.reopened = true; }
    save(memoryDir, list);
    return existing;
  }
  const mistake: Mistake = {
    id: nanoid(10), created: today, last_seen: today, count: 1,
    surface: o.surface, summary: o.summary, detail: o.detail,
    severity: o.severity ?? 1, status: "open",
  };
  list.push(mistake);
  save(memoryDir, list);
  return mistake;
}

/** Open mistakes, worst first: severity, then how often, then how recent. */
export function listOpenMistakes(memoryDir: string): Mistake[] {
  return load(memoryDir)
    .filter((x) => x.status === "open")
    .sort((a, b) => (b.severity - a.severity) || (b.count - a.count) || b.last_seen.localeCompare(a.last_seen));
}

/** Format a mistake as a goal + evidence for Claude. A reopened mistake tells
 *  Claude the prior fix didn't hold, so it digs deeper. */
export function mistakeToGoal(m: Mistake): string {
  const recur = m.reopened
    ? " IMPORTANT: this RECURRED after a previous fix — the earlier attempt did not hold, so find and fix the real root cause this time."
    : "";
  return (
    `Fix a real problem the owner hit with Ava (surface: ${m.surface}).${recur}\n` +
    `Problem: ${m.summary}\n` +
    `Evidence: ${m.detail}\n` +
    `Fix the root cause with a minimal change, and keep all existing tests passing.`
  );
}

/** Mark a mistake fixed by a given commit. Recurrence later will reopen it. */
export function resolveMistake(memoryDir: string, id: string, commit: string, today?: string): void {
  const list = load(memoryDir);
  const m = list.find((x) => x.id === id);
  if (!m) return;
  m.status = "resolved";
  m.resolved_commit = commit;
  m.resolved_at = today ?? new Date().toISOString().slice(0, 10);
  save(memoryDir, list);
}
