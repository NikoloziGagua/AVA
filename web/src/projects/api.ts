import { request } from "../api.js";

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
export type ProjectDetail = { project: Project; steps: ProjectItem[]; questions: ProjectItem[]; log: ProjectItem[]; notes: ProjectNote[] };
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
