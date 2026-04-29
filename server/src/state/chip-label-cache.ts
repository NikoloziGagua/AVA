import { createHash } from "node:crypto";
import type { Db } from "./db.js";

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 32);
}

export function getCachedLabel(
  db: Db,
  deviceId: string,
  promptHash: string,
  nowMs: number,
): string | null {
  const row = db
    .prepare(
      "SELECT label, expires_at FROM chip_label_cache WHERE device_id = ? AND prompt_hash = ?",
    )
    .get(deviceId, promptHash) as { label: string; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at <= nowMs) return null;
  return row.label;
}

export function setCachedLabel(
  db: Db,
  deviceId: string,
  promptHash: string,
  label: string,
  expiresAtMs: number,
): void {
  db.prepare(
    `INSERT INTO chip_label_cache (device_id, prompt_hash, label, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id, prompt_hash) DO UPDATE SET
       label      = excluded.label,
       expires_at = excluded.expires_at`,
  ).run(deviceId, promptHash, label, expiresAtMs);
}
