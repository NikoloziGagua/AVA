import { ApiError } from "../api.js";
import { clearToken, getToken } from "../auth/tokens.js";

export const NOTE_KINDS = [
  "idea", "requirement", "task", "decision", "documentation",
  "reference", "meeting", "thought", "general",
] as const;
export const NOTE_STAGES = ["ideas", "doing", "review", "done"] as const;
export const NOTE_SECTIONS = ["capture", "priorities", "decisions", "documentation"] as const;

export const NOTE_DOCUMENT_TYPES = ["general", "study"] as const;
/** The built-in root folder every unfiled page lives in (notes-hierarchy v3). */
export const GENERAL_FOLDER_ID = "notes_general";

export type NoteKind = typeof NOTE_KINDS[number];
export type NoteDocumentType = typeof NOTE_DOCUMENT_TYPES[number];
export type NoteStage = typeof NOTE_STAGES[number] | "archived";
export type NoteSection = typeof NOTE_SECTIONS[number];
export type NoteLink = { label: string; url: string };
export type NoteChange = { id: string; at: number; action: string; detail: string };

export type NoteProject = {
  id: string;
  name: string;
  description: string;
  version: number;
  noteCount: number;
  createdAt: number;
  updatedAt: number;
};

export type NoteFolderCrumb = { id: string; name: string };

export type NoteFolder = {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  position: number;
  builtIn: boolean;
  version: number;
  documentCount: number;
  breadcrumb: NoteFolderCrumb[];
  path: string;
  createdAt: number;
  updatedAt: number;
};

export type NotesTree = {
  folders: NoteFolder[];
  snapshot: { fetchedAt: number; version: string; complete: boolean; totalDocuments: number };
  migration: { legacyProjectCount: number; legacyRootFolderIds: string[] };
};

export type Note = {
  id: string;
  title: string;
  content: string;
  kind: NoteKind;
  status: NoteStage;
  collection: string | null;
  projectId: string | null;
  /** Hierarchy fields from notes-hierarchy v3; optional so older payloads still render in General. */
  folderId?: string;
  folderPath?: NoteFolderCrumb[];
  documentType?: NoteDocumentType;
  documentPosition?: number;
  section: NoteSection;
  tags: string[];
  links: NoteLink[];
  changeLog: NoteChange[];
  pinned: boolean;
  source: "manual" | "ava_chat" | "ava_voice";
  sourceSessionId: string | null;
  promotion: { type: "task" | "self_improvement"; id: string; at: number } | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type NotesSnapshot = { projects: NoteProject[]; notes: Note[] };

/** Plain words for the typed hierarchy errors (notes-hierarchy v3). */
const ERROR_TEXT: Record<string, string> = {
  name_conflict: "That name is already used here.",
  folder_not_empty: "Only an empty folder can be deleted. Move its pages and folders out first.",
  invalid_move: "A folder cannot move inside itself.",
  depth_exceeded: "Folders can only be nested six levels deep.",
  not_found: "That folder no longer exists.",
};

async function notesRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(path, { ...init, headers }); }
  catch {
    throw new ApiError(0, "AVA's server is unreachable.", "server_unreachable", "Restart the AVA Desktop Runtime.", path);
  }
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      window.dispatchEvent(new Event("ava:unauthorized"));
    }
    throw new ApiError(
      response.status,
      (typeof body.error === "string" ? ERROR_TEXT[body.error] : undefined) ?? body.message ??
        (body.error === "stale_version" ? "This note changed elsewhere. The latest version has been reloaded." : body.error) ??
        `Notes returned HTTP ${response.status}.`,
      body.error ?? `http_${response.status}`,
      null,
      path,
    );
  }
  return body as T;
}

export function fetchNotes(): Promise<NotesSnapshot> {
  return notesRequest("/api/notes");
}

export function fetchNotesTree(): Promise<NotesTree> {
  return notesRequest("/api/notes/tree");
}

export async function createNoteFolder(input: { parentId: string | null; name: string; description?: string }): Promise<NoteFolder> {
  const result = await notesRequest<{ folder: NoteFolder }>("/api/notes/folders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.folder;
}

export async function updateNoteFolder(id: string, expectedVersion: number, patch: Partial<{
  name: string;
  description: string;
  parentId: string | null;
}>): Promise<NoteFolder> {
  const result = await notesRequest<{ folder: NoteFolder }>(`/api/notes/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion, ...patch }),
  });
  return result.folder;
}

export async function deleteNoteFolder(id: string, expectedVersion: number): Promise<void> {
  await notesRequest(`/api/notes/folders/${encodeURIComponent(id)}?expectedVersion=${expectedVersion}`, { method: "DELETE" });
}

export async function createNoteProject(input: { name: string; description?: string }): Promise<NoteProject> {
  const result = await notesRequest<{ project: NoteProject }>("/api/notes/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.project;
}

export async function createNote(input: {
  title?: string;
  content: string;
  kind?: NoteKind;
  status?: NoteStage;
  projectId?: string | null;
  folderId?: string;
  documentType?: NoteDocumentType;
  section?: NoteSection;
  tags?: string[];
  links?: NoteLink[];
  pinned?: boolean;
}): Promise<Note> {
  const result = await notesRequest<{ note: Note }>("/api/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.note;
}

export async function updateNote(id: string, expectedVersion: number, patch: Partial<{
  title: string;
  content: string;
  kind: NoteKind;
  status: NoteStage;
  projectId: string | null;
  folderId: string;
  documentType: NoteDocumentType;
  section: NoteSection;
  tags: string[];
  links: NoteLink[];
  pinned: boolean;
}>): Promise<Note> {
  const result = await notesRequest<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion, ...patch }),
  });
  return result.note;
}

export async function deleteNote(id: string, expectedVersion: number): Promise<void> {
  await notesRequest(`/api/notes/${encodeURIComponent(id)}?version=${expectedVersion}`, { method: "DELETE" });
}

export async function promoteNote(
  id: string,
  expectedVersion: number,
  target: "task" | "self_improvement",
): Promise<{ note: Note; promotionId: string; prompt: string | null }> {
  return notesRequest(`/api/notes/${encodeURIComponent(id)}/promote`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, target }),
  });
}
