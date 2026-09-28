import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { GENERAL_NOTE_FOLDER_ID, getNote, getNoteFolder, listNoteFolders, type Note } from "../state/notes.js";
import { getCalendarOccurrence, queryCalendar } from "../calendar/service.js";
import { scrubSecrets } from "../security/scrub.js";
import { type InitiativeScope, type InitiativeSource, type InitiativeSourceRef } from "./prompt.js";
import { InitiativeId, type InitiativeSettings } from "./settings.js";
import { DAY } from "./time.js";

export const SourceRefs = z.array(z.discriminatedUnion("type", [
  z.object({ type: z.literal("note"), id: InitiativeId, version: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal("calendar_occurrence"), occurrenceKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}:\d{4}-\d{2}-\d{2}$/), eventVersion: z.number().int().positive(), exceptionVersion: z.number().int().positive().nullable() }).strict(),
])).min(1).max(8);
export function fingerprint(note: Note): string {
  return createHash("sha256").update(JSON.stringify([note.id, note.version, note.title, note.content,
    note.status, note.tags, note.folderId, note.folderPath])).digest("hex");
}
function folderScope(db: Db, folderId: string | null, settings: InitiativeSettings): InitiativeScope | null {
  if (!folderId || folderId === GENERAL_NOTE_FOLDER_ID) return { kind: "general" };
  const folder = getNoteFolder(db, folderId);
  if (!folder) return null;
  const active = [...folder.breadcrumb].reverse().find(part => settings.activeProjectFolderIds.includes(part.id));
  // Recent inactive captures form their exact folder's scope, not a guessed project.
  const root = active ?? folder;
  return { kind: "project", folderId: root.id, name: scrubSecrets(root.name), active: !!active };
}
export function inScope(db: Db, folderId: string | null, scope: InitiativeScope, settings: InitiativeSettings): boolean {
  if (scope.kind === "general") return !folderId || folderId === GENERAL_NOTE_FOLDER_ID;
  if (!folderId) return false;
  const folder = getNoteFolder(db, folderId);
  const path = folder?.breadcrumb.map(part => part.id) ?? [];
  const index = path.indexOf(scope.folderId);
  return index >= 0 && !path.slice(index + 1).some(id => settings.activeProjectFolderIds.includes(id));
}
function noteSource(note: Note): InitiativeSource {
  return { id: note.id, version: note.version, status: note.status, createdAt: note.createdAt, updatedAt: note.updatedAt,
    type: "note", fingerprint: fingerprint(note), title: scrubSecrets(note.title),
    content: scrubSecrets(note.content), tags: note.tags.map(scrubSecrets),
    folderPath: note.folderPath.map(p => ({ ...p, name: scrubSecrets(p.name) })) };
}
export function gatherSources(db: Db, settings: InitiativeSettings, now: number, preferred?: InitiativeScope) {
  const folders = listNoteFolders(db);
  const activeIds = folders.filter(f => f.breadcrumb.some(p => settings.activeProjectFolderIds.includes(p.id))).map(f => f.id);
  const ids = db.prepare(`SELECT id FROM notes WHERE status != 'archived'
    AND (updated_at >= ? ${activeIds.length ? `OR folder_id IN (${activeIds.map(() => "?").join(",")})` : ""})
    ORDER BY updated_at DESC, id LIMIT 200`).all(now - 3 * DAY, ...activeIds) as { id: string }[];
  const notes = ids.map(({ id }) => getNote(db, id)).filter((n): n is Note => !!n && n.status !== "archived");
  const scope = preferred ?? (notes[0] ? folderScope(db, notes[0].folderId, settings) : null)
    ?? (settings.activeProjectFolderIds.map(id => folderScope(db, id, settings)).find(Boolean)) ?? { kind: "general" as const };
  if (scope.kind === "project" && !getNoteFolder(db, scope.folderId)) return null;
  const sources: InitiativeSource[] = notes.filter(n => inScope(db, n.folderId, scope, settings)).slice(0, 4).map(noteSource);
  // A bounded current/near-future calendar window. queryCalendar fails honestly
  // on oversized expansion; we never silently pick an arbitrary partial page.
  const occurrences = queryCalendar(db, now, now + 7 * DAY).occurrences;
  for (const o of occurrences) {
    if (sources.length >= 8) break;
    const exact = getCalendarOccurrence(db, o.occurrenceKey);
    if (!exact || exact.cancelled || !inScope(db, exact.notesFolderId, scope, settings)) continue;
    sources.push({ ...exact, type: "calendar_occurrence", title: scrubSecrets(exact.title),
      description: scrubSecrets(exact.description), location: scrubSecrets(exact.location) });
  }
  return sources.length ? { scope, sources } : null;
}
export function readSource(db: Db, ref: InitiativeSourceRef, scope: InitiativeScope, settings: InitiativeSettings) {
  if (ref.type === "note") {
    const note = getNote(db, ref.id);
    const available = note && note.status !== "archived" && inScope(db, note.folderId, scope, settings);
    return { ...ref, status: !available ? "unavailable" as const : note.version === ref.version && fingerprint(note) === ref.fingerprint ? "current" as const : "changed" as const,
      title: available ? scrubSecrets(note.title) : null };
  }
  const occurrence = getCalendarOccurrence(db, ref.occurrenceKey);
  const available = occurrence && !occurrence.cancelled && inScope(db, occurrence.notesFolderId, scope, settings);
  return { ...ref, status: !available ? "unavailable" as const : occurrence.eventVersion === ref.eventVersion && occurrence.exceptionVersion === ref.exceptionVersion ? "current" as const : "changed" as const,
    title: available ? scrubSecrets(occurrence.title) : null, startsAt: available ? occurrence.startsAt : null, endsAt: available ? occurrence.endsAt : null };
}
