import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { createNoteFolder, deleteNoteFolder, getNoteFolder, listNoteFolders, listNotes, type Note } from "../state/notes.js";

export const PROJECT_KINDS = ["business", "build", "uni"] as const;
export const PROJECT_STATUSES = ["active", "paused", "done"] as const;
export const PROJECT_ITEM_KINDS = ["step", "question", "log"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectItemKind = (typeof PROJECT_ITEM_KINDS)[number];
/** Where a change came from: the Projects tab, typed chat, voice, or AVA's own follow-up. */
export type ProjectSource = "app" | "chat" | "voice" | "ava";

export type Project = {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  stage: string;
  goal: string;
  /** AVA's "where it stands", in plain words. */
  summary: string;
  nextStep: string;
  /** The Notes folder that holds this project's notes. */
  folderId: string | null;
  /** The project's own conversation. */
  sessionId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  removedAt: number | null;
};

export type ProjectItem = {
  id: string;
  projectId: string;
  kind: ProjectItemKind;
  text: string;
  doneAt: number | null;
  source: ProjectSource;
  sourceSessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectDetail = {
  project: Project;
  steps: ProjectItem[];
  questions: ProjectItem[];
  log: ProjectItem[];
  notes: Note[];
};

export class ProjectError extends Error {
  constructor(readonly code: "not_found" | "duplicate" | "stale_version" | "invalid", message: string) {
    super(message);
  }
}

type Row = {
  id: string; name: string; kind: string; status: string; stage: string; goal: string; summary: string; next_step: string;
  folder_id: string | null; session_id: string | null; version: number; created_at: number; updated_at: number; removed_at: number | null;
};
type ItemRow = {
  id: string; project_id: string; kind: string; text: string; done_at: number | null; source: string;
  source_session_id: string | null; created_at: number; updated_at: number;
};

const toProject = (row: Row): Project => ({
  id: row.id, name: row.name, kind: row.kind as ProjectKind, status: row.status as ProjectStatus, stage: row.stage, goal: row.goal,
  summary: row.summary, nextStep: row.next_step, folderId: row.folder_id, sessionId: row.session_id, version: row.version,
  createdAt: row.created_at, updatedAt: row.updated_at, removedAt: row.removed_at,
});
const toItem = (row: ItemRow): ProjectItem => ({
  id: row.id, projectId: row.project_id, kind: row.kind as ProjectItemKind, text: row.text, doneAt: row.done_at,
  source: row.source as ProjectSource, sourceSessionId: row.source_session_id, createdAt: row.created_at, updatedAt: row.updated_at,
});

const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
const KIND_ORDER: Record<ProjectKind, number> = { business: 0, build: 1, uni: 2 };

export function listProjects(db: Db, opts: { includeRemoved?: boolean } = {}): Project[] {
  const rows = db.prepare(`SELECT * FROM projects ${opts.includeRemoved ? "" : "WHERE removed_at IS NULL"} ORDER BY updated_at DESC`).all() as Row[];
  return rows.map(toProject).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

/** Recently removed projects, newest first, so a removal can be undone. */
export function removedProjects(db: Db, limit = 10): Project[] {
  return (db.prepare("SELECT * FROM projects WHERE removed_at IS NOT NULL ORDER BY removed_at DESC LIMIT ?").all(limit) as Row[]).map(toProject);
}

export function getProject(db: Db, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return row ? toProject(row) : null;
}

const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length > 2);
const FILLER = new Set(["the", "project", "business", "and", "for", "my"]);

/** A live project by name as Niko would say it: exact first, then the one sharing the most words ("tire business" finds "Mobile tyre fitting" only if a word matches). */
export function findProject(db: Db, name: string, opts: { removed?: boolean } = {}): Project | null {
  const pool = opts.removed ? removedProjects(db, 50) : listProjects(db);
  const wanted = clean(name, 160).toLowerCase();
  const exact = pool.find((project) => project.name.toLowerCase() === wanted);
  if (exact) return exact;
  const asked = new Set(words(wanted).filter((word) => !FILLER.has(word)).map((word) => word.replace(/^tire/, "tyre")));
  let best: Project | null = null, score = 0;
  for (const project of pool) {
    const shared = words(project.name).filter((word) => asked.has(word)).length;
    if (shared > score) { best = project; score = shared; }
  }
  return score > 0 ? best : null;
}

function writeItem(db: Db, projectId: string, kind: ProjectItemKind, text: string, source: ProjectSource, sessionId: string | null, now: number): ProjectItem {
  const id = `pitem_${nanoid(12)}`;
  db.prepare(`INSERT INTO project_items (id, project_id, kind, text, done_at, source, source_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(id, projectId, kind, text, source, sessionId, now, now);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
  return toItem(db.prepare("SELECT * FROM project_items WHERE id = ?").get(id) as ItemRow);
}

/** A root Notes folder for the project: the existing one with its name, or a new one. */
function projectFolder(db: Db, name: string): string | null {
  const existing = listNoteFolders(db).find((folder) => folder.parentId === null && folder.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  try { return createNoteFolder(db, { name }).id; } catch { return null; }
}

export function createProject(db: Db, input: {
  name: string; kind: ProjectKind; goal?: string; stage?: string; summary?: string; nextStep?: string;
  folderId?: string | null; source: ProjectSource; sessionId?: string | null;
}, now = Date.now()): Project {
  const name = clean(input.name, 120);
  if (!name) throw new ProjectError("invalid", "A project needs a name.");
  if (!PROJECT_KINDS.includes(input.kind)) throw new ProjectError("invalid", `Unknown project kind: ${String(input.kind)}`);
  const clash = listProjects(db).find((project) => project.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new ProjectError("duplicate", `There is already a project called ${clash.name}.`);
  const id = `proj_${nanoid(12)}`;
  const folderId = input.folderId !== undefined ? input.folderId : projectFolder(db, name);
  db.transaction(() => {
    db.prepare(`INSERT INTO projects (id, name, kind, status, stage, goal, summary, next_step, folder_id, session_id, version, created_at, updated_at, removed_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, 1, ?, ?, NULL)`).run(
      id, name, input.kind, clean(input.stage ?? "", 120), clean(input.goal ?? "", 400), clean(input.summary ?? "", 1_200),
      clean(input.nextStep ?? "", 300), folderId, now, now,
    );
    writeItem(db, id, "log", "Project started.", input.source, input.sessionId ?? null, now);
  })();
  return getProject(db, id)!;
}

export type ProjectPatch = Partial<Pick<Project, "name" | "kind" | "status" | "stage" | "goal" | "summary" | "nextStep">>;

/** Changes a live project. A change to name, kind, status, stage or next step is written to its log. */
export function updateProject(db: Db, id: string, patch: ProjectPatch, opts: { expectedVersion?: number; source: ProjectSource; sessionId?: string | null }, now = Date.now()): Project {
  const current = getProject(db, id);
  if (!current || current.removedAt) throw new ProjectError("not_found", "That project doesn't exist or was removed.");
  if (opts.expectedVersion !== undefined && current.version !== opts.expectedVersion) {
    throw new ProjectError("stale_version", "This project changed since you opened it.");
  }
  const next = { ...current };
  if (patch.name !== undefined) {
    const name = clean(patch.name, 120);
    if (!name) throw new ProjectError("invalid", "A project needs a name.");
    const clash = listProjects(db).find((project) => project.id !== id && project.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new ProjectError("duplicate", `There is already a project called ${clash.name}.`);
    next.name = name;
  }
  if (patch.kind !== undefined) {
    if (!PROJECT_KINDS.includes(patch.kind)) throw new ProjectError("invalid", `Unknown project kind: ${String(patch.kind)}`);
    next.kind = patch.kind;
  }
  if (patch.status !== undefined) {
    if (!PROJECT_STATUSES.includes(patch.status)) throw new ProjectError("invalid", `Unknown status: ${String(patch.status)}`);
    next.status = patch.status;
  }
  if (patch.stage !== undefined) next.stage = clean(patch.stage, 120);
  if (patch.goal !== undefined) next.goal = clean(patch.goal, 400);
  if (patch.summary !== undefined) next.summary = clean(patch.summary, 1_200);
  if (patch.nextStep !== undefined) next.nextStep = clean(patch.nextStep, 300);
  const notes: string[] = [];
  if (next.name !== current.name) notes.push(`Renamed from “${current.name}” to “${next.name}”.`);
  if (next.kind !== current.kind) notes.push(`Moved to ${next.kind === "build" ? "Builds" : next.kind === "uni" ? "Uni" : "Business"}.`);
  if (next.status !== current.status) notes.push(next.status === "done" ? "Marked done." : next.status === "paused" ? "Paused." : "Active again.");
  if (next.stage !== current.stage && next.stage) notes.push(`Stage: ${next.stage}.`);
  if (next.nextStep !== current.nextStep && next.nextStep) notes.push(`Next step: ${next.nextStep}`);
  const unchanged = (["name", "kind", "status", "stage", "goal", "summary", "nextStep"] as const).every((key) => next[key] === current[key]);
  if (unchanged) return current;
  db.transaction(() => {
    db.prepare(`UPDATE projects SET name = ?, kind = ?, status = ?, stage = ?, goal = ?, summary = ?, next_step = ?,
      version = version + 1, updated_at = ? WHERE id = ?`).run(next.name, next.kind, next.status, next.stage, next.goal, next.summary, next.nextStep, now, id);
    for (const note of notes) writeItem(db, id, "log", note, opts.source, opts.sessionId ?? null, now);
  })();
  return getProject(db, id)!;
}

/**
 * Removes a project from the list at once. Its notes are Niko's and stay in
 * Notes; an empty folder the project had is tidied away. It can be brought back.
 */
export function removeProject(db: Db, id: string, now = Date.now()): Project {
  const current = getProject(db, id);
  if (!current || current.removedAt) throw new ProjectError("not_found", "That project doesn't exist or was already removed.");
  db.prepare("UPDATE projects SET removed_at = ?, version = version + 1, updated_at = ? WHERE id = ?").run(now, now, id);
  const folder = current.folderId ? getNoteFolder(db, current.folderId) : null;
  const shared = listProjects(db).some((project) => project.folderId === current.folderId);
  const hasChildren = folder ? listNoteFolders(db).some((other) => other.parentId === folder.id) : false;
  if (folder && !folder.builtIn && !shared && !hasChildren && folder.documentCount === 0
    && listNotes(db, { folderId: folder.id, includeArchived: true, limit: 1 }).length === 0) {
    try {
      if (deleteNoteFolder(db, folder.id, folder.version).ok) db.prepare("UPDATE projects SET folder_id = NULL WHERE id = ?").run(id);
    } catch { /* an empty folder left behind is harmless */ }
  }
  return getProject(db, id)!;
}

export function restoreProject(db: Db, id: string, now = Date.now()): Project {
  const current = getProject(db, id);
  if (!current || !current.removedAt) throw new ProjectError("not_found", "That project isn't removed.");
  const clash = listProjects(db).find((project) => project.name.toLowerCase() === current.name.toLowerCase());
  if (clash) throw new ProjectError("duplicate", `There is already a project called ${clash.name}.`);
  db.transaction(() => {
    const folderId = current.folderId ?? projectFolder(db, current.name);
    db.prepare("UPDATE projects SET removed_at = NULL, folder_id = ?, version = version + 1, updated_at = ? WHERE id = ?").run(folderId, now, id);
    writeItem(db, id, "log", "Brought back.", "app", null, now);
  })();
  return getProject(db, id)!;
}

function liveProject(db: Db, projectId: string): Project {
  const project = getProject(db, projectId);
  if (!project || project.removedAt) throw new ProjectError("not_found", "That project doesn't exist or was removed.");
  return project;
}

export function addProjectItem(db: Db, projectId: string, input: { kind: ProjectItemKind; text: string; source: ProjectSource; sessionId?: string | null }, now = Date.now()): ProjectItem {
  liveProject(db, projectId);
  if (!PROJECT_ITEM_KINDS.includes(input.kind)) throw new ProjectError("invalid", `Unknown item kind: ${String(input.kind)}`);
  const text = clean(input.text, 600);
  if (!text) throw new ProjectError("invalid", "It needs some text.");
  return writeItem(db, projectId, input.kind, text, input.source, input.sessionId ?? null, now);
}

export function getProjectItem(db: Db, id: string): ProjectItem | null {
  const row = db.prepare("SELECT * FROM project_items WHERE id = ?").get(id) as ItemRow | undefined;
  return row ? toItem(row) : null;
}

/** Ticks a step off (or back on), or rewords a step or question. Log lines are history and stay as written. */
export function updateProjectItem(db: Db, id: string, patch: { done?: boolean; text?: string }, opts: { source: ProjectSource; sessionId?: string | null }, now = Date.now()): ProjectItem {
  const item = getProjectItem(db, id);
  if (!item || item.kind === "log") throw new ProjectError("not_found", "That step or question doesn't exist.");
  liveProject(db, item.projectId);
  const text = patch.text === undefined ? item.text : clean(patch.text, 600);
  if (!text) throw new ProjectError("invalid", "It needs some text.");
  const doneAt = patch.done === undefined ? item.doneAt : patch.done ? item.doneAt ?? now : null;
  db.transaction(() => {
    db.prepare("UPDATE project_items SET text = ?, done_at = ?, updated_at = ? WHERE id = ?").run(text, doneAt, now, id);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, item.projectId);
    if (item.kind === "step" && doneAt && !item.doneAt) writeItem(db, item.projectId, "log", `Done: ${text}`, opts.source, opts.sessionId ?? null, now);
  })();
  return getProjectItem(db, id)!;
}

export function removeProjectItem(db: Db, id: string, now = Date.now()): void {
  const item = getProjectItem(db, id);
  if (!item || item.kind === "log") throw new ProjectError("not_found", "That step or question doesn't exist.");
  db.prepare("DELETE FROM project_items WHERE id = ?").run(id);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, item.projectId);
}

export function projectItems(db: Db, projectId: string): ProjectItem[] {
  return (db.prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY created_at, rowid").all(projectId) as ItemRow[]).map(toItem);
}

export function projectDetail(db: Db, id: string): ProjectDetail | null {
  const project = getProject(db, id);
  if (!project) return null;
  const items = projectItems(db, id);
  const folder = project.folderId ? getNoteFolder(db, project.folderId) : null;
  return {
    project,
    steps: items.filter((item) => item.kind === "step"),
    questions: items.filter((item) => item.kind === "question" && !item.doneAt),
    log: items.filter((item) => item.kind === "log").reverse().slice(0, 60),
    notes: folder ? listNotes(db, { folderId: folder.id, subtree: true, limit: 40 }) : [],
  };
}

/** The project's own conversation, created the first time it's needed. */
export function ensureProjectSession(db: Db, id: string): string {
  const project = liveProject(db, id);
  if (project.sessionId && db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(project.sessionId)) return project.sessionId;
  const session = createSession(db, { title: `Project: ${project.name}`, origin: "human" });
  db.prepare("UPDATE projects SET session_id = ? WHERE id = ?").run(session.id, id);
  return session.id;
}

export function projectForSession(db: Db, sessionId: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE session_id = ? AND removed_at IS NULL").get(sessionId) as Row | undefined;
  return row ? toProject(row) : null;
}

const KIND_LABEL: Record<ProjectKind, string> = { business: "business", build: "build", uni: "uni" };

/** What AVA reads before discussing a project: short, current, and in plain words. */
export function projectBrief(db: Db, project: Project): string {
  const detail = projectDetail(db, project.id);
  const open = detail?.steps.filter((step) => !step.doneAt) ?? [];
  const lines = [
    `Project “${project.name}” (${KIND_LABEL[project.kind]}, ${project.status}${project.stage ? `, stage: ${project.stage}` : ""}). id ${project.id}`,
    project.goal && `Goal: ${project.goal}`,
    project.summary && `Where it stands: ${project.summary}`,
    project.nextStep && `Next step: ${project.nextStep}`,
    open.length ? `Open steps:\n${open.slice(0, 10).map((step) => `- ${step.text} (${step.id})`).join("\n")}` : "",
    detail?.questions.length ? `Open questions:\n${detail.questions.slice(0, 8).map((question) => `- ${question.text} (${question.id})`).join("\n")}` : "",
    detail?.log.length ? `Latest progress:\n${detail.log.slice(0, 5).map((line) => `- ${new Date(line.createdAt).toISOString().slice(0, 10)}: ${line.text}`).join("\n")}` : "",
    detail?.notes.length ? `Notes in its folder: ${detail.notes.slice(0, 8).map((note) => note.title || "Untitled").join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
