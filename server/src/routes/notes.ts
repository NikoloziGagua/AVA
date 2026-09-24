import { Router, type RequestHandler } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Db } from "../state/db.js";
import {
  NOTE_KINDS,
  NOTE_DOCUMENT_TYPES,
  NOTE_SECTIONS,
  NOTE_STATUSES,
  buildNoteActionPrompt,
  createNoteFolder,
  createNote,
  deleteNoteFolder,
  deleteNote,
  ensureNoteProject,
  getNoteFolder,
  getNote,
  listNoteFolders,
  listNoteProjects,
  listNotes,
  NoteHierarchyError,
  promoteNote,
  updateNoteFolder,
  updateNote,
  updateNoteProject,
  type Note,
} from "../state/notes.js";

const Link = z.object({
  label: z.string().max(80).default(""),
  url: z.string().max(2_048),
});

const CreateBody = z.object({
  title: z.string().max(160).nullish(),
  content: z.string().min(1).max(30_000),
  kind: z.enum(NOTE_KINDS).optional(),
  status: z.enum(NOTE_STATUSES).optional(),
  projectId: z.string().max(120).nullish(),
  project: z.string().max(80).nullish(),
  folderId: z.string().max(120).nullish(),
  documentType: z.enum(NOTE_DOCUMENT_TYPES).optional(),
  section: z.enum(NOTE_SECTIONS).optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  links: z.array(Link).max(20).optional(),
  pinned: z.boolean().optional(),
});

const PatchBody = CreateBody.partial().extend({
  expectedVersion: z.number().int().positive(),
});

const ProjectBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
});

const ProjectPatchBody = ProjectBody.partial().extend({
  expectedVersion: z.number().int().positive(),
});

const FolderCreateBody = z.object({
  parentId: z.string().max(120).nullable().optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  position: z.number().int().min(0).max(1_000_000).optional(),
});

const FolderPatchBody = FolderCreateBody.partial().extend({
  expectedVersion: z.number().int().positive(),
});

const PromoteBody = z.object({
  expectedVersion: z.number().int().positive(),
  target: z.enum(["task", "self_improvement"]),
});

function mutationFailure(
  res: import("express").Response,
  result: { reason: "not_found" | "version_conflict"; note: Note | null },
): void {
  if (result.reason === "not_found") {
    res.status(404).json({ error: "note_not_found" });
    return;
  }
  res.status(409).json({ error: "stale_version", note: result.note });
}

function hierarchyFailure(res: import("express").Response, error: unknown): void {
  if (!(error instanceof NoteHierarchyError)) {
    res.status(400).json({ error: "invalid_notes_request" });
    return;
  }
  const status = error.code === "not_found" ? 404
    : error.code === "stale_version" || error.code === "name_conflict" ||
      error.code === "folder_not_empty" || error.code === "invalid_move" ? 409
      : 400;
  res.status(status).json({ error: error.code, message: error.message });
}

function documentSummary(note: Note) {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folderId,
    folderPath: note.folderPath,
    documentType: note.documentType,
    kind: note.kind,
    status: note.status,
    pinned: note.pinned,
    version: note.version,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function notesRoutes(
  db: Db,
  auth: RequestHandler,
  deps: { queueSelfImprove?: (goal: string) => string | Promise<string> } = {},
): Router {
  const r = Router();

  r.get("/", auth, (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
    const kind = typeof req.query.kind === "string" && (NOTE_KINDS as readonly string[]).includes(req.query.kind)
      ? req.query.kind as typeof NOTE_KINDS[number]
      : undefined;
    const documentType = typeof req.query.documentType === "string" &&
      (NOTE_DOCUMENT_TYPES as readonly string[]).includes(req.query.documentType)
      ? req.query.documentType as typeof NOTE_DOCUMENT_TYPES[number]
      : undefined;
    const status = typeof req.query.status === "string" && (NOTE_STATUSES as readonly string[]).includes(req.query.status)
      ? req.query.status as typeof NOTE_STATUSES[number]
      : undefined;
    const section = typeof req.query.section === "string" && (NOTE_SECTIONS as readonly string[]).includes(req.query.section)
      ? req.query.section as typeof NOTE_SECTIONS[number]
      : undefined;
    const notes = listNotes(db, {
      q,
      projectId: projectId === "general" ? null : projectId,
      folderId,
      subtree: req.query.subtree === "true",
      documentType,
      kind,
      status,
      section,
      pinned: req.query.pinned === "true" ? true : undefined,
      includeArchived: req.query.includeArchived === "true",
    });
    res.json({ projects: listNoteProjects(db), notes });
  });

  r.get("/tree", auth, (_req, res) => {
    const fetchedAt = Date.now();
    const folders = listNoteFolders(db);
    const documents = listNotes(db, { includeArchived: true, limit: 500 });
    const totalDocuments = Number((db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n);
    const projects = listNoteProjects(db);
    const maxUpdatedAt = Math.max(0, ...folders.map((folder) => folder.updatedAt), ...documents.map((note) => note.updatedAt));
    res.json({
      folders,
      documents: documents.map(documentSummary),
      snapshot: {
        fetchedAt,
        version: `${maxUpdatedAt}:${folders.length}:${totalDocuments}`,
        complete: documents.length === totalDocuments,
        totalDocuments,
      },
      migration: {
        legacyProjectCount: projects.length,
        legacyRootFolderIds: projects.map((project) => project.id),
      },
    });
  });

  r.post("/folders", auth, (req, res) => {
    const parsed = FolderCreateBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request", details: parsed.error.flatten() }); return; }
    try {
      res.status(201).json({ folder: createNoteFolder(db, parsed.data) });
    } catch (error) { hierarchyFailure(res, error); }
  });

  r.patch("/folders/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const parsed = FolderPatchBody.safeParse(req.body);
    if (!id || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const { expectedVersion, ...patch } = parsed.data;
    try {
      const result = updateNoteFolder(db, id, expectedVersion, patch);
      if (!result.ok) {
        res.status(result.reason === "not_found" ? 404 : 409).json({
          error: result.reason === "version_conflict" ? "stale_version" : result.reason,
          folder: result.folder,
        });
        return;
      }
      res.json({ folder: result.folder });
    } catch (error) { hierarchyFailure(res, error); }
  });

  r.delete("/folders/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const expectedVersion = Number(req.query.expectedVersion);
    if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      res.status(400).json({ error: "bad_request" }); return;
    }
    try {
      const result = deleteNoteFolder(db, id, expectedVersion);
      if (!result.ok) {
        res.status(result.reason === "not_found" ? 404 : 409).json({
          error: result.reason === "version_conflict" ? "stale_version" : result.reason,
          folder: result.folder,
        });
        return;
      }
      res.json({ deleted: true });
    } catch (error) { hierarchyFailure(res, error); }
  });

  r.get("/:id", auth, (req, res, next) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    // Keep explicit collection routes authoritative even if Express ordering
    // changes during later UI work.
    if (id === "projects" || id === "folders" || id === "tree") { next(); return; }
    const note = getNote(db, id);
    if (!note) { res.status(404).json({ error: "note_not_found" }); return; }
    res.json({ note });
  });

  r.post("/projects", auth, (req, res) => {
    const parsed = ProjectBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request", details: parsed.error.flatten() }); return; }
    try {
      const result = ensureNoteProject(db, parsed.data.name, parsed.data.description);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      res.status(400).json({ error: "invalid_project", message: error instanceof Error ? error.message : String(error) });
    }
  });

  r.patch("/projects/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const parsed = ProjectPatchBody.safeParse(req.body);
    if (!id || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const { expectedVersion, ...patch } = parsed.data;
    const result = updateNoteProject(db, id, expectedVersion, patch);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : 409;
      res.status(status).json({ error: result.reason === "version_conflict" ? "stale_version" : result.reason, project: result.project });
      return;
    }
    res.json({ project: result.project });
  });

  r.post("/", auth, (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request", details: parsed.error.flatten() }); return; }
    try {
      const project = parsed.data.folderId === undefined && parsed.data.project?.trim() && !/^general$/i.test(parsed.data.project.trim())
        ? ensureNoteProject(db, parsed.data.project).project
        : null;
      const note = createNote(db, {
        ...parsed.data,
        projectId: project?.id ?? parsed.data.projectId,
        source: "manual",
      });
      res.status(201).json({ note, projects: listNoteProjects(db) });
    } catch (error) {
      if (error instanceof NoteHierarchyError) { hierarchyFailure(res, error); return; }
      res.status(400).json({ error: "invalid_note", message: error instanceof Error ? error.message : String(error) });
    }
  });

  r.patch("/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const parsed = PatchBody.safeParse(req.body);
    if (!id || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const { expectedVersion, project, ...patch } = parsed.data;
    try {
      const projectId = patch.folderId === undefined && project?.trim() ? ensureNoteProject(db, project).project.id : patch.projectId;
      const result = updateNote(db, id, expectedVersion, { ...patch, ...(projectId !== undefined ? { projectId } : {}) });
      if (!result.ok) { mutationFailure(res, result); return; }
      res.json({ note: result.note, projects: listNoteProjects(db) });
    } catch (error) {
      if (error instanceof NoteHierarchyError) { hierarchyFailure(res, error); return; }
      res.status(400).json({ error: "invalid_note", message: error instanceof Error ? error.message : String(error) });
    }
  });

  r.delete("/:id", auth, (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const version = Number(req.query.version);
    if (!id || !Number.isInteger(version) || version < 1) { res.status(400).json({ error: "bad_request" }); return; }
    const result = deleteNote(db, id, version);
    if (!result.ok) { mutationFailure(res, result); return; }
    res.json({ ok: true });
  });

  r.post("/:id/promote", auth, async (req, res) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    const parsed = PromoteBody.safeParse(req.body);
    if (!id || !parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const current = getNote(db, id);
    if (!current) { res.status(404).json({ error: "note_not_found" }); return; }
    if (current.version !== parsed.data.expectedVersion) {
      res.status(409).json({ error: "stale_version", note: current });
      return;
    }

    let promotionId: string;
    let prompt: string | null = null;
    try {
      if (parsed.data.target === "self_improvement") {
        if (!deps.queueSelfImprove) { res.status(503).json({ error: "self_improvement_unavailable" }); return; }
        promotionId = await deps.queueSelfImprove(buildNoteActionPrompt(current));
      } else {
        promotionId = `task_draft_${nanoid(10)}`;
        prompt = buildNoteActionPrompt(current);
      }
    } catch (error) {
      res.status(409).json({ error: "promotion_unavailable", message: error instanceof Error ? error.message : String(error) });
      return;
    }

    const result = promoteNote(db, id, parsed.data.expectedVersion, parsed.data.target, promotionId);
    if (!result.ok) { mutationFailure(res, result); return; }
    res.json({ note: result.note, promotionId, prompt });
  });

  return r;
}
