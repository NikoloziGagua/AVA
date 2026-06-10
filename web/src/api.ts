import { getToken } from "./auth/tokens.js";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const r = await fetch(path, { ...init, headers });
  const text = await r.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!r.ok) {
    const msg = (body as { error?: string })?.error ?? `HTTP ${r.status}`;
    throw new ApiError(r.status, msg);
  }
  return body as T;
}

export const api = {
  pair: (code: string, label: string) =>
    request<{ token: string; deviceId: string }>("/api/auth/pair", {
      method: "POST",
      body: JSON.stringify({ code, label }),
    }),
  sendMessage: (sessionId: string | null, text: string, opts?: { voice?: boolean }) =>
    request<{ sessionId: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, text, voice: opts?.voice }),
    }),
  kill: (sessionId: string) =>
    request<{ aborted: boolean }>(`/api/chat/${sessionId}/kill`, { method: "POST" }),
  deleteSession: (sessionId: string) =>
    request<void>(`/api/sessions/${sessionId}`, { method: "DELETE" }),
  setSessionPinned: (sessionId: string, pinned: boolean) =>
    request<void>(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
};

export type SessionRow = {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  status: string;
  /** 1 when the chat is pinned to the "Important chats" strip, else 0. */
  pinned: number;
};

export async function fetchSessions(): Promise<SessionRow[]> {
  const j = await request<{ sessions: SessionRow[] }>("/api/sessions");
  return j.sessions;
}

export async function fetchSession(id: string): Promise<{
  session: SessionRow;
  messages: Array<{ id: number; role: string; content: string; created_at: number }>;
}> {
  return request<{
    session: SessionRow;
    messages: Array<{ id: number; role: string; content: string; created_at: number }>;
  }>(`/api/sessions/${id}`);
}

export async function fetchVapidPublicKey(): Promise<string> {
  const j = await request<{ key: string }>("/api/push/vapid-public");
  return j.key;
}

export async function registerPushSubscription(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel: string | null;
}): Promise<void> {
  await request<{ ok: true }>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type RuleRow = {
  id: string;
  source: string;
  parsed: string | null;
  enabled: number;
  status: "pending" | "active" | "failed";
  created_at: number;
  updated_at: number;
};

export async function fetchRules(): Promise<RuleRow[]> {
  const j = await request<{ rules: RuleRow[] }>("/api/rules");
  return j.rules;
}

export async function createRule(source: string): Promise<{ rule: RuleRow }> {
  return request<{ rule: RuleRow }>("/api/rules", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

export async function patchRule(id: string, enabled: boolean): Promise<void> {
  await request<{ ok: true }>(`/api/rules/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteRuleApi(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/rules/${id}`, { method: "DELETE" });
}

export async function approveApproval(id: string): Promise<void> {
  await request<{ ok: true; status: string }>(`/api/approvals/${id}/approve`, { method: "POST" });
}
export async function denyApproval(id: string): Promise<void> {
  await request<{ ok: true; status: string }>(`/api/approvals/${id}/deny`, { method: "POST" });
}

export type SuggestedChip = {
  id: string;
  source: "pinned" | "auto";
  label: string;
  prompt: string;
};

export type ChipOverrideRow = {
  id: string;
  device_id: string;
  label: string;
  prompt: string;
  pinned: 0 | 1;
  position: number;
  created_at: number;
  updated_at: number;
};

export async function fetchSuggestedChips(): Promise<SuggestedChip[]> {
  const j = await request<{ chips: SuggestedChip[] }>("/api/chips/suggested");
  return j.chips;
}

export async function fetchPinnedChips(): Promise<ChipOverrideRow[]> {
  const j = await request<{ chips: ChipOverrideRow[] }>("/api/chips");
  return j.chips;
}

export async function createPinnedChip(input: {
  label: string;
  prompt: string;
}): Promise<ChipOverrideRow> {
  const j = await request<{ chip: ChipOverrideRow }>("/api/chips", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return j.chip;
}

export async function updatePinnedChip(
  id: string,
  patch: { label?: string; prompt?: string; pinned?: boolean },
): Promise<ChipOverrideRow> {
  const j = await request<{ chip: ChipOverrideRow }>(`/api/chips/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return j.chip;
}

export async function deletePinnedChip(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/chips/${id}`, { method: "DELETE" });
}

export type ReasoningPref = { level: "fast" | "thorough"; supported: boolean };

export async function fetchReasoning(): Promise<ReasoningPref> {
  return request<ReasoningPref>("/api/reasoning");
}

export async function putReasoning(level: "fast" | "thorough"): Promise<void> {
  await request<{ level: string }>("/api/reasoning", {
    method: "PUT",
    body: JSON.stringify({ level }),
  });
}

// How Ava's voice is produced:
//   "openai"     — realtime model speaks (OpenAI) + /api/speak = OpenAI TTS.
//   "hume"   — Hume EVI ("Alice Bennett") speaks; needs HUME_API_KEY on the server.
export type VoiceEngine = "openai" | "hume";

export async function fetchVoiceEngine(): Promise<VoiceEngine> {
  const j = await request<{ engine: VoiceEngine }>("/api/voice/engine");
  return j.engine;
}

export async function setVoiceEngine(engine: VoiceEngine): Promise<void> {
  await request<{ engine: VoiceEngine }>("/api/voice/engine", {
    method: "POST",
    body: JSON.stringify({ engine }),
  });
}

export type MemoryView = {
  personality: string;
  memoryIndex: string;
  preferences: { lines: string[] };
  observations: {
    lines: Array<{
      raw: string;
      date: string;
      confidence: "low" | "medium" | "high";
      category: string;
      text: string;
      superseded: string | null;
    }>;
  };
  projects: Array<{ slug: string; body: string }>;
};

export async function fetchMemory(): Promise<MemoryView> {
  return request<MemoryView>("/api/memory");
}

export async function patchMemoryLine(input: {
  file: "preferences" | "observations";
  oldLine: string;
  newLine?: string;
}): Promise<{ ok: boolean; stale?: string }> {
  const headers = new Headers({ "content-type": "application/json" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const r = await fetch("/api/memory/lines", {
    method: "PATCH",
    headers,
    body: JSON.stringify(input),
  });
  if (r.status === 409) {
    const j = await r.json();
    return { ok: false, stale: j.current };
  }
  if (!r.ok) throw new ApiError(r.status, "patch_failed");
  return { ok: true };
}

export async function postMemoryLine(line: string): Promise<void> {
  await request<{ line: string }>("/api/memory/lines", {
    method: "POST",
    body: JSON.stringify({ file: "preferences", line }),
  });
}
