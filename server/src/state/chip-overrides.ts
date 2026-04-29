import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export type ChipOverride = {
  id: string;
  device_id: string;
  label: string;
  prompt: string;
  pinned: 0 | 1;
  position: number;
  created_at: number;
  updated_at: number;
};

export type ChipDraft = {
  label: string;
  prompt: string;
  pinned?: boolean;
  position?: number;
};

export function listChips(db: Db, deviceId: string): ChipOverride[] {
  return db
    .prepare(
      "SELECT * FROM chip_overrides WHERE device_id = ? ORDER BY position ASC, created_at ASC",
    )
    .all(deviceId) as ChipOverride[];
}

export function getChip(db: Db, id: string): ChipOverride | null {
  const row = db.prepare("SELECT * FROM chip_overrides WHERE id = ?").get(id) as
    | ChipOverride
    | undefined;
  return row ?? null;
}

export function createChip(db: Db, deviceId: string, draft: ChipDraft): ChipOverride {
  const id = nanoid(12);
  const now = Date.now();
  const pinned: 0 | 1 = draft.pinned === false ? 0 : 1;
  const position = draft.position ?? now; // newest pinned floats up; explicit position wins
  db.prepare(
    "INSERT INTO chip_overrides (id, device_id, label, prompt, pinned, position, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, deviceId, draft.label, draft.prompt, pinned, position, now, now);
  return getChip(db, id)!;
}

export type ChipPatch = {
  label?: string;
  prompt?: string;
  pinned?: boolean;
  position?: number;
};

export function updateChip(db: Db, id: string, patch: ChipPatch): ChipOverride | null {
  const cur = getChip(db, id);
  if (!cur) return null;
  const next: ChipOverride = {
    ...cur,
    label: patch.label ?? cur.label,
    prompt: patch.prompt ?? cur.prompt,
    pinned: patch.pinned === undefined ? cur.pinned : patch.pinned ? 1 : 0,
    position: patch.position ?? cur.position,
    updated_at: Date.now(),
  };
  db.prepare(
    "UPDATE chip_overrides SET label = ?, prompt = ?, pinned = ?, position = ?, updated_at = ? WHERE id = ?",
  ).run(next.label, next.prompt, next.pinned, next.position, next.updated_at, id);
  return next;
}

export function deleteChip(db: Db, id: string): boolean {
  const info = db.prepare("DELETE FROM chip_overrides WHERE id = ?").run(id);
  return info.changes > 0;
}
