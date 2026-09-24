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
export const NOTE_DOCUMENT_TYPES = ["general", "study"] as const;
export const GENERAL_NOTE_FOLDER_ID = "notes_general";
export const MAX_NOTE_FOLDER_DEPTH = 6;

export type NoteKind = typeof NOTE_KINDS[number];
export type NoteStatus = typeof NOTE_STATUSES[number];
export type NoteSection = typeof NOTE_SECTIONS[number];
export type NotePromotionType = typeof NOTE_PROMOTION_TYPES[number];
export type NoteDocumentType = typeof NOTE_DOCUMENT_TYPES[number];
export type NoteSource = "manual" | "ava_chat" | "ava_voice";

export type NoteHierarchyErrorCode =
  | "bad_request"
  | "not_found"
  | "stale_version"
  | "name_conflict"
  | "folder_not_empty"
  | "invalid_move"
  | "depth_exceeded";

export class NoteHierarchyError extends Error {
  constructor(readonly code: NoteHierarchyErrorCode, message: string) {
    super(message);
    this.name = "NoteHierarchyError";
  }
}

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
  folder_id: string | null;
  document_type: string;
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

type FolderDbRow = {
  id: string;
  parent_id: string | null;
  name: string;
  description: string;
  position: number;
  built_in: 0 | 1;
  version: number;
  created_at: number;
  updated_at: number;
  document_count?: number;
};

export type NoteFolderBreadcrumb = { id: string; name: string };

export type NoteFolder = {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  position: number;
  builtIn: boolean;
  version: number;
  documentCount: number;
  breadcrumb: NoteFolderBreadcrumb[];
  path: string;
  createdAt: number;
  updatedAt: number;
};

export type NoteFolderMutationResult =
  | { ok: true; folder: NoteFolder }
  | { ok: false; reason: "not_found" | "version_conflict"; folder: NoteFolder | null };

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
  folderId: string;
  folderPath: NoteFolderBreadcrumb[];
  documentType: NoteDocumentType;
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
  folderId?: string | null;
  documentType?: NoteDocumentType;
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
  "folderId" | "documentType" | "section" | "tags" | "links" | "pinned"
>>;

export type NoteMutationResult =
  | { ok: true; note: Note }
  | { ok: false; reason: "not_found" | "version_conflict"; note: Note | null };

export type NoteListFilter = {
  q?: string;
  documentType?: NoteDocumentType;
  kind?: NoteKind;
  status?: NoteStatus;
  projectId?: string | null;
  folderId?: string;
  subtree?: boolean;
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

function cleanFolderName(value: string | null | undefined): string {
  const clean = scrubSecrets(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!clean) throw new NoteHierarchyError("bad_request", "folder name is required");
  if (clean.includes("/")) throw new NoteHierarchyError("bad_request", "folder names cannot contain /");
  return clean;
}

function cleanFolderDescription(value: string | undefined): string {
  return scrubSecrets(value ?? "").trim().slice(0, 500);
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

function normalizeDocumentType(value: string): NoteDocumentType {
  return (NOTE_DOCUMENT_TYPES as readonly string[]).includes(value) ? value as NoteDocumentType : "general";
}

function change(action: NoteChange["action"], detail: string, at = Date.now()): NoteChange {
  return { id: `change_${nanoid(10)}`, at, action, detail: detail.slice(0, 240) };
}

function rawFolderRows(db: Db): FolderDbRow[] {
  return db.prepare(`
    SELECT f.*, COUNT(n.id) AS document_count
    FROM note_folders f
    LEFT JOIN notes n ON n.folder_id = f.id AND n.status != 'archived'
    GROUP BY f.id
  `).all() as FolderDbRow[];
}

function orderedFolderRows(rows: FolderDbRow[]): Array<{ row: FolderDbRow; breadcrumb: NoteFolderBreadcrumb[] }> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string | null, FolderDbRow[]>();
  for (const row of rows) {
    const parent = row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(row);
    children.set(parent, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
  const ordered: Array<{ row: FolderDbRow; breadcrumb: NoteFolderBreadcrumb[] }> = [];
  const seen = new Set<string>();
  const visit = (row: FolderDbRow, parent: NoteFolderBreadcrumb[]) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const breadcrumb = [...parent, { id: row.id, name: row.name }];
    ordered.push({ row, breadcrumb });
    for (const child of children.get(row.id) ?? []) visit(child, breadcrumb);
  };
  for (const root of children.get(null) ?? []) visit(root, []);
  // A malformed historical parent must not make a folder disappear. It is
  // exposed as an orphaned root while all new writes reject such a state.
  for (const row of rows) if (!seen.has(row.id)) visit(row, []);
  return ordered;
}

function rowToFolder(row: FolderDbRow, breadcrumb: NoteFolderBreadcrumb[]): NoteFolder {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    description: row.description,
    position: row.position,
    builtIn: row.built_in === 1,
    version: row.version,
    documentCount: row.document_count ?? 0,
    breadcrumb,
    path: breadcrumb.map((part) => part.name).join("/"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNoteFolders(db: Db): NoteFolder[] {
  return orderedFolderRows(rawFolderRows(db)).map(({ row, breadcrumb }) => rowToFolder(row, breadcrumb));
}

export function getNoteFolder(db: Db, id: string): NoteFolder | null {
  return listNoteFolders(db).find((folder) => folder.id === id) ?? null;
}

export function resolveNoteFolderPath(db: Db, path: string): NoteFolder | null {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > MAX_NOTE_FOLDER_DEPTH) return null;
  let parentId: string | null = null;
  let current: NoteFolder | null = null;
  for (const part of parts) {
    current = listNoteFolders(db).find((folder) =>
      folder.parentId === parentId && folder.name.localeCompare(part, undefined, { sensitivity: "base" }) === 0,
    ) ?? null;
    if (!current) return null;
    parentId = current.id;
  }
  return current;
}

function nextFolderPosition(db: Db, parentId: string | null): number {
  const row = parentId === null
    ? db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM note_folders WHERE parent_id IS NULL").get()
    : db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM note_folders WHERE parent_id = ?").get(parentId);
  return Number((row as { position?: number } | undefined)?.position ?? 0);
}

function ensureRootProjectProjection(db: Db, folder: NoteFolder): void {
  if (folder.parentId !== null || folder.builtIn) return;
  db.prepare(`
    INSERT INTO note_projects (id, name, description, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description,
      version=excluded.version, updated_at=excluded.updated_at
  `).run(folder.id, folder.name, folder.description, folder.version, folder.createdAt, folder.updatedAt);
}

function descendantFolderIds(db: Db, folderId: string): string[] {
  const folders = listNoteFolders(db);
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id);
    children.set(folder.parentId, list);
  }
  const out: string[] = [];
  const visit = (id: string) => {
    if (out.includes(id)) return;
    out.push(id);
    for (const child of children.get(id) ?? []) visit(child);
  };
  visit(folderId);
  return out;
}

function syncCompatibilityForSubtree(db: Db, folderId: string): void {
  const folder = getNoteFolder(db, folderId);
  if (!folder) return;
  const rootId = folder.breadcrumb[0]?.id ?? GENERAL_NOTE_FOLDER_ID;
  const root = getNoteFolder(db, rootId);
  if (!root) return;
  const ids = descendantFolderIds(db, folderId);
  const placeholders = ids.map(() => "?").join(",");
  if (root.id === GENERAL_NOTE_FOLDER_ID) {
    db.prepare(`UPDATE notes SET project_id = NULL, collection = NULL WHERE folder_id IN (${placeholders})`).run(...ids);
  } else {
    ensureRootProjectProjection(db, root);
    db.prepare(`UPDATE notes SET project_id = ?, collection = ? WHERE folder_id IN (${placeholders})`)
      .run(root.id, root.name, ...ids);
  }
}

export function createNoteFolder(db: Db, input: {
  parentId?: string | null;
  name: string;
  description?: string;
  position?: number;
}): NoteFolder {
  const name = cleanFolderName(input.name);
  const parentId = input.parentId ?? null;
  const parent = parentId ? getNoteFolder(db, parentId) : null;
  if (parentId && !parent) throw new NoteHierarchyError("not_found", "parent folder not found");
  if ((parent?.breadcrumb.length ?? 0) + 1 > MAX_NOTE_FOLDER_DEPTH) {
    throw new NoteHierarchyError("depth_exceeded", `folders are limited to ${MAX_NOTE_FOLDER_DEPTH} levels`);
  }
  if (parentId === null && /^general$/i.test(name)) {
    throw new NoteHierarchyError("name_conflict", "General is AVA's built-in folder");
  }
  const id = `folder_${nanoid(12)}`;
  const now = Date.now();
  const position = Number.isSafeInteger(input.position) && Number(input.position) >= 0
    ? Math.min(1_000_000, Number(input.position))
    : nextFolderPosition(db, parentId);
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO note_folders
        (id,parent_id,name,description,position,built_in,version,created_at,updated_at)
        VALUES (?,?,?,?,?,0,1,?,?)`)
        .run(id, parentId, name, cleanFolderDescription(input.description), position, now, now);
      const created = getNoteFolder(db, id)!;
      ensureRootProjectProjection(db, created);
    }).immediate();
  } catch (error) {
    if (error instanceof NoteHierarchyError) throw error;
    if (/unique constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw new NoteHierarchyError("name_conflict", "a folder with this name already exists here");
    }
    throw error;
  }
  return getNoteFolder(db, id)!;
}

export function ensureNoteFolderPath(db: Db, path: string): NoteFolder {
  const parts = path.split("/").map((part) => part.trim()).filter(Boolean).map((part) => cleanFolderName(part));
  if (!parts.length) throw new NoteHierarchyError("bad_request", "folder path is required");
  if (parts.length > MAX_NOTE_FOLDER_DEPTH) throw new NoteHierarchyError("depth_exceeded", "folder path is too deep");
  let parentId: string | null = null;
  let current: NoteFolder | null = null;
  for (const part of parts) {
    current = listNoteFolders(db).find((folder) =>
      folder.parentId === parentId && folder.name.localeCompare(part, undefined, { sensitivity: "base" }) === 0,
    ) ?? createNoteFolder(db, { parentId, name: part });
    parentId = current.id;
  }
  return current!;
}

export function updateNoteFolder(db: Db, id: string, expectedVersion: number, patch: {
  parentId?: string | null;
  name?: string;
  description?: string;
  position?: number;
}): NoteFolderMutationResult {
  const current = getNoteFolder(db, id);
  if (!current) return { ok: false, reason: "not_found", folder: null };
  if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict", folder: current };
  if (current.builtIn && (patch.parentId !== undefined || patch.name !== undefined)) {
    throw new NoteHierarchyError("invalid_move", "the built-in General folder cannot be moved or renamed");
  }
  const parentId = patch.parentId === undefined ? current.parentId : patch.parentId;
  const parent = parentId ? getNoteFolder(db, parentId) : null;
  if (parentId && !parent) throw new NoteHierarchyError("not_found", "parent folder not found");
  const descendants = descendantFolderIds(db, id);
  if (parentId === id || (parentId && descendants.includes(parentId))) {
    throw new NoteHierarchyError("invalid_move", "a folder cannot be moved inside itself");
  }
  const folders = listNoteFolders(db);
  const subtreeDepth = Math.max(...folders
    .filter((folder) => descendants.includes(folder.id))
    .map((folder) => folder.breadcrumb.length - current.breadcrumb.length), 0);
  const newDepth = (parent?.breadcrumb.length ?? 0) + 1;
  if (newDepth + subtreeDepth > MAX_NOTE_FOLDER_DEPTH) {
    throw new NoteHierarchyError("depth_exceeded", `folders are limited to ${MAX_NOTE_FOLDER_DEPTH} levels`);
  }
  const name = patch.name === undefined ? current.name : cleanFolderName(patch.name);
  if (parentId === null && id !== GENERAL_NOTE_FOLDER_ID && /^general$/i.test(name)) {
    throw new NoteHierarchyError("name_conflict", "General is AVA's built-in folder");
  }
  const description = patch.description === undefined ? current.description : cleanFolderDescription(patch.description);
  const position = patch.position === undefined ? current.position
    : Number.isSafeInteger(patch.position) && patch.position >= 0 ? Math.min(1_000_000, patch.position) : current.position;
  const now = Date.now();
  try {
    const result = db.transaction(() => {
      const changed = db.prepare(`UPDATE note_folders SET parent_id=?,name=?,description=?,position=?,
        version=version+1,updated_at=? WHERE id=? AND version=?`)
        .run(parentId, name, description, position, now, id, expectedVersion);
      if (!changed.changes) return false;
      const updated = getNoteFolder(db, id)!;
      ensureRootProjectProjection(db, updated);
      syncCompatibilityForSubtree(db, id);
      if (current.parentId === null && parentId === null && !current.builtIn) {
        db.prepare("UPDATE note_projects SET name=?,description=?,version=?,updated_at=? WHERE id=?")
          .run(updated.name, updated.description, updated.version, updated.updatedAt, updated.id);
      }
      return true;
    }).immediate();
    if (!result) return { ok: false, reason: "version_conflict", folder: getNoteFolder(db, id) };
  } catch (error) {
    if (error instanceof NoteHierarchyError) throw error;
    if (/unique constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw new NoteHierarchyError("name_conflict", "a folder with this name already exists here");
    }
    throw error;
  }
  return { ok: true, folder: getNoteFolder(db, id)! };
}

export function deleteNoteFolder(db: Db, id: string, expectedVersion: number): NoteFolderMutationResult {
  const current = getNoteFolder(db, id);
  if (!current) return { ok: false, reason: "not_found", folder: null };
  if (current.version !== expectedVersion) return { ok: false, reason: "version_conflict", folder: current };
  if (current.builtIn) throw new NoteHierarchyError("invalid_move", "the built-in General folder cannot be deleted");
  const populated = db.prepare(`SELECT
    EXISTS(SELECT 1 FROM notes WHERE folder_id=?) AS has_notes,
    EXISTS(SELECT 1 FROM note_folders WHERE parent_id=?) AS has_children`).get(id, id) as { has_notes: 0 | 1; has_children: 0 | 1 };
  if (populated.has_notes || populated.has_children) {
    throw new NoteHierarchyError("folder_not_empty", "move or delete this folder's contents first");
  }
  const deleted = db.transaction(() => {
    const result = db.prepare("DELETE FROM note_folders WHERE id=? AND version=?").run(id, expectedVersion);
    if (result.changes) db.prepare("DELETE FROM note_projects WHERE id=?").run(id);
    return result.changes === 1;
  }).immediate();
  return deleted
    ? { ok: true, folder: current }
    : { ok: false, reason: "version_conflict", folder: getNoteFolder(db, id) };
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

function rowToNote(db: Db, row: NoteDbRow, knownFolder?: NoteFolder): Note {
  const kind = normalizeKind(row.kind);
  const pinned = row.pinned === 1;
  const folder = knownFolder ?? getNoteFolder(db, row.folder_id ?? GENERAL_NOTE_FOLDER_ID)
    ?? getNoteFolder(db, GENERAL_NOTE_FOLDER_ID);
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
    folderId: folder?.id ?? GENERAL_NOTE_FOLDER_ID,
    folderPath: folder?.breadcrumb ?? [{ id: GENERAL_NOTE_FOLDER_ID, name: "General" }],
    documentType: normalizeDocumentType(row.document_type),
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

function ensureProjectFolder(db: Db, project: NoteProject): NoteFolder {
  const existing = getNoteFolder(db, project.id);
  if (existing) return existing;
  db.prepare(`INSERT OR IGNORE INTO note_folders
    (id,parent_id,name,description,position,built_in,version,created_at,updated_at)
    VALUES (?,NULL,?,?,100,0,?,?,?)`)
    .run(project.id, project.name, project.description, project.version, project.createdAt, project.updatedAt);
  return getNoteFolder(db, project.id)!;
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
  if (existing) {
    ensureProjectFolder(db, existing);
    return { project: existing, created: false };
  }
  const now = Date.now();
  const id = `project_${nanoid(12)}`;
  const cleanDescription = scrubSecrets(description).trim().slice(0, 500);
  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO note_projects (id, name, description, version, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(id, clean, cleanDescription, now, now);
      db.prepare(`INSERT INTO note_folders
        (id,parent_id,name,description,position,built_in,version,created_at,updated_at)
        VALUES (?,NULL,?,?,100,0,1,?,?)`)
        .run(id, clean, cleanDescription, now, now);
    }).immediate();
  } catch (error) {
    if (/unique constraint/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error("project name already exists");
    }
    throw error;
  }
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
  const folder = ensureProjectFolder(db, current);
  try {
    const updated = updateNoteFolder(db, folder.id, folder.version, { name, description });
    if (!updated.ok) {
      return { ok: false, reason: updated.reason, project: getNoteProject(db, id) };
    }
    return { ok: true, project: getNoteProject(db, id)! };
  } catch (error) {
    if (error instanceof NoteHierarchyError && error.code === "name_conflict") {
      return { ok: false, reason: "duplicate", project: findNoteProject(db, name) };
    }
    throw error;
  }
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

function resolveFolder(
  db: Db,
  folderId: string | null | undefined,
  projectId: string | null | undefined,
  collection: string | null | undefined,
): NoteFolder {
  if (folderId !== undefined) {
    const resolved = getNoteFolder(db, folderId ?? GENERAL_NOTE_FOLDER_ID);
    if (!resolved) throw new NoteHierarchyError("not_found", `folder not found: ${folderId}`);
    return resolved;
  }
  const project = resolveProject(db, projectId, collection);
  if (project) return ensureProjectFolder(db, project);
  const general = getNoteFolder(db, GENERAL_NOTE_FOLDER_ID);
  if (!general) throw new NoteHierarchyError("not_found", "General Notes folder is unavailable");
  return general;
}

function compatibilityForFolder(db: Db, folder: NoteFolder): { projectId: string | null; collection: string | null } {
  const rootId = folder.breadcrumb[0]?.id ?? GENERAL_NOTE_FOLDER_ID;
  if (rootId === GENERAL_NOTE_FOLDER_ID) return { projectId: null, collection: null };
  const root = getNoteFolder(db, rootId);
  if (!root) return { projectId: null, collection: null };
  ensureRootProjectProjection(db, root);
  return { projectId: root.id, collection: root.name };
}

function assertDocumentTitleAvailable(db: Db, folderId: string, title: string, excludeId?: string): void {
  const duplicate = db.prepare(`SELECT id FROM notes
    WHERE folder_id=? AND title=? COLLATE NOCASE AND (? IS NULL OR id != ?) LIMIT 1`)
    .get(folderId, title, excludeId ?? null, excludeId ?? null) as { id: string } | undefined;
  if (duplicate) throw new NoteHierarchyError("name_conflict", "a document with this title already exists in the folder");
}

export function createNote(db: Db, input: CreateNoteInput): Note {
  const content = scrubSecrets(input.content).trim();
  const title = scrubSecrets(input.title ?? "").trim().slice(0, 160) || inferNoteTitle(content);
  if (!content && title === "Untitled note") throw new Error("note content is required");
  const folder = resolveFolder(db, input.folderId, input.projectId, input.collection);
  assertDocumentTitleAvailable(db, folder.id, title);
  const compatibility = compatibilityForFolder(db, folder);
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
  const created = change("created", `Captured in ${folder.path}`, now);
  const row: NoteDbRow = {
    id,
    title,
    content,
    kind,
    status: input.status ?? "ideas",
    collection: compatibility.collection,
    tags: JSON.stringify(normalizeNoteTags(input.tags)),
    pinned: pinned ? 1 : 0,
    source: input.source ?? "manual",
    source_session_id: input.sourceSessionId ?? null,
    project_id: compatibility.projectId,
    folder_id: folder.id,
    document_type: input.documentType ?? "general",
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
      source_session_id, project_id, folder_id, document_type, section, links, change_log,
      promoted_type, promoted_id, promoted_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.title, row.content, row.kind, row.status, row.collection,
    row.tags, row.pinned, row.source, row.source_session_id, row.project_id,
    row.folder_id, row.document_type, row.section, row.links, row.change_log, row.promoted_type, row.promoted_id,
    row.promoted_at, row.version, row.created_at, row.updated_at,
  );
  if (compatibility.projectId) db.prepare("UPDATE note_projects SET updated_at = ? WHERE id = ?").run(now, compatibility.projectId);
  return rowToNote(db, row);
}

export function getNote(db: Db, id: string): Note | null {
  const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteDbRow | undefined;
  return row ? rowToNote(db, row) : null;
}

export function listNotes(db: Db, filter: NoteListFilter = {}): Note[] {
  const clauses: string[] = [];
  const values: Array<string | number | null> = [];
  if (!filter.includeArchived && filter.status === undefined) clauses.push("status != 'archived'");
  if (filter.documentType) { clauses.push("document_type = ?"); values.push(filter.documentType); }
  if (filter.kind) { clauses.push("kind = ?"); values.push(filter.kind); }
  if (filter.status) { clauses.push("status = ?"); values.push(filter.status); }
  if (filter.projectId !== undefined) {
    if (filter.projectId === null) clauses.push("project_id IS NULL");
    else { clauses.push("project_id = ?"); values.push(filter.projectId); }
  }
  if (filter.folderId !== undefined) {
    const folder = getNoteFolder(db, filter.folderId);
    if (!folder) return [];
    const ids = filter.subtree ? descendantFolderIds(db, folder.id) : [folder.id];
    clauses.push(`folder_id IN (${ids.map(() => "?").join(",")})`);
    values.push(...ids);
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
  const folders = new Map(listNoteFolders(db).map((folder) => [folder.id, folder]));
  const general = folders.get(GENERAL_NOTE_FOLDER_ID);
  return rows.map((row) => rowToNote(db, row, folders.get(row.folder_id ?? GENERAL_NOTE_FOLDER_ID) ?? general));
}

function updateDetail(current: Note, patch: UpdateNotePatch): { action: NoteChange["action"]; detail: string } {
  if (patch.status && patch.status !== current.status) {
    return { action: "moved", detail: `Moved from ${current.status} to ${patch.status}` };
  }
  if (patch.folderId !== undefined || patch.projectId !== undefined || patch.collection !== undefined) {
    return { action: "moved", detail: "Moved to another note folder" };
  }
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
  const title = patch.title === undefined
    ? current.title
    : scrubSecrets(patch.title ?? "").trim().slice(0, 160) || inferNoteTitle(scrubSecrets(patch.content ?? current.content));
  const folder = patch.folderId !== undefined || patch.projectId !== undefined || patch.collection !== undefined
    ? resolveFolder(db, patch.folderId, patch.projectId, patch.collection)
    : getNoteFolder(db, current.folderId) ?? getNoteFolder(db, GENERAL_NOTE_FOLDER_ID)!;
  if (patch.title !== undefined || folder.id !== current.folderId) {
    assertDocumentTitleAvailable(db, folder.id, title, current.id);
  }
  if (patch.title !== undefined) {
    sets.push("title = ?"); values.push(title);
  }
  if (patch.content !== undefined) { sets.push("content = ?"); values.push(scrubSecrets(patch.content).trim()); }
  if (patch.kind !== undefined) { sets.push("kind = ?"); values.push(patch.kind); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.section !== undefined) { sets.push("section = ?"); values.push(patch.section); }
  if (patch.tags !== undefined) { sets.push("tags = ?"); values.push(JSON.stringify(normalizeNoteTags(patch.tags))); }
  if (patch.links !== undefined) { sets.push("links = ?"); values.push(JSON.stringify(normalizeNoteLinks(patch.links))); }
  if (patch.pinned !== undefined) { sets.push("pinned = ?"); values.push(patch.pinned ? 1 : 0); }
  if (patch.documentType !== undefined) { sets.push("document_type = ?"); values.push(patch.documentType); }
  if (patch.folderId !== undefined || patch.projectId !== undefined || patch.collection !== undefined) {
    const compatibility = compatibilityForFolder(db, folder);
    sets.push("folder_id = ?", "project_id = ?", "collection = ?");
    values.push(folder.id, compatibility.projectId, compatibility.collection);
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
