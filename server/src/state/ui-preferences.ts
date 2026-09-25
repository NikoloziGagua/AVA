import type { Db } from "./db.js";

const SCOPE = "global";

export type UiLook = "ink" | "paper" | "system";
export type UiMotion = "full" | "reduced" | "system";

export type UiPreferences = {
  look: UiLook;
  motion: UiMotion;
  faceEnabled: boolean;
  version: number;
  updatedAt: number;
};

export type UiPreferencesPatch = Partial<Pick<UiPreferences, "look" | "motion" | "faceEnabled">>;

type UiPreferencesRow = {
  look: UiLook;
  motion: UiMotion;
  face_enabled: number;
  version: number;
  updated_at: number;
};

function fromRow(row: UiPreferencesRow): UiPreferences {
  return {
    look: row.look,
    motion: row.motion,
    faceEnabled: row.face_enabled === 1,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function getUiPreferences(db: Db): UiPreferences {
  const row = db.prepare(`
    SELECT look, motion, face_enabled, version, updated_at
    FROM ui_preferences
    WHERE scope_id = ?
  `).get(SCOPE) as UiPreferencesRow | undefined;
  if (!row) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO ui_preferences (
        scope_id, look, motion, face_enabled, version, updated_at
      ) VALUES (?, 'ink', 'full', 1, 1, ?)
    `).run(SCOPE, now);
    return { look: "ink", motion: "full", faceEnabled: true, version: 1, updatedAt: now };
  }
  return fromRow(row);
}

export type UiPreferencesMutation =
  | { ok: true; preferences: UiPreferences }
  | { ok: false; reason: "stale_version"; preferences: UiPreferences };

export function updateUiPreferences(
  db: Db,
  expectedVersion: number,
  patch: UiPreferencesPatch,
  now = Date.now(),
): UiPreferencesMutation {
  const current = getUiPreferences(db);
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "stale_version", preferences: current };
  }
  const next: UiPreferences = {
    look: patch.look ?? current.look,
    motion: patch.motion ?? current.motion,
    faceEnabled: patch.faceEnabled ?? current.faceEnabled,
    version: current.version + 1,
    updatedAt: now,
  };
  const result = db.prepare(`
    UPDATE ui_preferences
    SET look = ?, motion = ?, face_enabled = ?, version = version + 1, updated_at = ?
    WHERE scope_id = ? AND version = ?
  `).run(next.look, next.motion, next.faceEnabled ? 1 : 0, now, SCOPE, expectedVersion);
  if (result.changes !== 1) {
    return { ok: false, reason: "stale_version", preferences: getUiPreferences(db) };
  }
  return { ok: true, preferences: next };
}
