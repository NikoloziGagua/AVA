import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { ProjectError, getProject, type ProjectSource } from "./store.js";

export type MaterialKind = "photo" | "file" | "link";
export type Material = {
  id: string; projectId: string; kind: MaterialKind; title: string; url: string | null; fileName: string | null;
  mime: string | null; size: number | null; status: "pending" | "ready" | "failed"; takeaways: string;
  source: ProjectSource; createdAt: number; updatedAt: number;
};
type Row = {
  id: string; project_id: string; kind: string; title: string; url: string | null; file_name: string | null; mime: string | null;
  size: number | null; status: string; takeaways: string; source: string; created_at: number; updated_at: number;
};
const toMaterial = (row: Row): Material => ({
  id: row.id, projectId: row.project_id, kind: row.kind as MaterialKind, title: row.title, url: row.url, fileName: row.file_name,
  mime: row.mime, size: row.size, status: row.status as Material["status"], takeaways: row.takeaways, source: row.source as ProjectSource,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;
/** Photos AVA can look at, and documents she can read. */
export const MATERIAL_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "application/pdf": ".pdf", "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv", "application/json": ".json",
};

/** Files live under data/projects/<project id>/, named by material id; never by the uploaded name. */
export const materialPath = (dataDir: string, material: Pick<Material, "id" | "projectId" | "mime">) =>
  join(dataDir, "projects", material.projectId, `${material.id}${MATERIAL_TYPES[material.mime ?? ""] ?? ""}`);

function liveProject(db: Db, projectId: string): void {
  const project = getProject(db, projectId);
  if (!project || project.removedAt) throw new ProjectError("not_found", "That project doesn't exist or was removed.");
}

export function getMaterial(db: Db, id: string): Material | null {
  const row = db.prepare("SELECT * FROM project_materials WHERE id = ?").get(id) as Row | undefined;
  return row ? toMaterial(row) : null;
}

export function listMaterials(db: Db, projectId: string): Material[] {
  return (db.prepare("SELECT * FROM project_materials WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as Row[]).map(toMaterial);
}

// Links AVA fetches must be ordinary public web pages, never this machine or its network.
const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|.*\.ts\.net|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[.*\])$/i;
export function publicUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || PRIVATE_HOST.test(url.hostname) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

export function addLink(db: Db, projectId: string, input: { url: string; source: ProjectSource }, now = Date.now()): Material {
  liveProject(db, projectId);
  const url = publicUrl(input.url);
  if (!url) throw new ProjectError("invalid", "That isn't a public web link.");
  const id = `pmat_${nanoid(12)}`;
  db.prepare(`INSERT INTO project_materials (id, project_id, kind, title, url, status, source, created_at, updated_at)
    VALUES (?, ?, 'link', ?, ?, 'pending', ?, ?, ?)`).run(id, projectId, url.hostname.replace(/^www\./, ""), url.href, input.source, now, now);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
  return getMaterial(db, id)!;
}

export function addFile(db: Db, dataDir: string, projectId: string, input: { name: string; mime: string; bytes: Buffer; source: ProjectSource }, now = Date.now()): Material {
  liveProject(db, projectId);
  const mime = input.mime.split(";")[0]!.trim().toLowerCase();
  if (!MATERIAL_TYPES[mime]) throw new ProjectError("invalid", "AVA can take photos (JPEG, PNG, WebP, GIF), PDFs and text files.");
  if (!input.bytes.length || input.bytes.length > MAX_MATERIAL_BYTES) throw new ProjectError("invalid", "Files can be up to 20 MB.");
  const id = `pmat_${nanoid(12)}`;
  const name = input.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || `upload${MATERIAL_TYPES[mime]}`;
  const kind: MaterialKind = mime.startsWith("image/") ? "photo" : "file";
  const path = materialPath(dataDir, { id, projectId, mime });
  mkdirSync(join(dataDir, "projects", projectId), { recursive: true });
  writeFileSync(path, input.bytes);
  try {
    db.prepare(`INSERT INTO project_materials (id, project_id, kind, title, file_name, mime, size, status, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(
      id, projectId, kind, name.slice(0, name.length - extname(name).length) || name, name, mime, input.bytes.length, input.source, now, now);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
  return getMaterial(db, id)!;
}

export function finishMaterial(db: Db, id: string, result: { status: "ready" | "failed"; takeaways: string; title?: string }, now = Date.now()): Material | null {
  const current = getMaterial(db, id);
  if (!current) return null;
  db.prepare("UPDATE project_materials SET status = ?, takeaways = ?, title = ?, updated_at = ? WHERE id = ?")
    .run(result.status, result.takeaways.slice(0, 2_000), (result.title?.trim() || current.title).slice(0, 160), now, id);
  return getMaterial(db, id);
}

export function removeMaterial(db: Db, dataDir: string, id: string): void {
  const material = getMaterial(db, id);
  if (!material) throw new ProjectError("not_found", "That item is already gone.");
  db.prepare("DELETE FROM project_materials WHERE id = ?").run(id);
  if (material.mime) rmSync(materialPath(dataDir, material), { force: true });
}
