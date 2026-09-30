import { ApiError } from "../api.js";
import { clearToken, getToken } from "../auth/tokens.js";
import { isVisualMessage, type VisualMessage } from "./types.js";

export type { VisualMessage, VisualMessageContext, VisualMessageReference, VisualScene } from "./types.js";

const CACHE_KEY = "ava.visual-messages.cache.v2";
const LEGACY_CACHE_KEY = "ava.visual-explanations.cache.v1";
const CACHE_LIMIT = 20;

function normalizeLegacy(value: unknown): VisualMessage | null {
  if (!value || typeof value !== "object") return null;
  const legacy = value as any;
  if (typeof legacy.id !== "string" || !legacy.topology || !legacy.storyboard || typeof legacy.mermaid !== "string") return null;
  const visual: VisualMessage = {
    schemaVersion: "1.0",
    visualMessageId: legacy.id,
    revision: Number.isInteger(legacy.version) ? legacy.version : 1,
    diagramKind: "flowchart",
    title: String(legacy.title ?? "Visual explanation"),
    summary: String(legacy.summary ?? "Visual explanation"),
    semanticModel: {
      direction: legacy.topology.direction,
      elements: (legacy.topology.nodes ?? []).map((node: any) => ({ id: node.id, label: node.label, kind: node.shape })),
      relationships: (legacy.topology.edges ?? []).map((edge: any, index: number) => ({
        id: `legacy_rel_${index + 1}`,
        from: edge.from,
        to: edge.to,
        label: edge.label ?? null,
        kind: edge.style,
      })),
    },
    storyboard: legacy.storyboard,
    renderer: { renderer: "mermaid", rendererSchemaVersion: "1.0", generatedFrom: "semantic_model", payload: legacy.mermaid },
    accessibleFallback: {
      heading: String(legacy.title ?? "Visual explanation"),
      summary: String(legacy.summary ?? "Visual explanation"),
      elements: (legacy.topology.nodes ?? []).map((node: any) => ({ id: node.id, label: node.label, kind: node.shape })),
      relationships: (legacy.topology.edges ?? []).map((edge: any, index: number) => ({ id: `legacy_rel_${index + 1}`, text: `${edge.from} leads to ${edge.to}` })),
      scenes: (legacy.storyboard.scenes ?? []).map((scene: any) => ({ id: scene.id, title: scene.title, caption: scene.caption })),
    },
    source: legacy.source ?? "manual",
    sourceSessionId: legacy.sourceSessionId ?? null,
    sourceRunId: legacy.sourceRunId ?? null,
    createdAt: legacy.updatedAt ?? legacy.createdAt ?? Date.now(),
  };
  return isVisualMessage(visual) ? visual : null;
}

function normalize(value: unknown): VisualMessage | null {
  return isVisualMessage(value) ? value : normalizeLegacy(value);
}

export function readCachedVisuals(): VisualMessage[] {
  try {
    const current = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as unknown;
    const legacy = JSON.parse(localStorage.getItem(LEGACY_CACHE_KEY) ?? "[]") as unknown;
    const merged = new Map<string, VisualMessage>();
    for (const candidate of [
      ...(Array.isArray(current) ? current : []),
      ...(Array.isArray(legacy) ? legacy : []),
    ]) {
      const visual = normalize(candidate);
      if (!visual) continue;
      const key = `${visual.visualMessageId}:${visual.revision}`;
      if (!merged.has(key)) merged.set(key, visual);
    }
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, CACHE_LIMIT);
  } catch { return []; }
}

export function cacheVisuals(visuals: VisualMessage[]): void {
  try {
    const merged = new Map<string, VisualMessage>();
    for (const candidate of [...visuals, ...readCachedVisuals()]) {
      const visual = normalize(candidate);
      if (!visual) continue;
      const key = `${visual.visualMessageId}:${visual.revision}`;
      if (!merged.has(key)) merged.set(key, visual);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify([...merged.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, CACHE_LIMIT)));
  } catch { /* cache quota/private mode: online rendering still works */ }
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

function requireVisual(value: unknown): VisualMessage {
  const visual = normalize(value);
  if (!visual) throw new ApiError(500, "AVA returned an invalid visual message.", "invalid_visual_message");
  return visual;
}

export async function fetchVisualExplanations(): Promise<VisualMessage[]> {
  const result = await visualRequest<{ visuals: unknown[] }>("/api/visual-explanations?limit=40");
  const visuals = result.visuals.map(requireVisual);
  cacheVisuals(visuals);
  return visuals;
}

export async function fetchVisualExplanation(id: string, revision?: number): Promise<VisualMessage> {
  const query = revision ? `?revision=${revision}` : "";
  const result = await visualRequest<{ visual: unknown }>(`/api/visual-explanations/${encodeURIComponent(id)}${query}`);
  const visual = requireVisual(result.visual);
  cacheVisuals([visual]);
  return visual;
}
