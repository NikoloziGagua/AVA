import { z } from "zod";
import type { Db } from "../state/db.js";
import { getNoteFolder } from "../state/notes.js";

export const InitiativeId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const SettingsPatch = z.object({
  enabled: z.boolean().optional(),
  deliveryLocalTime: LocalTime.optional(),
  quietStart: LocalTime.optional(),
  quietEnd: LocalTime.optional(),
  activeProjectFolderIds: z.array(InitiativeId).max(32).optional(),
  version: z.number().int().positive().safe(),
}).strict();
export type InitiativeSettings = {
  enabled: boolean; deliveryLocalTime: string; quietStart: string; quietEnd: string;
  activeProjectFolderIds: string[]; version: number;
};
export const DEFAULT_SETTINGS: InitiativeSettings = {
  enabled: false, deliveryLocalTime: "11:00", quietStart: "22:30", quietEnd: "08:30",
  activeProjectFolderIds: [], version: 1,
};
type Row = { enabled: number; delivery_local_time: string; quiet_start: string; quiet_end: string; active_project_folder_ids: string; version: number };
export function getInitiativeSettings(db: Db): InitiativeSettings {
  const row = db.prepare("SELECT * FROM initiative_settings WHERE id=1").get() as Row | undefined;
  if (!row) return { ...DEFAULT_SETTINGS, activeProjectFolderIds: [] };
  // Invalid disk configuration must not enable unattended generation.
  try {
    const parsed = SettingsPatch.required().parse({ enabled: row.enabled === 1,
      deliveryLocalTime: row.delivery_local_time, quietStart: row.quiet_start, quietEnd: row.quiet_end,
      activeProjectFolderIds: JSON.parse(row.active_project_folder_ids), version: row.version });
    return parsed;
  } catch { throw new Error("initiative_settings_invalid"); }
}
export function updateInitiativeSettings(db: Db, input: unknown): InitiativeSettings | "stale_version" | "bad_request" {
  const parsed = SettingsPatch.safeParse(input);
  if (!parsed.success) return "bad_request";
  return db.transaction(() => {
    const current = getInitiativeSettings(db);
    if (parsed.data.version !== current.version) return "stale_version" as const;
    const ids = parsed.data.activeProjectFolderIds;
    if (ids && (new Set(ids).size !== ids.length || ids.some(id => !getNoteFolder(db, id)))) return "bad_request" as const;
    const next = { ...current, ...parsed.data, version: current.version + 1 };
    db.prepare(`INSERT INTO initiative_settings VALUES (1,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,delivery_local_time=excluded.delivery_local_time,
      quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,
      active_project_folder_ids=excluded.active_project_folder_ids,version=excluded.version`)
      .run(next.enabled ? 1 : 0, next.deliveryLocalTime, next.quietStart, next.quietEnd,
        JSON.stringify(next.activeProjectFolderIds), next.version);
    return next;
  }).immediate();
}
