import type { Db } from "./db.js";

const SCOPE = "global";

export type AgentroomPreference = {
  enabled: boolean;
  version: number;
  updatedAt: number;
};

function rowToPreference(row: { enabled: number; version: number; updated_at: number }): AgentroomPreference {
  return {
    enabled: row.enabled === 1,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

export function getAgentroomPreference(db: Db): AgentroomPreference {
  const row = db.prepare(
    "SELECT enabled, version, updated_at FROM agentroom_pref WHERE scope_id = ?",
  ).get(SCOPE) as { enabled: number; version: number; updated_at: number } | undefined;
  if (row) return rowToPreference(row);
  const now = Date.now();
  db.prepare(
    "INSERT INTO agentroom_pref (scope_id, enabled, version, updated_at) VALUES (?, 0, 1, ?)",
  ).run(SCOPE, now);
  return { enabled: false, version: 1, updatedAt: now };
}

export type AgentroomPreferenceMutation =
  | { ok: true; preference: AgentroomPreference }
  | { ok: false; reason: "stale_version"; preference: AgentroomPreference };

export function setAgentroomPreference(
  db: Db,
  enabled: boolean,
  expectedVersion: number,
  now = Date.now(),
): AgentroomPreferenceMutation {
  const current = getAgentroomPreference(db);
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "stale_version", preference: current };
  }
  const result = db.prepare(`
    UPDATE agentroom_pref
       SET enabled = ?, version = version + 1, updated_at = ?
     WHERE scope_id = ? AND version = ?
  `).run(enabled ? 1 : 0, now, SCOPE, expectedVersion);
  if (result.changes !== 1) {
    return { ok: false, reason: "stale_version", preference: getAgentroomPreference(db) };
  }
  return {
    ok: true,
    preference: { enabled, version: expectedVersion + 1, updatedAt: now },
  };
}
