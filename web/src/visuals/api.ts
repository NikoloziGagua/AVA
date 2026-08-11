import { ApiError } from "../api.js";
import { clearToken, getToken } from "../auth/tokens.js";

export type VisualNodeShape = "process" | "decision" | "terminal";
export type VisualEdgeStyle = "flow" | "dotted" | "strong";

export type VisualTopology = {
  direction: "TD" | "TB" | "LR" | "RL" | "BT";
  nodes: Array<{ id: string; label: string; shape: VisualNodeShape }>;
  edges: Array<{ from: string; to: string; label: string | null; style: VisualEdgeStyle }>;
};

export type VisualScene = {
  id: string;
  title: string;
  caption: string;
  nodeIds: string[];
  highlightNodeIds: string[];
  transition: "none" | "fade" | "slide";
  interactionCue?: string;
};

export type VisualExplanation = {
  id: string;
  schemaVersion: "1.0";
  title: string;
  summary: string;
  mermaid: string;
  storyboard: { schemaVersion: "1.0"; startSceneId: string; scenes: VisualScene[] };
  topology: VisualTopology;
  source: "manual" | "ava_chat" | "ava_voice";
  sourceSessionId: string | null;
  sourceRunId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
};

const CACHE_KEY = "ava.visual-explanations.cache.v1";
const CACHE_LIMIT = 20;

function isVisual(value: unknown): value is VisualExplanation {
  if (!value || typeof value !== "object") return false;
  const visual = value as Partial<VisualExplanation>;
  return typeof visual.id === "string"
    && visual.schemaVersion === "1.0"
    && typeof visual.mermaid === "string"
    && !!visual.storyboard
    && Array.isArray(visual.storyboard.scenes)
    && !!visual.topology
    && Array.isArray(visual.topology.nodes);
}

export function readCachedVisuals(): VisualExplanation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isVisual).slice(0, CACHE_LIMIT) : [];
  } catch { return []; }
}

export function cacheVisuals(visuals: VisualExplanation[]): void {
  try {
    const merged = new Map<string, VisualExplanation>();
    for (const visual of [...visuals, ...readCachedVisuals()]) {
      if (isVisual(visual) && !merged.has(visual.id)) merged.set(visual.id, visual);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify([...merged.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CACHE_LIMIT)));
  } catch { /* cache quota/private mode: online viewer still works */ }
}

async function visualRequest<T>(path: string): Promise<T> {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let response: Response;
  try { response = await fetch(path, { headers }); }
  catch {
    throw new ApiError(0, "AVA's server is unreachable.", "server_unreachable", "Use a cached visual or restart AVA.", path);
  }
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      window.dispatchEvent(new Event("ava:unauthorized"));
    }
    throw new ApiError(response.status, body.message ?? body.error ?? `Visuals returned HTTP ${response.status}.`, body.error ?? `http_${response.status}`, null, path);
  }
  return body as T;
}

export async function fetchVisualExplanations(): Promise<VisualExplanation[]> {
  const result = await visualRequest<{ visuals: VisualExplanation[] }>("/api/visual-explanations?limit=40");
  cacheVisuals(result.visuals);
  return result.visuals;
}

export async function fetchVisualExplanation(id: string): Promise<VisualExplanation> {
  const result = await visualRequest<{ visual: VisualExplanation }>(`/api/visual-explanations/${encodeURIComponent(id)}`);
  cacheVisuals([result.visual]);
  return result.visual;
}

