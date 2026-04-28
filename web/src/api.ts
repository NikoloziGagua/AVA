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
  sendMessage: (sessionId: string | null, text: string) =>
    request<{ sessionId: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, text }),
    }),
  kill: (sessionId: string) =>
    request<{ aborted: boolean }>(`/api/chat/${sessionId}/kill`, { method: "POST" }),
};

export type SessionRow = {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  status: string;
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
