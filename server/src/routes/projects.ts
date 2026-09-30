import express, { Router, type RequestHandler, type Response } from "express";
import { existsSync } from "node:fs";
import type OpenAI from "openai";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import {
  PROJECT_ITEM_KINDS, PROJECT_KINDS, PROJECT_STATUSES, ProjectError, addProjectItem, createProject, ensureProjectSession,
  listProjects, projectDetail, removeProject, removeProjectItem, removedProjects, restoreProject, updateProject, updateProjectItem,
} from "../projects/store.js";
import { MAX_MATERIAL_BYTES, addFile, addLink, getMaterial, listMaterials, materialPath, removeMaterial, type Material } from "../projects/materials.js";
import { extractMaterial } from "../projects/extract.js";

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
export function projectRoutes(db: Db, auth: RequestHandler, deps: { dataDir?: string; openai?: OpenAI | null } = {}): Router {
  const r = Router();
  // Reading runs after the reply, so dropping something in never waits on the model.
  const read = (material: Material) => { if (deps.dataDir) void extractMaterial({ db, dataDir: deps.dataDir, openai: deps.openai ?? null }, material); };

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
    res.json({ ...detail, materials: listMaterials(db, detail.project.id) });
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

  r.post("/:id/materials/link", auth, (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url : "";
    try { const material = addLink(db, String(req.params.id), { url, source: "app" }); read(material); res.status(201).json({ material }); }
    catch (error) { fail(res, error); }
  });

  r.post("/:id/materials/upload", auth, express.raw({ type: () => true, limit: MAX_MATERIAL_BYTES }), (req, res) => {
    if (!deps.dataDir) { res.status(503).json({ error: "unavailable" }); return; }
    const header = req.headers["x-file-name"];
    let name = "upload";
    try { name = decodeURIComponent(typeof header === "string" ? header : "upload"); } catch { /* keep the default */ }
    try {
      const material = addFile(db, deps.dataDir, String(req.params.id), {
        name, mime: String(req.headers["content-type"] ?? ""), bytes: Buffer.isBuffer(req.body) ? req.body : req.body && typeof req.body === "object" && Object.keys(req.body).length ? Buffer.from(JSON.stringify(req.body)) : Buffer.alloc(0), source: "app",
      });
      read(material);
      res.status(201).json({ material });
    } catch (error) { fail(res, error); }
  });

  r.get("/:id/materials/:materialId/file", auth, (req, res) => {
    const material = getMaterial(db, String(req.params.materialId));
    const path = material?.mime && deps.dataDir ? materialPath(deps.dataDir, material) : null;
    if (!material || material.projectId !== req.params.id || !path || !existsSync(path)) { res.status(404).json({ error: "not_found" }); return; }
    res.setHeader("content-type", material.mime!);
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "private, max-age=86400");
    res.sendFile(path);
  });

  r.delete("/:id/materials/:materialId", auth, (req, res) => {
    const material = getMaterial(db, String(req.params.materialId));
    if (!material || material.projectId !== req.params.id) { res.status(404).json({ error: "not_found" }); return; }
    try { removeMaterial(db, deps.dataDir ?? "", material.id); res.json({ ok: true }); } catch (error) { fail(res, error); }
  });

  return r;
}
