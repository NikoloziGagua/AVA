import { ApiError, request } from "../api.js";
import { getToken } from "../auth/tokens.js";

/** Sir's projects (server/src/routes/projects.ts). */
export type ProjectKind = "business" | "build" | "uni";
export type ProjectStatus = "active" | "paused" | "done";
export type Project = {
  id: string; name: string; kind: ProjectKind; status: ProjectStatus; stage: string; goal: string;
  summary: string; nextStep: string; folderId: string | null; sessionId: string | null;
  version: number; createdAt: number; updatedAt: number; removedAt: number | null;
};
export type ProjectItem = {
  id: string; projectId: string; kind: "step" | "question" | "log"; text: string; doneAt: number | null;
  source: "app" | "chat" | "voice" | "ava"; createdAt: number;
};
export type ProjectNote = { id: string; title: string; content: string; updatedAt: number };
export type ProjectDetail = { project: Project; steps: ProjectItem[]; questions: ProjectItem[]; log: ProjectItem[]; notes: ProjectNote[]; materials?: Material[] };
export type ProjectMessage = { id: number; role: "user" | "assistant"; content: string; createdAt: number };
export type ProjectPatch = Partial<Pick<Project, "name" | "kind" | "status" | "stage" | "goal" | "summary" | "nextStep">>;

const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const at = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const fetchProjects = () => request<{ projects: Project[]; removed: Project[]; fetchedAt: number }>("/api/projects");
export const fetchProject = (id: string) => request<ProjectDetail>(at(id));
export const createProject = (name: string, kind: ProjectKind) =>
  request<{ project: Project }>("/api/projects", post({ name, kind })).then((body) => body.project);
export const updateProject = (project: Project, patch: ProjectPatch) =>
  request<{ project: Project }>(at(project.id), { method: "PATCH", body: JSON.stringify({ expectedVersion: project.version, ...patch }) }).then((body) => body.project);
export const removeProject = (id: string) => request<{ project: Project }>(`${at(id)}/remove`, post()).then((body) => body.project);
export const restoreProject = (id: string) => request<{ project: Project }>(`${at(id)}/restore`, post()).then((body) => body.project);
export const addItem = (id: string, kind: ProjectItem["kind"], text: string) =>
  request<{ item: ProjectItem }>(`${at(id)}/items`, post({ kind, text })).then((body) => body.item);
export const updateItem = (item: ProjectItem, patch: { done?: boolean; text?: string }) =>
  request<{ item: ProjectItem }>(`${at(item.projectId)}/items/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify(patch) }).then((body) => body.item);
export const deleteItem = (item: ProjectItem) =>
  request<{ ok: true }>(`${at(item.projectId)}/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
export const openConversation = (id: string) => request<{ sessionId: string; messages: ProjectMessage[] }>(`${at(id)}/conversation`, post());

/** Photos, files and links dropped into a project, with what AVA took from each. */
export type Material = {
  id: string; projectId: string; kind: "photo" | "file" | "link"; title: string; url: string | null; fileName: string | null;
  mime: string | null; size: number | null; status: "pending" | "ready" | "failed"; takeaways: string; createdAt: number;
};
export const addLinkMaterial = (id: string, url: string) =>
  request<{ material: Material }>(`${at(id)}/materials/link`, post({ url })).then((body) => body.material);
export const deleteMaterial = (material: Material) =>
  request<{ ok: true }>(`${at(material.projectId)}/materials/${encodeURIComponent(material.id)}`, { method: "DELETE" });
export const materialFileUrl = (material: Material) =>
  `${at(material.projectId)}/materials/${encodeURIComponent(material.id)}/file?t=${encodeURIComponent(getToken() ?? "")}`;

/** Sends the file as-is (not JSON), named in a header. */
export async function uploadMaterial(id: string, file: File): Promise<Material> {
  const headers = new Headers({ "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(`${at(id)}/materials/upload`, { method: "POST", headers, body: file }); }
  catch { throw new ApiError(0, "AVA's server can't be reached. Try again.", "server_unreachable"); }
  const body = await response.json().catch(() => ({})) as { material?: Material; error?: string; message?: string };
  if (!response.ok || !body.material) throw new ApiError(response.status, body.message ?? (response.status === 413 ? "Files can be up to 20 MB." : "That file couldn't be added."), body.error ?? "upload_failed");
  return body.material;
}
