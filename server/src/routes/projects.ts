import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import {
  PROJECT_ITEM_KINDS, PROJECT_KINDS, PROJECT_STATUSES, ProjectError, addProjectItem, createProject, ensureProjectSession,
  listProjects, projectDetail, removeProject, removeProjectItem, removedProjects, restoreProject, updateProject, updateProjectItem,
} from "../projects/store.js";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120), kind: z.enum(PROJECT_KINDS),
  goal: z.string().max(400).optional(), stage: z.string().max(120).optional(),
}).strict();
const PatchBody = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().max(120).optional(), kind: z.enum(PROJECT_KINDS).optional(), status: z.enum(PROJECT_STATUSES).optional(),
  stage: z.string().max(120).optional(), goal: z.string().max(400).optional(), summary: z.string().max(1_200).optional(),
  nextStep: z.string().max(300).optional(),
}).strict();
const ItemBody = z.object({ kind: z.enum(PROJECT_ITEM_KINDS), text: z.string().trim().min(1).max(600) }).strict();
const ItemPatchBody = z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(600).optional() }).strict();

function fail(res: Response, error: unknown): void {
  if (error instanceof ProjectError) {
    res.status(error.code === "not_found" ? 404 : error.code === "invalid" ? 400 : 409).json({ error: error.code, message: error.message });
    return;
  }
  throw error;
}

/** The Projects tab. Every change here is Sir's own ("app"); AVA's come through its tools and the voice fast lane. */
export function projectRoutes(db: Db, auth: RequestHandler): Router {
  const r = Router();

  r.get("/", auth, (_req, res) => {
    res.json({ projects: listProjects(db), removed: removedProjects(db, 5), fetchedAt: Date.now() });
  });

  r.post("/", auth, (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    try { res.status(201).json({ project: createProject(db, { ...parsed.data, source: "app" }) }); } catch (error) { fail(res, error); }
  });

  r.get("/:id", auth, (req, res) => {
    const detail = projectDetail(db, String(req.params.id));
    if (!detail) { res.status(404).json({ error: "not_found" }); return; }
    res.json(detail);
  });

  r.patch("/:id", auth, (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    const { expectedVersion, ...patch } = parsed.data;
    try { res.json({ project: updateProject(db, String(req.params.id), patch, { expectedVersion, source: "app" }) }); } catch (error) { fail(res, error); }
  });

  r.post("/:id/remove", auth, (req, res) => {
    try { res.json({ project: removeProject(db, String(req.params.id)) }); } catch (error) { fail(res, error); }
  });

  r.post("/:id/restore", auth, (req, res) => {
    try { res.json({ project: restoreProject(db, String(req.params.id)) }); } catch (error) { fail(res, error); }
  });

  r.post("/:id/items", auth, (req, res) => {
    const parsed = ItemBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    try { res.status(201).json({ item: addProjectItem(db, String(req.params.id), { ...parsed.data, source: "app" }) }); } catch (error) { fail(res, error); }
  });

  r.patch("/:id/items/:itemId", auth, (req, res) => {
    const parsed = ItemPatchBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "bad_request" }); return; }
    try { res.json({ item: updateProjectItem(db, String(req.params.itemId), parsed.data, { source: "app" }) }); } catch (error) { fail(res, error); }
  });

  r.delete("/:id/items/:itemId", auth, (req, res) => {
    try { removeProjectItem(db, String(req.params.itemId)); res.json({ ok: true }); } catch (error) { fail(res, error); }
  });

  // The project's own conversation: created on first use, with its latest messages.
  r.post("/:id/conversation", auth, (req, res) => {
    try {
      const sessionId = ensureProjectSession(db, String(req.params.id));
      const messages = listMessages(db, sessionId).filter((message) => message.role === "user" || message.role === "assistant")
        .slice(-40).map((message) => ({ id: message.id, role: message.role, content: message.content, createdAt: message.created_at }));
      res.json({ sessionId, messages });
    } catch (error) { fail(res, error); }
  });

  return r;
}
