import { getToken, clearToken } from "./auth/tokens.js";
import type { VisualMessage, VisualMessageContext } from "./visuals/types.js";

export class ApiError extends Error {
  readonly name = "ApiError";

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

async function request<T>(
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
    throw new ApiError(
      r.status,
      action ? `${message} ${action}` : message,
      code,
      action,
      path,
    );
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

export const api = {
  pair: (code: string, label: string) =>
    request<{ token: string; deviceId: string }>("/api/auth/pair", {
      method: "POST",
      body: JSON.stringify({ code, label }),
    }),
  sendMessage: (sessionId: string | null, text: string, opts?: { voice?: boolean; visualContext?: VisualMessageContext }) =>
    request<{ sessionId: string; taskId?: string }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, text, voice: opts?.voice, visualContext: opts?.visualContext }),
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
  messages: Array<{
    id: number;
    role: string;
    content: string;
    created_at: number;
    visualMessages?: VisualMessage[];
    metadata?: { visualContext?: VisualMessageContext };
  }>;
}> {
  return request<{
    session: SessionRow;
    messages: Array<{
      id: number;
      role: string;
      content: string;
      created_at: number;
      visualMessages?: VisualMessage[];
      metadata?: { visualContext?: VisualMessageContext };
    }>;
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
  /** Recurring daily at "HH:MM" local (newer column — may be absent). */
  daily_at?: string | null;
  /** "check" | "reminder" | "codex" (newer column — may be absent). */
  kind?: string | null;
  target_thread_id?: string | null;
  continue_cycle?: number | boolean;
  delivered_at?: number | null;
  completed_at?: number | null;
};

export async function fetchWatches(): Promise<WatchRow[]> {
  const j = await request<{ watches: WatchRow[] }>("/api/watches");
  return j.watches ?? [];
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

export async function fetchMissionRuns(limit = 50): Promise<MissionRun[]> {
  const response = await request<{ runs: MissionRun[] }>(
    `/api/mission-control/runs?limit=${Math.max(1, Math.min(100, limit))}`,
  );
  return response.runs;
}

export async function fetchMissionRun(id: string): Promise<{
  run: MissionRun;
  events: MissionEvent[];
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
