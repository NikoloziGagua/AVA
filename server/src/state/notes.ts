import { nanoid } from "nanoid";
import { scrubSecrets } from "../security/scrub.js";
import type { Db } from "./db.js";

export const NOTE_KINDS = [
  "idea", "requirement", "task", "decision", "documentation",
  "reference", "meeting", "thought", "general",
] as const;
export const NOTE_STATUSES = ["ideas", "doing", "review", "done", "archived"] as const;
export const NOTE_SECTIONS = ["capture", "priorities", "decisions", "documentation"] as const;
export const NOTE_PROMOTION_TYPES = ["task", "self_improvement"] as const;

export type NoteKind = typeof NOTE_KINDS[number];
export type NoteStatus = typeof NOTE_STATUSES[number];
export type NoteSection = typeof NOTE_SECTIONS[number];
export type NotePromotionType = typeof NOTE_PROMOTION_TYPES[number];
export type NoteSource = "manual" | "ava_chat" | "ava_voice";

export type NoteLink = { label: string; url: string };
export type NoteChange = {
  id: string;
  at: number;
  action: "created" | "updated" | "moved" | "promoted";
  detail: string;
};

type NoteDbRow = {
  id: string;
  title: string;
  content: string;
  kind: string;
  status: string;
  collection: string | null;
  tags: string;
  pinned: 0 | 1;
  source: NoteSource;
  source_session_id: string | null;
  project_id: string | null;
  section: string;
  links: string;
  change_log: string;
  promoted_type: string | null;
  promoted_id: string | null;
  promoted_at: number | null;
  version: number;
  created_at: number;
  updated_at: number;
};

type ProjectDbRow = {
  id: string;
  name: string;
  description: string;
  version: number;
  created_at: number;
  updated_at: number;
  note_count?: number;
};

export type NoteProject = {
  id: string;
  name: string;
  description: string;
  version: number;
  noteCount: number;
  createdAt: number;
  updatedAt: number;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  kind: NoteKind;
  status: NoteStatus;
  collection: string | null;
  projectId: string | null;
  section: NoteSection;
  tags: string[];
  links: NoteLink[];
  changeLog: NoteChange[];
  pinned: boolean;
  source: NoteSource;
  sourceSessionId: string | null;
  promotion: {
    type: NotePromotionType;
    id: string;
    at: number;
  } | null;
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
  projectId?: string | null;
  section?: NoteSection;
  tags?: string[];
  links?: NoteLink[];
  pinned?: boolean;
  source?: NoteSource;
  sourceSessionId?: string | null;
};

export type UpdateNotePatch = Partial<Pick<
  CreateNoteInput,
  "title" | "content" | "kind" | "status" | "collection" | "projectId" |
  "section" | "tags" | "links" | "pinned"
>>;

export type NoteMutationResult =
  | { ok: true; note: Note }
  | { ok: false; reason: "not_found" | "version_conflict"; note: Note | null };

export type NoteListFilter = {
  q?: string;
  kind?: NoteKind;
  status?: NoteStatus;
  projectId?: string | null;
  collection?: string;
  section?: NoteSection;
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
    const tag = scrubSecrets(raw).trim().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 40);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === 12) break;
  }
  return out;
}

export function normalizeNoteLinks(links: readonly NoteLink[] | undefined): NoteLink[] {
  const seen = new Set<string>();
  const out: NoteLink[] = [];
  for (const candidate of links ?? []) {
    const raw = candidate?.url?.trim().slice(0, 2_048) ?? "";
    if (!raw) continue;
    // A URL containing a credential pattern is safer omitted than persisted in
    // partially redacted form: redaction can change URL semantics or leave a
    // reusable token in a path/query field the browser would later transmit.
    if (scrubSecrets(raw) !== raw) continue;
    let parsed: URL;
    try { parsed = new URL(raw); } catch { continue; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const label = scrubSecrets(candidate.label ?? "").trim().replace(/\s+/g, " ").slice(0, 80)
      || parsed.hostname.replace(/^www\./, "");
    out.push({ label, url });
    if (out.length === 12) break;
  }
  return out;
}

function cleanProjectName(value: string | null | undefined): string | null {
  const clean = scrubSecrets(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  return clean || null;
}

function isGeneralSpace(value: string | null | undefined): boolean {
  return /^general$/i.test(value?.trim() ?? "");
}

function parseJsonArray<T>(value: string, guard: (entry: unknown) => entry is T): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch { return []; }
}

function isLink(value: unknown): value is NoteLink {
  return !!value && typeof value === "object"
    && typeof (value as NoteLink).label === "string"
    && typeof (value as NoteLink).url === "string";
}

function isChange(value: unknown): value is NoteChange {
  return !!value && typeof value === "object"
    && typeof (value as NoteChange).id === "string"
    && typeof (value as NoteChange).at === "number"
    && typeof (value as NoteChange).action === "string"
    && typeof (value as NoteChange).detail === "string";
}

function normalizeKind(value: string): NoteKind {
  return (NOTE_KINDS as readonly string[]).includes(value) ? value as NoteKind : "general";
}

function normalizeStatus(value: string): NoteStatus {
  if (value === "inbox") return "ideas";
  if (value === "active") return "doing";
  return (NOTE_STATUSES as readonly string[]).includes(value) ? value as NoteStatus : "ideas";
}

function normalizeSection(value: string, kind: NoteKind, pinned: boolean): NoteSection {
  if ((NOTE_SECTIONS as readonly string[]).includes(value)) return value as NoteSection;
  if (pinned) return "priorities";
  if (kind === "decision") return "decisions";
  if (kind === "documentation" || kind === "reference") return "documentation";
  return "capture";
}

function change(action: NoteChange["action"], detail: string, at = Date.now()): NoteChange {
  return { id: `change_${nanoid(10)}`, at, action, detail: detail.slice(0, 240) };
}

function rowToProject(row: ProjectDbRow): NoteProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    noteCount: row.note_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToNote(row: NoteDbRow): Note {
  const kind = normalizeKind(row.kind);
  const pinned = row.pinned === 1;
  const promotedType = (NOTE_PROMOTION_TYPES as readonly string[]).includes(row.promoted_type ?? "")
    ? row.promoted_type as NotePromotionType
    : null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    kind,
    status: normalizeStatus(row.status),
    collection: row.collection,
    projectId: row.project_id,
    section: normalizeSection(row.section, kind, pinned),
    tags: normalizeNoteTags(parseJsonArray(row.tags, (entry): entry is string => typeof entry === "string")),
    links: normalizeNoteLinks(parseJsonArray(row.links, isLink)),
    changeLog: parseJsonArray(row.change_log, isChange).slice(-100),
    pinned,
    source: row.source,
    sourceSessionId: row.source_session_id,
    promotion: promotedType && row.promoted_id && row.promoted_at
      ? { type: promotedType, id: row.promoted_id, at: row.promoted_at }
      : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNoteProjects(db: Db): NoteProject[] {
  const rows = db.prepare(`
    SELECT p.*, COUNT(n.id) AS note_count
    FROM note_projects p
    LEFT JOIN notes n ON n.project_id = p.id AND n.status != 'archived'
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.name COLLATE NOCASE
  `).all() as ProjectDbRow[];
  return rows.map(rowToProject);
}

export function getNoteProject(db: Db, id: string): NoteProject | null {
  const row = db.prepare(`
    SELECT p.*, COUNT(n.id) AS note_count
    FROM note_projects p LEFT JOIN notes n ON n.project_id = p.id AND n.status != 'archived'
    WHERE p.id = ? GROUP BY p.id
  `).get(id) as ProjectDbRow | undefined;
  return row ? rowToProject(row) : null;
}

export function findNoteProject(db: Db, name: string): NoteProject | null {
  const row = db.prepare(`
    SELECT p.*, COUNT(n.id) AS note_count
    FROM note_projects p LEFT JOIN notes n ON n.project_id = p.id AND n.status != 'archived'
    WHERE p.name = ? COLLATE NOCASE GROUP BY p.id
  `).get(name.trim()) as ProjectDbRow | undefined;
  return row ? rowToProject(row) : null;
}

export function ensureNoteProject(
  db: Db,
  name: string,
  description = "",
): { project: NoteProject; created: boolean } {
  const clean = cleanProjectName(name);
  if (!clean) throw new Error("project name is required");
  if (isGeneralSpace(clean)) throw new Error("General is AVA's built-in note space and cannot be created as a project");
  const existing = findNoteProject(db, clean);
  if (existing) return { project: existing, created: false };
  const now = Date.now();
  const id = `project_${nanoid(12)}`;
  db.prepare(`
    INSERT INTO note_projects (id, name, description, version, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).run(id, clean, scrubSecrets(description).trim().slice(0, 500), now, now);
  return { project: getNoteProject(db, id)!, created: true };
}

export function updateNoteProject(
  db: Db,
  id: string,
  expectedVersion: number,
  patch: { name?: string; description?: string },
): { ok: true; project: NoteProject } | { ok: false; reason: "not_found" | "version_conflict" | "duplicate"; project: NoteProject | null } {
  const current = getNoteProject(db, id);
  if (!current) return { ok: false, reason: "not_found", project: null };
  if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict", project: current };
  const name = patch.name === undefined ? current.name : cleanProjectName(patch.name);
  if (!name) return { ok: false, reason: "duplicate", project: current };
  const duplicate = findNoteProject(db, name);
  if (duplicate && duplicate.id !== id) return { ok: false, reason: "duplicate", project: duplicate };
  const description = patch.description === undefined ? current.description : scrubSecrets(patch.description).trim().slice(0, 500);
  db.prepare(`UPDATE note_projects SET name = ?, description = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`)
    .run(name, description, Date.now(), id, expectedVersion);
  db.prepare("UPDATE notes SET collection = ? WHERE project_id = ?").run(name, id);
  return { ok: true, project: getNoteProject(db, id)! };
}

function resolveProject(
  db: Db,
  projectId: string | null | undefined,
  collection: string | null | undefined,
): NoteProject | null {
  if (projectId === null || collection === null) return null;
  if (projectId) {
    const project = getNoteProject(db, projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    return project;
  }
  if (isGeneralSpace(collection)) return null;
  const name = cleanProjectName(collection);
  return name ? ensureNoteProject(db, name).project : null;
}

export function createNote(db: Db, input: CreateNoteInput): Note {
  const content = scrubSecrets(input.content).trim();
  const title = scrubSecrets(input.title ?? "").trim().slice(0, 160) || inferNoteTitle(content);
  if (!content && title === "Untitled note") throw new Error("note content is required");
  const project = resolveProject(db, input.projectId, input.collection);
  const kind = input.kind ?? "general";
  const pinned = input.pinned ?? input.section === "priorities";
  const section = input.section ?? (pinned
    ? "priorities"
    : kind === "decision"
      ? "decisions"
      : kind === "documentation" || kind === "reference"
        ? "documentation"
        : "capture");
  const id = `note_${nanoid(12)}`;
  const now = Date.now();
  const created = change("created", project ? `Captured in ${project.name}` : "Captured in General notes", now);
  const row: NoteDbRow = {
    id,
    title,
    content,
    kind,
    status: input.status ?? "ideas",
    collection: project?.name ?? null,
    tags: JSON.stringify(normalizeNoteTags(input.tags)),
    pinned: pinned ? 1 : 0,
    source: input.source ?? "manual",
    source_session_id: input.sourceSessionId ?? null,
    project_id: project?.id ?? null,
    section,
    links: JSON.stringify(normalizeNoteLinks(input.links)),
    change_log: JSON.stringify([created]),
    promoted_type: null,
    promoted_id: null,
    promoted_at: null,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO notes (
      id, title, content, kind, status, collection, tags, pinned, source,
      source_session_id, project_id, section, links, change_log,
      promoted_type, promoted_id, promoted_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.title, row.content, row.kind, row.status, row.collection,
    row.tags, row.pinned, row.source, row.source_session_id, row.project_id,
    row.section, row.links, row.change_log, row.promoted_type, row.promoted_id,
    row.promoted_at, row.version, row.created_at, row.updated_at,
  );
  if (project) db.prepare("UPDATE note_projects SET updated_at = ? WHERE id = ?").run(now, project.id);
  return rowToNote(row);
}

export function getNote(db: Db, id: string): Note | null {
  const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteDbRow | undefined;
  return row ? rowToNote(row) : null;
}

export function listNotes(db: Db, filter: NoteListFilter = {}): Note[] {
  const clauses: string[] = [];
  const values: Array<string | number | null> = [];
  if (!filter.includeArchived && filter.status === undefined) clauses.push("status != 'archived'");
  if (filter.kind) { clauses.push("kind = ?"); values.push(filter.kind); }
  if (filter.status) { clauses.push("status = ?"); values.push(filter.status); }
  if (filter.projectId !== undefined) {
    if (filter.projectId === null) clauses.push("project_id IS NULL");
    else { clauses.push("project_id = ?"); values.push(filter.projectId); }
  }
  if (filter.collection) { clauses.push("collection = ? COLLATE NOCASE"); values.push(filter.collection); }
  if (filter.section) { clauses.push("section = ?"); values.push(filter.section); }
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

function updateDetail(current: Note, patch: UpdateNotePatch): { action: NoteChange["action"]; detail: string } {
  if (patch.status && patch.status !== current.status) {
    return { action: "moved", detail: `Moved from ${current.status} to ${patch.status}` };
  }
  if (patch.projectId !== undefined || patch.collection !== undefined) return { action: "moved", detail: "Moved to another note space" };
  if (patch.section && patch.section !== current.section) return { action: "moved", detail: `Moved to ${patch.section}` };
  const fields = Object.keys(patch).filter((key) => (patch as Record<string, unknown>)[key] !== undefined);
  return { action: "updated", detail: fields.length ? `Updated ${fields.join(", ")}` : "Saved without content changes" };
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
    const title = scrubSecrets(patch.title ?? "").trim().slice(0, 160) || inferNoteTitle(scrubSecrets(patch.content ?? current.content));
    sets.push("title = ?"); values.push(title);
  }
  if (patch.content !== undefined) { sets.push("content = ?"); values.push(scrubSecrets(patch.content).trim()); }
  if (patch.kind !== undefined) { sets.push("kind = ?"); values.push(patch.kind); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.section !== undefined) { sets.push("section = ?"); values.push(patch.section); }
  if (patch.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(normalizeNoteTags(patch.tags))); }
  if (patch.links !== undefined) { sets.push("links = ?"); values.push(JSON.stringify(normalizeNoteLinks(patch.links))); }
  if (patch.pinned !== undefined) { sets.push("pinned = ?"); values.push(patch.pinned ? 1 : 0); }
  if (patch.projectId !== undefined || patch.collection !== undefined) {
    const project = resolveProject(db, patch.projectId, patch.collection);
    sets.push("project_id = ?", "collection = ?");
    values.push(project?.id ?? null, project?.name ?? null);
  }
  if (sets.length === 0) return { ok: true, note: current };

  const detail = updateDetail(current, patch);
  const history = [...current.changeLog, change(detail.action, detail.detail)].slice(-100);
  sets.push("change_log = ?", "updated_at = ?", "version = version + 1");
  values.push(JSON.stringify(history), Date.now(), id, expectedVersion);
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

export function promoteNote(
  db: Db,
  id: string,
  expectedVersion: number,
  type: NotePromotionType,
  promotionId: string,
): NoteMutationResult {
  const current = getNote(db, id);
  if (!current) return { ok: false, reason: "not_found", note: null };
  if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict", note: current };
  const now = Date.now();
  const history = [...current.changeLog, change("promoted", `Promoted to ${type.replace("_", " ")} ${promotionId}`, now)].slice(-100);
  const status = current.status === "done" || current.status === "archived" ? current.status : "doing";
  const result = db.prepare(`
    UPDATE notes SET promoted_type = ?, promoted_id = ?, promoted_at = ?,
      status = ?, change_log = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ?
  `).run(type, promotionId, now, status, JSON.stringify(history), now, id, expectedVersion);
  if (result.changes !== 1) return { ok: false, reason: "version_conflict", note: getNote(db, id) };
  return { ok: true, note: getNote(db, id)! };
}

export function buildNoteActionPrompt(note: Note): string {
  const project = note.collection ? `Project: ${note.collection}\n` : "";
  const links = note.links.length
    ? `\nReferences:\n${note.links.map((link) => `- ${link.label}: ${link.url}`).join("\n")}`
    : "";
  return `Turn this AVA Note into a completed task.\n\n${project}Title: ${note.title}\nContext:\n${note.content}${links}`;
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
