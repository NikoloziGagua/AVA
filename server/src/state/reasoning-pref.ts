import type { Db } from "./db.js";

export type ReasoningLevel = "fast" | "thorough";

const SCOPE = "global";

export function getReasoningLevel(db: Db): ReasoningLevel {
  const row = db
    .prepare("SELECT level FROM reasoning_pref WHERE scope_id = ?")
    .get(SCOPE) as { level: string } | undefined;
  if (row && (row.level === "fast" || row.level === "thorough")) return row.level;
  return "fast";
}

export function setReasoningLevel(db: Db, level: ReasoningLevel): void {
  db.prepare(
    `INSERT INTO reasoning_pref (scope_id, level, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(scope_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
  ).run(SCOPE, level, Date.now());
}
