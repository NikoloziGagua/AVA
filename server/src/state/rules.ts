import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export type RuleStatus = "pending" | "active" | "failed";

export type Rule = {
  id: string;
  source: string;
  parsed: string | null;
  enabled: number;
  status: RuleStatus;
  created_at: number;
  updated_at: number;
};

export type CreateRuleArgs = {
  source: string;
  parsed?: string | null;
  status?: RuleStatus;
};

export function createRule(db: Db, args: CreateRuleArgs): Rule {
  const id = nanoid(12);
  const now = Date.now();
  const parsed = args.parsed ?? null;
  const status: RuleStatus = args.status ?? "pending";
  db.prepare(
    "INSERT INTO rules (id, source, parsed, enabled, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, args.source, parsed, 1, status, now, now);
  return { id, source: args.source, parsed, enabled: 1, status, created_at: now, updated_at: now };
}

export function getRule(db: Db, id: string): Rule | null {
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as Rule | undefined;
  return row ?? null;
}

export function listRules(db: Db): Rule[] {
  return db.prepare("SELECT * FROM rules ORDER BY created_at DESC").all() as Rule[];
}

export type UpdateRulePatch = {
  enabled?: boolean;
  status?: RuleStatus;
  parsed?: string | null;
};

export function updateRule(db: Db, id: string, patch: UpdateRulePatch): void {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (patch.enabled !== undefined) { sets.push("enabled = ?"); vals.push(patch.enabled ? 1 : 0); }
  if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
  if (patch.parsed !== undefined) { sets.push("parsed = ?"); vals.push(patch.parsed); }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  vals.push(Date.now());
  vals.push(id);
  db.prepare(`UPDATE rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteRule(db: Db, id: string): void {
  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
}
