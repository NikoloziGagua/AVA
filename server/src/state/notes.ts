import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export const NOTE_KINDS = ["idea", "task", "decision", "reference", "meeting", "thought", "general"] as const;
export const NOTE_STATUSES = ["inbox", "active", "done", "archived"] as const;
export type NoteKind = typeof NOTE_KINDS[number];
export type NoteStatus = typeof NOTE_STATUSES[number];
export type NoteSource = "manual" | "ava_chat" | "ava_voice";

type NoteDbRow = {
  id: string;
  title: string;
  content: string;
  kind: NoteKind;
  status: NoteStatus;
  collection: string | null;
  tags: string;
  pinned: 0 | 1;
  source: NoteSource;
  source_session_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  kind: NoteKind;
  status: NoteStatus;
  collection: string | null;
  tags: string[];
  pinned: boolean;
  source: NoteSource;
  sourceSessionId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type CreateNoteInput = {
  title?: string | null;
  content: string;
  kind?: NoteKind;
  status?: NoteStatus;
  collection?: string | null;
  tags?: string[];
  pinned?: boolean;
  source?: NoteSource;
  sourceSessionId?: string | null;
};

export type UpdateNotePatch = Partial<Pick<
  CreateNoteInput,
  "title" | "content" | "kind" | "status" | "collection" | "tags" | "pinned"
>>;

export type NoteMutationResult =
  | { ok: true; note: Note }
  | { ok: false; reason: "not_found" | "version_conflict"; note: Note | null };

export type NoteListFilter = {
  q?: string;
  kind?: NoteKind;
  status?: NoteStatus;
  collection?: string;
  pinned?: boolean;
  includeArchived?: boolean;
  limit?: number;
};

export function inferNoteTitle(content: string): string {
  const first = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .trim() ?? "";
  if (!first) return "Untitled note";
  return first.length <= 72 ? first : `${first.slice(0, 69).trimEnd()}...`;
}

export function normalizeNoteTags(tags: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 40);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === 12) break;
  }
  return out;
}

function cleanCollection(value: string | null | undefined): string | null {
  const clean = value?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "";
  return clean || null;
}

function rowToNote(row: NoteDbRow): Note {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags) as unknown;
    if (Array.isArray(parsed)) tags = normalizeNoteTags(parsed.filter((tag): tag is string => typeof tag === "string"));
  } catch { /* A damaged tag field must not make the whole Notes workspace unreadable. */ }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    kind: row.kind,
    status: row.status,
    collection: row.collection,
    tags,
    pinned: row.pinned === 1,
    source: row.source,
    sourceSessionId: row.source_session_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createNote(db: Db, input: CreateNoteInput): Note {
  const content = input.content.trim();
  const title = input.title?.trim().slice(0, 160) || inferNoteTitle(content);
  const id = `note_${nanoid(12)}`;
  const now = Date.now();
  const row: NoteDbRow = {
    id,
    title,
    content,
    kind: input.kind ?? "general",
    status: input.status ?? "inbox",
    collection: cleanCollection(input.collection),
    tags: JSON.stringify(normalizeNoteTags(input.tags)),
    pinned: input.pinned ? 1 : 0,
    source: input.source ?? "manual",
    source_session_id: input.sourceSessionId ?? null,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO notes (
      id, title, content, kind, status, collection, tags, pinned, source,
      source_session_id, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.title, row.content, row.kind, row.status, row.collection,
    row.tags, row.pinned, row.source, row.source_session_id, row.version,
    row.created_at, row.updated_at,
  );
  return rowToNote(row);
}

export function getNote(db: Db, id: string): Note | null {
  const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteDbRow | undefined;
  return row ? rowToNote(row) : null;
}

export function listNotes(db: Db, filter: NoteListFilter = {}): Note[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (!filter.includeArchived && filter.status === undefined) clauses.push("status != 'archived'");
  if (filter.kind) { clauses.push("kind = ?"); values.push(filter.kind); }
  if (filter.status) { clauses.push("status = ?"); values.push(filter.status); }
  if (filter.collection) { clauses.push("collection = ? COLLATE NOCASE"); values.push(filter.collection); }
  if (filter.pinned !== undefined) { clauses.push("pinned = ?"); values.push(filter.pinned ? 1 : 0); }
  if (filter.q?.trim()) {
    const q = `%${filter.q.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    clauses.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR collection LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')");
    values.push(q, q, q, q);
  }
  const limit = Math.max(1, Math.min(500, Math.floor(filter.limit ?? 250)));
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT * FROM notes${where} ORDER BY pinned DESC, updated_at DESC, created_at DESC LIMIT ?`,
  ).all(...values, limit) as NoteDbRow[];
  return rows.map(rowToNote);
}

export function updateNote(
  db: Db,
  id: string,
  expectedVersion: number,
  patch: UpdateNotePatch,
): NoteMutationResult {
  const current = getNote(db, id);
  if (!current) return { ok: false, reason: "not_found", note: null };
  if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict", note: current };

  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.title !== undefined) {
    const title = patch.title?.trim().slice(0, 160) || inferNoteTitle(patch.content ?? current.content);
    sets.push("title = ?"); values.push(title);
  }
  if (patch.content !== undefined) { sets.push("content = ?"); values.push(patch.content.trim()); }
  if (patch.kind !== undefined) { sets.push("kind = ?"); values.push(patch.kind); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.collection !== undefined) { sets.push("collection = ?"); values.push(cleanCollection(patch.collection)); }
  if (patch.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(normalizeNoteTags(patch.tags))); }
  if (patch.pinned !== undefined) { sets.push("pinned = ?"); values.push(patch.pinned ? 1 : 0); }
  if (sets.length === 0) return { ok: true, note: current };

  sets.push("updated_at = ?", "version = version + 1");
  values.push(Date.now(), id, expectedVersion);
  const result = db.prepare(
    `UPDATE notes SET ${sets.join(", ")} WHERE id = ? AND version = ?`,
  ).run(...values);
  if (result.changes !== 1) {
    const latest = getNote(db, id);
    return latest
      ? { ok: false, reason: "version_conflict", note: latest }
      : { ok: false, reason: "not_found", note: null };
  }
  return { ok: true, note: getNote(db, id)! };
}

export function deleteNote(db: Db, id: string, expectedVersion: number): NoteMutationResult {
  const current = getNote(db, id);
  if (!current) return { ok: false, reason: "not_found", note: null };
  if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict", note: current };
  const result = db.prepare("DELETE FROM notes WHERE id = ? AND version = ?").run(id, expectedVersion);
  if (result.changes !== 1) {
    const latest = getNote(db, id);
    return latest
      ? { ok: false, reason: "version_conflict", note: latest }
      : { ok: false, reason: "not_found", note: null };
  }
  return { ok: true, note: current };
}
