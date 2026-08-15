import type { Db } from "../state/db.js";

export const SELF_WORKER_PROVIDERS = ["claude", "codex"] as const;
export type SelfWorkerProvider = typeof SELF_WORKER_PROVIDERS[number];

export type SelfWorkerSelection = {
  provider: SelfWorkerProvider;
  version: number;
  updatedAt: number;
};

export class StaleSelfWorkerSelectionError extends Error {
  constructor(readonly current: SelfWorkerSelection) {
    super("self worker selection changed; refresh and retry");
    this.name = "StaleSelfWorkerSelectionError";
  }
}

function isProvider(value: string): value is SelfWorkerProvider {
  return (SELF_WORKER_PROVIDERS as readonly string[]).includes(value);
}

export function getSelfWorkerSelection(db: Db): SelfWorkerSelection {
  db.prepare(`
    INSERT OR IGNORE INTO self_worker_settings (scope_id, provider, version, updated_at)
    VALUES ('global', 'claude', 1, ?)
  `).run(Date.now());
  const row = db.prepare(`
    SELECT provider, version, updated_at FROM self_worker_settings WHERE scope_id = 'global'
  `).get() as { provider: string; version: number; updated_at: number };
  if (!isProvider(row.provider)) {
    throw new Error(`invalid persisted self worker provider: ${row.provider}`);
  }
  return { provider: row.provider, version: row.version, updatedAt: row.updated_at };
}

export function setSelfWorkerSelection(
  db: Db,
  provider: SelfWorkerProvider,
  expectedVersion: number,
): SelfWorkerSelection {
  return db.transaction(() => {
    const current = getSelfWorkerSelection(db);
    if (current.version !== expectedVersion) throw new StaleSelfWorkerSelectionError(current);
    const updatedAt = Date.now();
    const result = db.prepare(`
      UPDATE self_worker_settings
      SET provider = ?, version = version + 1, updated_at = ?
      WHERE scope_id = 'global' AND version = ?
    `).run(provider, updatedAt, expectedVersion);
    if (result.changes !== 1) throw new StaleSelfWorkerSelectionError(getSelfWorkerSelection(db));
    return { provider, version: expectedVersion + 1, updatedAt };
  })();
}
