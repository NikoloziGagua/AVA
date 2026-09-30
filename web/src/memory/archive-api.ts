import { ApiError, request } from "../api.js";

/** Memory v2 as the Memory tab sees it (server/src/routes/memory-archive.ts). */
export type MemoryKind = "fact" | "person" | "project" | "decision" | "commitment" | "preference" | "event";
export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  topic: string;
  text: string;
  speechAct: "stated" | "decided" | "requested" | "discussed" | "inferred";
  status: "active" | "history" | "unconfirmed";
  /** False: kept, but AVA only uses it when asked ("stop bringing it up"). */
  carry: boolean;
  sensitive: boolean;
  confidence: "high" | "medium" | "low";
  origin: "explicit" | "conversation" | "backfill" | "migration";
  /** When Niko said it, not when it was stored. */
  saidAt: number;
  validTo: number | null;
  dueAt: number | null;
  supersedesId: string | null;
  supersededById: string | null;
  hasSources: boolean;
  version: number;
};
export type MemoryEvent = {
  seq: number;
  recordId: string;
  action: "added" | "updated" | "ended" | "stopped_carrying" | "carried" | "confirmed" | "forgotten";
  actor: string;
  /** Null once forgotten: the feed keeps that something was forgotten, never what. */
  summary: string | null;
  createdAt: number;
};
export type MemoryOverview = {
  enabled: boolean;
  fetchedAt: number;
  /** Current and waiting records, oldest first. */
  records: MemoryItem[];
  /** Replaced and ended records, most recently ended first. */
  history: MemoryItem[];
  events: MemoryEvent[];
  counts: { active: number; history: number; unconfirmed: number; forgotten: number };
};
export type MemorySource = { id: number; sessionId: string; speaker: "niko" | "ava"; text: string; at: number };
export type MemoryDetail = { record: MemoryItem; chain: MemoryItem[]; sources: MemorySource[] };

const BASE = "/api/memory/archive";
const at = (id: string, action?: string) => `${BASE}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export async function fetchMemoryOverview(): Promise<MemoryOverview> {
  const body = await request<MemoryOverview>(BASE);
  if (!body || !Array.isArray(body.records) || !Array.isArray(body.history) || !Array.isArray(body.events)) {
    throw new ApiError(502, "Memory sent back something unreadable. Refresh to try again.", "invalid_response", null, BASE);
  }
  return body;
}

export const fetchMemoryDetail = (id: string) => request<MemoryDetail>(at(id));

export async function searchMemory(query: string): Promise<MemoryItem[]> {
  const body = await request<{ query: string; hits: MemoryItem[] }>(`${BASE}/search?q=${encodeURIComponent(query)}`);
  return Array.isArray(body?.hits) ? body.hits : [];
}

// Every change names the version on screen, so one AVA made meanwhile is refused, never overwritten.
export const correctMemory = (item: MemoryItem, text: string) =>
  request<{ record: MemoryItem }>(at(item.id, "correct"), post({ expectedVersion: item.version, text })).then((body) => body.record);
export const setMemoryCarry = (item: MemoryItem, carry: boolean) =>
  request<{ record: MemoryItem }>(at(item.id, "carry"), post({ expectedVersion: item.version, carry })).then((body) => body.record);
export const confirmMemory = (item: MemoryItem) =>
  request<{ record: MemoryItem }>(at(item.id, "confirm"), post({ expectedVersion: item.version })).then((body) => body.record);
export const forgetMemory = (item: MemoryItem) =>
  request<{ ok: true; forgotten: number }>(at(item.id, "forget"), post({ expectedVersion: item.version }));

const MESSAGES: Record<string, string> = {
  stale_version: "This changed since you opened it, so nothing was saved. Showing the latest now.",
  wrong_state: "This was already replaced, so nothing was saved. Showing the latest now.",
  memory_not_found: "That memory is gone. It may have just been forgotten.",
  bad_request: "That couldn't be saved. A memory needs some text.",
};

/** A plain sentence for a failed change, and whether the screen must reload before another try. */
export function memoryFailure(error: unknown): { message: string; reload: boolean } {
  if (error instanceof ApiError) {
    return { message: MESSAGES[error.code] ?? error.message, reload: error.code !== "bad_request" };
  }
  return { message: "Something went wrong, so nothing was changed. Refresh to try again.", reload: true };
}
