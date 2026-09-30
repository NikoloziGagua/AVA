import { getToken, clearToken } from "./auth/tokens.js";
import { receiptFor } from "./reminders/presenter.js";
import type { VisualMessage, VisualMessageContext } from "./visuals/types.js";
import type { MemoryContext } from "./chat/memory-context.js";
import type { SavedItems } from "./chat/saved-items.js";
import type { RoomPosts } from "./chat/room-posts.js";
import { mirrorLookPref } from "./design/look.js";
import { setMotionPref } from "./lib/motionPref.js";

export class ApiError extends Error {
  readonly name = "ApiError";
  /** A bounded validation code from the body, e.g. `{error:"bad_request", reasonCode}`. */
  reasonCode: string | null = null;
  /** The parsed JSON failure body, e.g. the current version a 409 reports. */
  detail: unknown = null;

  constructor(
    public status: number,
    message: string,
    public code: string = status === 0 ? "server_unreachable" : "http_error",
    public action: string | null = null,
    public path: string | null = null,
  ) {
    super(message);
  }
}

type ApiFailureBody = {
  error?: string;
  reasonCode?: unknown;
  message?: string;
  action?: string;
  retryable?: boolean;
};

/**
 * Central 401 recovery: an expired/invalid token must be cleared and the shell
 * notified so it can route back to pairing. The event name is a cross-agent
 * contract — App.tsx listens for exactly `ava:unauthorized` and setPaired(false).
 * We only clear the token + dispatch; we never navigate here.
 */
function handleUnauthorized(): void {
  clearToken();
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event("ava:unauthorized"));
  }
}

/** The authenticated JSON request every AVA API call shares. */
export async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers });
  } catch {
    const action = "Start or restart the AVA Desktop Runtime, then try again.";
    throw new ApiError(
      0,
      `AVA's server is unreachable. ${action}`,
      "server_unreachable",
      action,
      path,
    );
  }
  const text = await r.text();
  let body: unknown;
  let parsedJson = false;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
      parsedJson = true;
    } catch {
      body = undefined;
    }
  }
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    const failure =
      parsedJson && body && typeof body === "object"
        ? body as ApiFailureBody
        : {};
    const staleExplorer =
      path.startsWith("/api/explorer") &&
      r.status === 404 &&
      (!parsedJson || failure.error === "api_route_not_found");
    if (staleExplorer) {
      const action =
        failure.action ??
        "Rebuild and restart the AVA Desktop Runtime, then refresh Explorer.";
      throw new ApiError(
        r.status,
        `Explorer is not available in the running AVA server. The interface and server builds do not match. ${action}`,
        "explorer_api_unavailable",
        action,
        path,
      );
    }
    const code = failure.error ?? `http_${r.status}`;
    const action = failure.action ?? null;
    const message = failure.message ?? failure.error ?? `AVA API returned HTTP ${r.status}.`;
    const error = new ApiError(
      r.status,
      action ? `${message} ${action}` : message,
      code,
      action,
      path,
    );
    if (typeof failure.reasonCode === "string" && /^[a-z0-9_]{1,64}$/.test(failure.reasonCode)) {
      error.reasonCode = failure.reasonCode;
    }
    if (parsedJson) error.detail = body;
    throw error;
  }
  if (text && !parsedJson) {
    const action =
      path.startsWith("/api/explorer")
        ? "Restart the AVA Desktop Runtime so the Explorer API and interface use the same build."
        : "Restart the AVA Desktop Runtime and retry the request.";
    throw new ApiError(
      r.status,
      `AVA returned a non-JSON response where API data was expected. ${action}`,
      "invalid_api_response",
      action,
      path,
    );
  }
  return body as T;
}

/**
 * Upload one bounded browser recording for speech-to-text dictation.
 *
 * This deliberately does not use the JSON request helper: the browser must set
 * the multipart boundary itself. The result is text only; callers decide
 * whether to place it in a draft, and this function never submits a chat turn.
 */
export async function transcribeAudio(audio: Blob, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  const mime = audio.type.split(";", 1)[0]?.toLowerCase() || "audio/webm";
  const extension = mime === "audio/ogg" ? "ogg"
    : mime === "audio/mp4" || mime === "audio/m4a" || mime === "audio/x-m4a" ? "m4a"
      : mime === "audio/mpeg" ? "mp3"
        : mime === "audio/wav" || mime === "audio/x-wav" ? "wav"
          : "webm";
  form.append("audio", audio, `dictation.${extension}`);

  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch("/api/transcribe", {
      method: "POST",
      headers,
      body: form,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const action = "Check AVA's connection and try dictation again.";
    throw new ApiError(0, `AVA could not transcribe the recording. ${action}`, "server_unreachable", action, "/api/transcribe");
  }

  const raw = await response.text();
  let body: { text?: unknown; error?: unknown } = {};
  try { body = raw ? JSON.parse(raw) as typeof body : {}; } catch { /* handled below */ }
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized();
    const message = typeof body.error === "string" ? body.error : `transcription returned HTTP ${response.status}`;
    throw new ApiError(response.status, message, "transcription_failed", "Try recording again.", "/api/transcribe");
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    throw new ApiError(502, "AVA could not hear any clear speech in that recording.", "empty_transcription", "Try recording again.", "/api/transcribe");
  }
  return body.text.trim();
}

/**
 * Conversation binding (agentroom contract `i1-conversation-binding`). The server
 * resolves every chat and voice request to exactly one conversation: `new`
 * creates one, `resume` validates an exact id and never substitutes another, and
 * `continue` selects the latest conversation with genuine human activity.
 */
export type ConversationIntent = "new" | "resume" | "continue";
/** "assistant": a conversation AVA started (contract ava-initiative). */
export type SessionOrigin = "human" | "automation" | "unknown" | "assistant";
export type SessionBinding = {
  version: 1;
  sessionId: string;
  origin: SessionOrigin;
  resolution: "created" | "resumed_exact" | "continued";
  bindingRequestId?: string;
};
/** "inbox": AVA's unreplied, still-pending invitations, newest first. */
export type SessionScope = "human" | "automation" | "legacy" | "all" | "inbox";

export const api = {
  pair: (code: string, label: string) =>
    request<{ token: string; deviceId: string }>("/api/auth/pair", {
      method: "POST",
      body: JSON.stringify({ code, label }),
    }),
  sendMessage: (sessionId: string | null, text: string, opts?: {
    voice?: boolean;
    visualContext?: VisualMessageContext;
    inputSource?: "voice_exact_text";
    conversationIntent?: ConversationIntent;
    bindingRequestId?: string;
  }) =>
    // userMessageId: the accepted turn's exact stored row; null when nothing was stored, absent on older servers.
    request<{ sessionId: string; taskId?: string; binding?: SessionBinding; userMessageId?: number | null }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        text,
        voice: opts?.voice,
        visualContext: opts?.visualContext,
        inputSource: opts?.inputSource,
        conversationIntent: opts?.conversationIntent,
        bindingRequestId: opts?.bindingRequestId,
      }),
    }),
  kill: (sessionId: string) =>
    request<{ aborted: boolean; cancelledImprovements: number }>(`/api/chat/${sessionId}/kill`, { method: "POST" }),
  killAll: (sessionId: string) =>
    request<{ aborted: boolean; cancelledImprovements: number }>(`/api/chat/${sessionId}/kill-all`, { method: "POST" }),
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
  /** Creation provenance. Rows created before origin tracking are "unknown". */
  origin?: SessionOrigin;
  /** The last accepted human turn; maintenance and automation never move it. */
  last_human_activity_at?: number | null;
  /** The initiative behind a conversation AVA started; null or absent otherwise. */
  initiativeId?: string | null;
};

/** One bounded page of conversations. `nextCursor` is opaque; pass it back unchanged. */
export async function fetchSessionPage(input: {
  scope: SessionScope;
  limit?: number;
  cursor?: string | null;
}): Promise<{ sessions: SessionRow[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  const j = await request<{ sessions: SessionRow[]; nextCursor?: string | null }>(`/api/sessions?${params}`);
  return { sessions: j.sessions, nextCursor: j.nextCursor ?? null };
}

/** When this conversation was last really used by a person, for display. */
export function lastHumanActivity(session: SessionRow): number {
  return session.last_human_activity_at ?? session.created_at;
}

export type SessionMessage = {
  id: number;
  role: string;
  content: string;
  created_at: number;
  visualMessages?: VisualMessage[];
  metadata?: {
    visualContext?: VisualMessageContext;
    /** How an accepted human turn arrived (I1). Exact text from the voice UI is "text". */
    inputModality?: "text" | "voice";
    inputSource?: "voice_exact_text";
    memoryContext?: MemoryContext;
    savedItems?: SavedItems;
    roomPosts?: RoomPosts;
  };
};

/**
 * The authoritative exact lookup. A 404 here always means this conversation is
 * unavailable, whatever error code the server attaches (it has historically
 * answered `not_found`), so it is normalized to the typed `session_unavailable`.
 */
export async function fetchSession(id: string): Promise<{ session: SessionRow; messages: SessionMessage[] }> {
  const path = `/api/sessions/${encodeURIComponent(id)}`;
  try {
    return await request<{ session: SessionRow; messages: SessionMessage[] }>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.code !== "session_unavailable") {
      throw new ApiError(404, "This conversation is unavailable.", "session_unavailable", null, path);
    }
    throw error;
  }
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

export type UiLook = "ink" | "paper" | "system";
export type UiMotion = "full" | "reduced" | "system";
export type UiPreferences = {
  look: UiLook;
  motion: UiMotion;
  faceEnabled: boolean;
  version: number;
  updatedAt: number;
};
export type UiPreferencesPatch = Partial<Pick<UiPreferences, "look" | "motion" | "faceEnabled">>;

const UI_PREFERENCES_CACHE_KEY = "ava-ui-preferences";

function uiStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  try { return localStorage; } catch { return null; }
}

function isUiPreferences(value: unknown): value is UiPreferences {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<UiPreferences>;
  return (row.look === "ink" || row.look === "paper" || row.look === "system")
    && (row.motion === "full" || row.motion === "reduced" || row.motion === "system")
    && typeof row.faceEnabled === "boolean"
    && Number.isInteger(row.version) && Number(row.version) > 0
    && Number.isFinite(row.updatedAt);
}

/** Last authoritative row mirrored on this browser. It is never server authority. */
export function readCachedUiPreferences(): UiPreferences | null {
  const storage = uiStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(UI_PREFERENCES_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUiPreferences(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mirrorUiPreferences(preferences: UiPreferences): void {
  const storage = uiStorage();
  if (storage) {
    try { storage.setItem(UI_PREFERENCES_CACHE_KEY, JSON.stringify(preferences)); }
    catch { /* Storage can be disabled or full; the server write still stands. */ }
  }
  // Use the established runtime helpers so the DOM and all subscribers update
  // immediately, while SQLite remains authoritative after authentication.
  mirrorLookPref(preferences.look);
  setMotionPref(preferences.motion);
}

async function requestUiPreferences(): Promise<UiPreferences> {
  const response = await request<{ preferences: UiPreferences }>("/api/ui/preferences");
  return response.preferences;
}

async function requestUiPreferencesPatch(
  expectedVersion: number,
  patch: UiPreferencesPatch,
): Promise<UiPreferences> {
  const response = await request<{ preferences: UiPreferences }>("/api/ui/preferences", {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion, ...patch }),
  });
  return response.preferences;
}

/**
 * Reads the authoritative row and imports the pre-remodel `ava-motion` value
 * exactly once when the server is still untouched at its v1 defaults.
 */
export async function fetchUiPreferences(): Promise<UiPreferences> {
  const hadFullMirror = readCachedUiPreferences() !== null;
  let preferences = await requestUiPreferences();
  const storage = uiStorage();
  const legacyMotion = (() => {
    try {
      const value = storage?.getItem("ava-motion");
      return value === "full" || value === "reduced" || value === "system" ? value : null;
    } catch { return null; }
  })();
  const untouched = preferences.version === 1
    && preferences.look === "ink"
    && preferences.motion === "full"
    && preferences.faceEnabled;
  if (!hadFullMirror && untouched && legacyMotion && legacyMotion !== preferences.motion) {
    try {
      preferences = await requestUiPreferencesPatch(preferences.version, { motion: legacyMotion });
    } catch (error) {
      // Another client may win the one-time import. Refetch instead of
      // overwriting its authoritative choice or treating the race as offline.
      if (!(error instanceof ApiError) || error.code !== "stale_version") throw error;
      preferences = await requestUiPreferences();
    }
  }
  mirrorUiPreferences(preferences);
  return preferences;
}

export async function patchUiPreferences(
  expectedVersion: number,
  patch: UiPreferencesPatch,
): Promise<UiPreferences> {
  const preferences = await requestUiPreferencesPatch(expectedVersion, patch);
  mirrorUiPreferences(preferences);
  return preferences;
}

// How Ava's voice is produced:
//   "openai"     — realtime model speaks (OpenAI) + /api/speak = OpenAI TTS.
//   "hume"   — Hume EVI ("Alice Bennett") speaks; needs HUME_API_KEY on the server.
export type VoiceEngine = "live" | "openai" | "hume";

/** AVA's development-room membership (contract ava-room-member v2). */
export type AgentroomStatus = {
  schemaVersion: 1;
  enabled: boolean;
  version: number;
  availability: "ready" | "disabled" | "unconfigured" | "unreachable" | "identity_mismatch";
  identity: string;
  roomName: string | null;
  reason: string | null;
};

export async function fetchAgentroomStatus(): Promise<AgentroomStatus> {
  return request<AgentroomStatus>("/api/agentroom");
}

/** Versioned switch. A 409 (stale version or unavailable room) resolves with the current status. */
export async function setAgentroomEnabled(enabled: boolean, expectedVersion: number): Promise<{ ok: boolean; status: AgentroomStatus; error?: string }> {
  const res = await fetch("/api/agentroom", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify({ enabled, expectedVersion }),
  });
  const body = await res.json().catch(() => null) as (AgentroomStatus & { error?: string }) | null;
  if (!body) throw new Error(`HTTP ${res.status}`);
  return { ok: res.ok, status: body, ...(res.ok ? {} : { error: body.error }) };
}

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

export type CapabilitySnapshot = {
  generatedAt: number;
  uptimeMs: number;
  core: {
    brain: { ready: boolean; provider: string | null; model: string };
    voice: { ready: boolean; provider: VoiceEngine; model: string; speaker: string };
    browser: {
      ready: boolean;
      mode: "attached" | "reachable" | "offline";
      helper: string;
    };
    memory: {
      ready: boolean;
      preferences: number;
      observations: number;
      projects: number;
      people: number;
      playbooks: number;
    };
  };
  integrations: {
    instagram: boolean;
    whatsapp: boolean;
    gmailCalendar: boolean;
    shopify: boolean;
    googlePlaces: boolean;
    screenVision: boolean;
    push: boolean;
    microsoftUfo: {
      schemaVersion: 1;
      experimental: true;
      enabled: boolean;
      available: boolean;
      mode: "off" | "fixture" | "ufo";
      isolation: "none" | "synthetic-fixture-v1" | "disposable-windows-vm" | "local-windows-user-session";
      observeOnly: boolean;
      actionsAvailable: boolean;
      approvalRequiredForActions: true;
      allowedFixtures: Array<"counter-v1" | "notepad-text-v1">;
      limits: { timeoutMs: number; maxSteps: number };
      runtime: {
        adapter: "synthetic_fixture" | "microsoft_ufo" | "none";
        dependency: "available" | "not_checked" | "unavailable";
        release: string | null;
        commit: string | null;
        credentials: "configured" | "missing" | "not_applicable";
        reason: string;
      };
      nonGoals: string[];
    };
  };
  automations: {
    watches: number;
    schedulerReady: boolean;
    selfImprovement: boolean;
  };
};

export async function fetchCapabilities(): Promise<CapabilitySnapshot> {
  return request<CapabilitySnapshot>("/api/capabilities");
}

// ── Explorer: durable, redacted execution evidence.
//
// Explorer deliberately has its own contracts instead of treating chat sessions
// as tasks. A session can contain many runs, and pre-Explorer history has no
// recoverable tool trace. The API reports that coverage explicitly.

export type ExplorerTaskStatus =
  | "running"
  | "finished"
  /** Legacy value produced before final responses were separated from success. */
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type ExplorerVerificationStatus =
  | "verified"
  | "partially_verified"
  | "not_verified"
  | "not_recorded";

export type ExplorerTaskCoverage = {
  source: "instrumented_runtime";
  historicalBackfill: false;
  note: string;
};

export type ExplorerTaskSummary = {
  id: string;
  sessionId: string | null;
  sessionTitle: string | null;
  status: ExplorerTaskStatus;
  outcome: string | null;
  mode: "conversation" | "action" | null;
  verification: {
    status: ExplorerVerificationStatus;
    reason: string;
  };
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  eventCount: number;
  toolCallCount: number;
  errorCount: number;
  capabilityIds: string[];
  evidence: {
    source: "instrumented_runtime";
    label: "observed";
  };
};

export type ExplorerEventStatus =
  | "running"
  | "success"
  | "error"
  | "waiting"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled";

export type ExplorerEvent = {
  id: number;
  taskId: string;
  sequence: number;
  type: string;
  title: string;
  status: ExplorerEventStatus;
  occurredAt: number;
  durationMs: number | null;
  toolName: string | null;
  capabilityIds: string[];
  input: unknown;
  output: unknown;
  error: string | null;
  privacyLevel: "normal" | "personal" | "sensitive" | "secret_redacted" | string;
  evidence: {
    source: "instrumented_runtime";
    proves: string;
    verification: "not_independently_verified" | string;
  };
};

export type ExplorerTaskDetail = ExplorerTaskSummary & {
  originalRequest: string;
  finalResponse: string | null;
  error?: string | null;
  events: ExplorerEvent[];
  coverage: ExplorerTaskCoverage;
};

export type ExplorerTasksResponse = {
  tasks: ExplorerTaskSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  coverage: ExplorerTaskCoverage;
  generatedAt: number;
  apiVersion: number;
};

export type ExplorerLiveTask = {
  id: string;
  sessionId: string | null;
  sessionTitle: string | null;
  status: "running";
  mode: "conversation" | "action" | null;
  startedAt: number | null;
  elapsedMs: number | null;
  currentStage: string;
  eventCount: number;
  traceAvailable: boolean;
  source: "active_run_registry";
};

export type ExplorerCapabilityReadiness =
  | "ready"
  | "partially_ready"
  | "setup_required"
  | "unavailable"
  | "unknown";

export type ExplorerCapabilityHealth =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "unknown";

export type ExplorerRuntimeCapability = {
  id: string;
  domainId: string;
  name: string;
  description: string;
  stability: "stable" | "beta";
  moduleReference: string;
  dependencies: string[];
  verificationMethods: string[];
  readiness: ExplorerCapabilityReadiness;
  health: ExplorerCapabilityHealth;
  reason: string;
  statusConfidence: "high" | "medium" | "low";
  lastChecked: number;
  evidence: Array<{
    kind: "configuration" | "runtime_probe" | "local_store" | "dependency";
    source: string;
    summary: string;
    observedAt: number;
  }>;
};

export type ExplorerRuntimeDomain = {
  id: string;
  name: string;
  description: string;
};

export async function fetchExplorerTasks(
  options: {
    limit?: number;
    offset?: number;
    status?: ExplorerTaskStatus;
  } = {},
): Promise<ExplorerTasksResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.status) params.set("status", options.status);
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<ExplorerTasksResponse>(`/api/explorer/tasks${suffix}`);
}

export async function fetchExplorerTask(id: string): Promise<{ task: ExplorerTaskDetail }> {
  const response = await request<{
    task: Omit<ExplorerTaskDetail, "coverage">;
    coverage: ExplorerTaskCoverage;
    apiVersion: number;
  }>(
    `/api/explorer/tasks/${encodeURIComponent(id)}`,
  );
  return {
    task: {
      ...response.task,
      coverage: response.coverage,
    },
  };
}

export async function fetchExplorerLive(): Promise<{
  tasks: ExplorerLiveTask[];
  generatedAt: number;
  source: "active_run_registry";
  apiVersion: number;
}> {
  return request("/api/explorer/live");
}

export async function fetchExplorerRuntimeCapabilities(): Promise<{
  domains: ExplorerRuntimeDomain[];
  capabilities: ExplorerRuntimeCapability[];
  generatedAt: number;
  sources: string[];
  apiVersion: number;
}> {
  return request("/api/explorer/capabilities");
}

export type ExplorerMeta = {
  ok: true;
  service: "ava-explorer";
  apiVersion: number;
  instrumentation: "enabled";
  serverStartedAt: number;
  coverage: ExplorerTaskCoverage;
  endpoints: string[];
};

export async function fetchExplorerMeta(): Promise<ExplorerMeta> {
  return request<ExplorerMeta>("/api/explorer/meta");
}

export type ExplorerLearnedWorkflowStep = {
  id: string;
  sequence: number;
  label: string;
  source: "stored_playbook_step";
};

export type ExplorerLearnedWorkflow = {
  id: string;
  slug: string;
  trigger: string;
  keywords: string[];
  stakes: "routine" | "consequential";
  revision: number;
  created: string | null;
  lastUsed: string | null;
  steps: ExplorerLearnedWorkflowStep[];
  lessons: string[];
  metrics: {
    recalls: number;
    verifiedRuns: number;
    partiallyVerifiedRuns: number;
    unverifiedRuns: number;
    contradictedRuns: number;
    failedRuns: number;
    evidenceOutcomes: number;
    verificationRate: number | null;
    averageVerifiedDurationMs: number | null;
    legacyReportedFinals: number;
    legacyRuntimeFailures: number;
  };
  evidenceState: "verified_outcomes" | "legacy_reports" | "definition_only";
  provenance: {
    source: "procedural_memory_playbook";
    sourceId: string;
    storedDefinition: true;
    creationMethod: "not_recorded";
    metricsSource: "verified_learning_gate";
    note: string;
  };
  capabilityMapping: {
    status: "not_recorded";
    capabilityIds: [];
    reason: string;
  };
  taskLinkage: {
    status: "not_recorded";
    taskIds: [];
    reason: string;
  };
};

export type ExplorerLearnedWorkflowsResponse = {
  workflows: ExplorerLearnedWorkflow[];
  summary: {
    total: number;
    withObservedOutcomes: number;
    definitionOnly: number;
    totalRecalls: number;
    verifiedRuns: number;
    partiallyVerifiedRuns: number;
    unverifiedRuns: number;
    contradictedRuns: number;
    failedRuns: number;
    legacyReportedFinals: number;
    legacyRuntimeFailures: number;
  };
  source: {
    id: "procedural_memory_playbooks";
    type: "local_playbook_store";
    status: "available";
    parsedRecords: number;
    excludedUnparseableRecords: number;
    readAt: number;
    note: string;
  };
  coverage: {
    capabilityLinksRecorded: false;
    taskLinksRecorded: false;
    note: string;
  };
  generatedAt: number;
  apiVersion: number;
};

export async function fetchExplorerLearnedWorkflows(): Promise<ExplorerLearnedWorkflowsResponse> {
  return request<ExplorerLearnedWorkflowsResponse>("/api/explorer/workflows");
}

export type MemoryView = {
  personality: string;
  personaProfile: {
    version: string;
    architecture: "identity + collaboration + context registers";
    registers: Array<{ id: string; label: string; summary: string }>;
    lab: {
      kind: "deterministic_contract";
      scenarioCount: number;
      coverage: Record<"casual" | "execution" | "brainstorming" | "repair" | "high_stakes", number>;
      channels: Array<"chat" | "voice">;
      valid: boolean;
      caveat: string;
    };
  };
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
  if (!r.ok) {
    if (r.status === 401) handleUnauthorized();
    throw new ApiError(r.status, "patch_failed");
  }
  return { ok: true };
}

export async function postMemoryLine(line: string): Promise<void> {
  await request<{ line: string }>("/api/memory/lines", {
    method: "POST",
    body: JSON.stringify({ file: "preferences", line }),
  });
}

// ── Learned workflows (playbooks) + standing watches — Memory screen read surfaces.

export type MemoryIndexEntry = {
  id: string;
  version: number;
  kind: "research" | "idea" | "remembered" | "improvement" | "artifact";
  title: string;
  summary: string;
  conclusions: string[];
  openQuestions: string[];
  nextSteps: string[];
  tags: string[];
  project: string | null;
  privacyLevel: "personal" | "project";
  captureMode: "explicit" | "automatic";
  captureReason: string | null;
  threadId: string;
  parentEntryId: string | null;
  checkpointSequence: number;
  checkpointKind: "initial" | "revision" | "decision" | "conclusion" | "topic_shift" | "open_question" | "next_step";
  checkpointReason: string | null;
  embeddingStatus: "pending" | "ready" | "unavailable";
  createdAt: number;
  updatedAt: number;
};

export type MemoryIndexResult = {
  entry: MemoryIndexEntry;
  originalEntry: MemoryIndexEntry;
  source: {
    type: "conversation_range" | "improvement_record";
    label: string;
    sessionId: string | null;
    fromMessageId: number;
    throughMessageId: number;
    messageCount: number;
    reference: string | null;
    commitSha: string | null;
    status: "verified" | "changed" | "unavailable";
    verifiedAt: number;
    reason: string;
  };
  match: {
    mode: "recent" | "lexical" | "semantic" | "hybrid";
    reason: string;
    semanticScore: number | null;
    lexicalScore: number;
    sharedTerms: string[];
  };
  lineage: {
    threadId: string;
    parentEntryId: string | null;
    sequence: number;
    kind: MemoryIndexEntry["checkpointKind"];
    reason: string | null;
    totalCheckpoints: number;
    isLatest: boolean;
  };
  governance: {
    threadVersion: number;
    pinned: boolean;
    state: "current" | "history" | "superseded" | "conflicted";
    retrievalEligible: boolean;
    corrected: boolean;
    correctionEventId: string | null;
    correctionReason: string | null;
    supersededByThreadId: string | null;
    conflictWithThreadIds: string[];
    updatedAt: number;
    events: Array<{
      id: string;
      threadId: string;
      entryId: string | null;
      kind: "corrected" | "pinned" | "unpinned" | "superseded" | "conflict_opened" | "conflict_resolved";
      actor: "user" | "ava";
      reason: string;
      targetThreadId: string | null;
      resultingVersion: number;
      createdAt: number;
    }>;
  };
  usable: boolean;
};

export type MemoryIndexSearchResponse = {
  query: string;
  project: string | null;
  mode: "recent" | "lexical" | "semantic" | "hybrid";
  semanticAvailable: boolean;
  notice: string | null;
  suppressedByGovernance: number;
  results: MemoryIndexResult[];
};

export async function fetchMemoryIndex(project?: string): Promise<MemoryIndexSearchResponse> {
  const params = new URLSearchParams();
  if (project?.trim()) params.set("project", project.trim());
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<MemoryIndexSearchResponse>(`/api/memory/index${suffix}`);
}

export async function searchMemoryIndex(input: {
  query: string;
  project?: string;
  includeHistory?: boolean;
}): Promise<MemoryIndexSearchResponse> {
  return request<MemoryIndexSearchResponse>("/api/memory/index/search", {
    method: "POST",
    body: JSON.stringify({
      query: input.query,
      ...(input.project?.trim() ? { project: input.project.trim() } : {}),
      ...(input.includeHistory ? { includeHistory: true } : {}),
    }),
  });
}

export async function correctMemoryIndexEntry(input: {
  id: string;
  expectedVersion: number;
  reason: string;
  summary: string;
  project?: string | null;
  requestId: string;
}): Promise<{ ok: true; result: MemoryIndexResult }> {
  return request(`/api/memory/index/${encodeURIComponent(input.id)}/correct`, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      requestId: input.requestId,
      correction: { summary: input.summary },
      ...(input.project ? { project: input.project } : {}),
    }),
  });
}

export async function pinMemoryIndexThread(input: {
  threadId: string;
  expectedVersion: number;
  pinned: boolean;
  reason: string;
  project?: string | null;
  requestId: string;
}): Promise<{ ok: true; result: MemoryIndexResult }> {
  return request(`/api/memory/index/threads/${encodeURIComponent(input.threadId)}/pin`, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: input.expectedVersion,
      pinned: input.pinned,
      reason: input.reason,
      requestId: input.requestId,
      ...(input.project ? { project: input.project } : {}),
    }),
  });
}

export async function supersedeMemoryIndexThread(input: {
  threadId: string;
  expectedVersion: number;
  replacementThreadId: string;
  replacementExpectedVersion: number;
  reason: string;
  project?: string | null;
  requestId: string;
}): Promise<{ ok: true; result: MemoryIndexResult }> {
  return request(`/api/memory/index/threads/${encodeURIComponent(input.threadId)}/supersede`, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: input.expectedVersion,
      replacementThreadId: input.replacementThreadId,
      replacementExpectedVersion: input.replacementExpectedVersion,
      reason: input.reason,
      requestId: input.requestId,
      ...(input.project ? { project: input.project } : {}),
    }),
  });
}

export async function setMemoryIndexConflict(input: {
  mode: "open" | "resolve";
  threadId: string;
  expectedVersion: number;
  otherThreadId: string;
  otherExpectedVersion: number;
  reason: string;
  project?: string | null;
  requestId: string;
}): Promise<{ ok: true; result: MemoryIndexResult }> {
  const path = input.mode === "resolve" ? "resolve-conflict" : "conflict";
  return request(`/api/memory/index/threads/${encodeURIComponent(input.threadId)}/${path}`, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      requestId: input.requestId,
      ...(input.mode === "resolve"
        ? { losingThreadId: input.otherThreadId, losingExpectedVersion: input.otherExpectedVersion }
        : { otherThreadId: input.otherThreadId, otherExpectedVersion: input.otherExpectedVersion }),
      ...(input.project ? { project: input.project } : {}),
    }),
  });
}

export async function forgetMemoryIndexEntry(id: string, expectedVersion: number): Promise<void> {
  await request<{ ok: true }>(`/api/memory/index/${encodeURIComponent(id)}/forget`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
}

export type PlaybookRow = {
  slug: string;
  trigger: string;
  keywords: string[];
  created: string;
  last_used: string;
  uses: number;
  stakes: "routine" | "consequential" | string;
  steps: string[];
  version: number;
  succ: number;
  fail: number;
  avg_secs: number;
  lessons: string[];
  /** False once AVA's own rules stopped offering it because it kept failing. */
  offered?: boolean;
  learning?: {
    verified: number;
    partially_verified: number;
    unverified: number;
    contradicted: number;
    failed: number;
    not_applicable: number;
    last_task_id: string;
    last_method: string;
    last_evidence_at: number;
    recent_task_ids: string[];
  };
};

export async function fetchPlaybooks(): Promise<PlaybookRow[]> {
  const j = await request<{ playbooks: PlaybookRow[] }>("/api/playbooks");
  return j.playbooks ?? [];
}

export async function deletePlaybook(slug: string): Promise<void> {
  await request<{ deleted: string }>(`/api/playbooks/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

export type WatchRow = {
  id: string;
  prompt: string;
  interval_minutes: number;
  /** 1 = disable after first trigger (SQLite boolean-as-int; may arrive as boolean). */
  once: number | boolean;
  enabled: number | boolean;
  session_id: string | null;
  created_at: number;
  last_run_at: number | null;
  last_status: "ok" | "triggered" | "unclear" | "error" | "busy" | "dispatching" | "delivered" | "running" | "completed" | string | null;
  last_result: string | null;
  /** One-shot: fire once at this epoch-ms (newer column — may be absent). */
  run_at?: number | null;
  /** The named zone a one-off reminder was chosen in (i4; may be absent). */
  time_zone?: string | null;
  /** Recurring daily at "HH:MM" local (newer column — may be absent). */
  daily_at?: string | null;
  /** "check" | "reminder" | "codex" (newer column — may be absent). */
  kind?: string | null;
  target_thread_id?: string | null;
  continue_cycle?: number | boolean;
  delivered_at?: number | null;
  completed_at?: number | null;
  successor_status?: "planning" | "blocked" | "scheduled" | null;
  successor_result?: string | null;
  successor_attempted_at?: number | null;
  successor_session_id?: string | null;
  communication_evidence?:
    | { availability: "available"; runId: string }
    | { availability: "unavailable" };
  /**
   * Present only on direct one-off reminders (kind=reminder + run_at), contract
   * i4-one-off-reminders v1. Evidence of transport acceptance, never of phone
   * receipt. Read it through `parseReminderStatus`, which tolerates drift.
   */
  reminder_status?: unknown;
};

/** Visible reminder states (internal claimed/sending both surface as "trying"). */
export const REMINDER_STATES = [
  "scheduled", "paused", "trying", "retry_scheduled", "accepted",
  "failed", "expired", "acceptance_unknown", "cancelled",
] as const;
export type ReminderState = typeof REMINDER_STATES[number];

/** The closed v1 reason codes. Anything else is shown as "Could not confirm". */
export const REMINDER_REASON_CODES = [
  "push_not_configured", "no_subscriptions", "transient_rejection", "permanent_rejection",
  "subscription_gone", "transport_timeout", "transport_unknown", "missed_window",
  "retry_exhausted", "delivery_window_expired", "paused", "deleted", "delivery_not_recorded",
] as const;
export type ReminderReasonCode = typeof REMINDER_REASON_CODES[number];

export type ReminderStatus = {
  version: 1;
  occurrenceId: string;
  revision: number;
  /** A ReminderState, or an unknown future state shown as "Could not confirm". */
  state: string;
  dueAt: number;
  timeZone: string | null;
  expiresAt: number;
  attempts: number;
  attemptedAt: number | null;
  nextAttemptAt: number | null;
  acceptedAt: number | null;
  subscriptions: {
    total: number;
    accepted: number;
    rejectedTransient: number;
    rejectedPermanent: number;
    unknown: number;
  };
  /** A ReminderReasonCode, or an unknown future code. */
  reasonCode: string | null;
  phoneReceipt: "unconfirmed";
};

export async function fetchWatches(): Promise<WatchRow[]> {
  const j = await request<{ watches: WatchRow[] }>("/api/watches");
  return j.watches ?? [];
}

export type WatcherCommunicationEvidence = NonNullable<WatchRow["communication_evidence"]>;

/** Revalidate one already-visible read-only evidence receipt without refetching every watch. */
export async function fetchWatchCommunicationEvidence(id: string): Promise<WatcherCommunicationEvidence> {
  const expectedRunId = /^[A-Za-z0-9_-]{1,64}$/.test(id)
    ? `communication:codex_watcher:${id}`
    : null;
  const response = await request<{ communication_evidence?: unknown }>(
    `/api/watches/${encodeURIComponent(id)}/communication-evidence`,
  );
  const evidence = response.communication_evidence;
  if (
    evidence &&
    typeof evidence === "object" &&
    !Array.isArray(evidence) &&
    (evidence as { availability?: unknown }).availability === "available" &&
    typeof (evidence as { runId?: unknown }).runId === "string" &&
    (evidence as { runId: string }).runId === expectedRunId
  ) {
    return { availability: "available", runId: (evidence as { runId: string }).runId };
  }
  return { availability: "unavailable" };
}

export type CreateWatchInput = {
  prompt: string;
  intervalMinutes?: number;
  once?: boolean;
  runAt?: number;
  dailyAt?: string;
  kind?: "check" | "reminder";
};

/** Create an ordinary AVA check or reminder through the existing watch API. */
export async function createWatchApi(input: CreateWatchInput): Promise<WatchRow> {
  const j = await request<{ watch: WatchRow }>("/api/watches", {
    method: "POST",
    body: JSON.stringify({
      prompt: input.prompt,
      ...(input.intervalMinutes !== undefined ? { interval_minutes: input.intervalMinutes } : {}),
      ...(input.once !== undefined ? { once: input.once } : {}),
      ...(input.runAt !== undefined ? { run_at: input.runAt } : {}),
      ...(input.dailyAt !== undefined ? { daily_at: input.dailyAt } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
    }),
  });
  return j.watch;
}

/**
 * A create answered 2xx, but its body doesn't prove this reminder was stored.
 * The write may or may not have happened; it is never resent automatically.
 */
export class UnconfirmedWriteError extends Error {
  readonly name = "UnconfirmedWriteError";
}

function canonicalZone(zone: unknown): string | null {
  if (typeof zone !== "string" || !zone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Create a direct one-off reminder (contract i4-one-off-reminders v2): an exact
 * instant plus the named zone it was chosen in. It resolves only with the
 * stored reminder: same prompt, same instant, an equivalent zone and a
 * scheduled receipt for exactly that occurrence. Anything less is an
 * UnconfirmedWriteError, and nothing here ever retries.
 */
export async function createReminderApi(input: {
  prompt: string;
  runAt: number;
  timeZone: string;
}): Promise<WatchRow> {
  let j: { watch?: unknown } | null;
  try {
    j = await request<{ watch?: unknown } | null>("/api/watches", {
      method: "POST",
      body: JSON.stringify({
        prompt: input.prompt,
        kind: "reminder",
        run_at: input.runAt,
        time_zone: input.timeZone,
        once: true,
      }),
    });
  } catch (error) {
    // A 2xx whose body couldn't be read may still have stored the reminder.
    if (error instanceof ApiError && error.status >= 200 && error.status < 300) {
      throw new UnconfirmedWriteError("AVA's answer didn't confirm the reminder was saved.");
    }
    throw error;
  }
  const watch = j && typeof j === "object" ? j.watch : undefined;
  const w = watch && typeof watch === "object" && !Array.isArray(watch) ? watch as WatchRow : null;
  const zone = canonicalZone(input.timeZone);
  const receipt = w ? receiptFor(w) : null;
  if (
    !w
    || typeof w.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(w.id)
    || w.kind !== "reminder"
    || w.prompt !== input.prompt
    || w.run_at !== input.runAt
    || zone === null || canonicalZone(w.time_zone) !== zone
    || !receipt || receipt.state !== "scheduled"
  ) {
    throw new UnconfirmedWriteError("AVA's answer didn't confirm the reminder was saved.");
  }
  return w;
}

// ── People map (GET /api/people) — Ava's identity-resolution layer, read-only here.

/** Per-app identity plus the last thread observed after exact identity routing. */
export type PersonApp = {
  username?: string;
  phone?: string;
  threadId?: string;
};

export type PersonRow = {
  id: string;
  name: string;
  aliases: string[];
  instagram?: PersonApp;
  whatsapp?: PersonApp;
  notes?: string;
  /** yyyy-mm-dd of the last edit to this person. */
  updated: string;
};

export async function fetchPeople(): Promise<PersonRow[]> {
  const j = await request<{ people: PersonRow[] }>("/api/people");
  return j.people ?? [];
}

export async function setWatchEnabled(id: string, enabled: boolean): Promise<void> {
  await request<{ ok: true }>(`/api/watches/${encodeURIComponent(id)}/enabled`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteWatchApi(id: string): Promise<void> {
  await request<{ deleted: boolean }>(`/api/watches/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── Mission Control: AVA-owned, correlated operational observability.

export type MissionRun = {
  id: string;
  traceId: string;
  parentRunId: string | null;
  rootTaskId: string | null;
  sessionId: string | null;
  runKind: string;
  runtimeId: string;
  runtimeType: string;
  hostRuntimeId: string | null;
  ownerType: string;
  ownerId: string | null;
  ownerRole: string | null;
  title: string;
  objective: string | null;
  status: string;
  outcome: string | null;
  verificationStatus: string;
  privacyLevel: string;
  compactSummary: string | null;
  version: number;
  startedAt: number;
  updatedAt: number;
  lastEventAt: number;
  completedAt: number | null;
  staleAfterMs: number;
  stale: boolean;
  controlAvailable: boolean;
  directCostMicrousd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  eventCount: number;
  errorCount: number;
  retryCount: number;
};

export type MissionEvent = {
  seq: number;
  eventId: string;
  schemaVersion: number;
  runId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  causationEventId: string | null;
  producerId: string;
  producerEventId: string | null;
  producerSequence: number | null;
  runtimeId: string;
  runtimeType: string;
  hostRuntimeId: string | null;
  actorType: string;
  actorId: string | null;
  actorRole: string | null;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  visibility: "summary" | "detail" | "sensitive_collapsed" | "system_only";
  privacyLevel: string;
  payload: unknown;
  error: string | null;
  actionId: string | null;
  actionOwner: "executor" | "observer" | "router" | null;
  actionCounted: boolean;
  providerRequestId: string | null;
  costKind: string | null;
  costMicrousd: number | null;
  accountingApplied: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  durationMs: number | null;
  occurredAt: number;
  receivedAt: number;
  terminal: boolean;
  late: boolean;
  projectionApplied: boolean;
};

export type MissionControlNavigation =
  | { kind: "watcher"; availability: "available"; watcherId: string }
  | { kind: "watcher"; availability: "unavailable" }
  | null;

export type MissionMeta = {
  ok: true;
  service: "ava-mission-control";
  apiVersion: number;
  schemaVersion: number;
  serverAuthority: "ava";
  controls: ["stop"];
  eventBounds: {
    min: number | null;
    max: number | null;
  };
  evidenceExport?: {
    enabled: boolean;
    scopes: Array<"run" | "trace">;
    formats: ["json"];
    schemaVersion: number;
    maxRows: number;
    maxBytes: number;
    maxTimeRangeMs: number;
    content: string;
    redactionReapplied: boolean;
  };
};

export type MissionExportScope = "run" | "trace";

export type MissionEvidenceExport = {
  service: "ava-mission-control";
  format: "json";
  apiVersion: number;
  exportSchemaVersion: number;
  observabilitySchemaVersion: number;
  generatedAt: number;
  scope: {
    type: MissionExportScope;
    anchorRunId: string;
    traceId: string;
  };
  snapshot: {
    highWaterEventSeq: number;
    oldestRetainedEventSeq: number | null;
    newestRetainedEventSeq: number | null;
    rule: "events_at_or_before_high_water";
  };
  appliedFilters: {
    format: "json";
    content: string;
    throughEventSeq: number;
  };
  bounds: {
    maxRows: number;
    maxBytes: number;
    maxTimeRangeMs: number;
    rows: { runs: number; events: number; total: number };
    timeRangeMs: number;
  };
  completeness: {
    evidence: "complete_at_snapshot" | "partial_due_to_retention";
    partial: boolean;
    truncated: false;
    reasons: string[];
    activeRunIdsAtSnapshot: string[];
  };
  retention: {
    detailedDays: number;
    compactDays: number;
    detailedCutoffAt: number;
    compactCutoffAt: number;
  };
  redaction: {
    reappliedAtExport: true;
    policy: string;
    notice: string;
    collapsedContent: string;
  };
  runs: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

export async function fetchMissionMeta(): Promise<MissionMeta> {
  return request<MissionMeta>("/api/mission-control/meta");
}

export type MissionRunCategory = "all" | "communications";

export async function fetchMissionRuns(
  limit = 50,
  category: MissionRunCategory = "all",
): Promise<MissionRun[]> {
  const categoryQuery = category === "communications" ? "&category=communications" : "";
  const response = await request<{ runs: MissionRun[] }>(
    `/api/mission-control/runs?limit=${Math.max(1, Math.min(100, limit))}${categoryQuery}`,
  );
  return response.runs;
}

export async function fetchMissionRun(id: string): Promise<{
  run: MissionRun;
  events: MissionEvent[];
  navigation: MissionControlNavigation;
}> {
  return request(`/api/mission-control/runs/${encodeURIComponent(id)}`);
}

export async function fetchMissionExport(
  id: string,
  scope: MissionExportScope,
): Promise<MissionEvidenceExport> {
  return request<MissionEvidenceExport>(
    `/api/mission-control/runs/${encodeURIComponent(id)}/export?scope=${scope}&format=json`,
  );
}

/** Create the user-requested download locally; AVA never persists a duplicate export file. */
export function saveMissionExport(document: MissionEvidenceExport): void {
  if (
    typeof globalThis.document === "undefined" ||
    typeof globalThis.URL?.createObjectURL !== "function"
  ) {
    throw new Error("This browser cannot create a local evidence download.");
  }
  const body = JSON.stringify(document, null, 2);
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = globalThis.URL.createObjectURL(blob);
  const link = globalThis.document.createElement("a");
  const safeId = document.scope.anchorRunId.replace(/[^A-Za-z0-9._-]/g, "_");
  const stamp = new Date(document.generatedAt).toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `ava-mission-${document.scope.type}-${safeId}-${stamp}.json`;
  link.style.display = "none";
  globalThis.document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.URL.revokeObjectURL(url);
}

export async function stopMissionRun(id: string, expectedVersion: number): Promise<MissionRun> {
  const response = await request<{ accepted: true; run: MissionRun }>(
    `/api/mission-control/runs/${encodeURIComponent(id)}/stop`,
    {
      method: "POST",
      body: JSON.stringify({ expectedVersion }),
    },
  );
  return response.run;
}

type MissionStreamOptions = {
  after?: number;
  onEvent: (event: MissionEvent) => void;
  onGap?: () => void;
  onState?: (state: "connecting" | "live" | "reconnecting" | "offline") => void;
};

/** Authenticated fetch-SSE with cursor replay; EventSource cannot set AVA's token. */
export function subscribeMissionEvents(options: MissionStreamOptions): () => void {
  const controller = new AbortController();
  let cursor = Math.max(0, options.after ?? 0);
  let reconnectMs = 500;

  const connect = async () => {
    while (!controller.signal.aborted) {
      options.onState?.(cursor ? "reconnecting" : "connecting");
      try {
        const headers = new Headers({ accept: "text/event-stream" });
        const token = getToken();
        if (token) headers.set("authorization", `Bearer ${token}`);
        const response = await fetch(
          `/api/mission-control/stream?after=${cursor}`,
          { headers, signal: controller.signal },
        );
        if (response.status === 401) {
          handleUnauthorized();
          return;
        }
        if (!response.ok || !response.body) throw new Error(`stream_http_${response.status}`);
        options.onState?.("live");
        reconnectMs = 500;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "";
        let data = "";
        const dispatch = () => {
          if (eventName === "mission_event" && data) {
            const event = JSON.parse(data) as MissionEvent;
            if (event.seq > cursor) {
              cursor = event.seq;
              options.onEvent(event);
            }
          } else if (eventName === "gap") {
            options.onGap?.();
          }
          eventName = "";
          data = "";
        };
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) {
                data += `${data ? "\n" : ""}${line.slice(5).trimStart()}`;
              }
            }
            dispatch();
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        options.onState?.("offline");
      }
      await new Promise<void>((resolve) => {
        const id = window.setTimeout(resolve, reconnectMs);
        controller.signal.addEventListener("abort", () => {
          window.clearTimeout(id);
          resolve();
        }, { once: true });
      });
      reconnectMs = Math.min(5_000, reconnectMs * 2);
    }
  };
  void connect();
  return () => controller.abort();
}
