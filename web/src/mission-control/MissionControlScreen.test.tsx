// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionEvent, MissionEvidenceExport, MissionRun } from "../api.js";

const api = vi.hoisted(() => ({
  fetchMissionMeta: vi.fn(),
  fetchMissionExport: vi.fn(),
  fetchMissionRuns: vi.fn(),
  fetchMissionRun: vi.fn(),
  saveMissionExport: vi.fn(),
  stopMissionRun: vi.fn(),
  subscribeMissionEvents: vi.fn((_options?: unknown) => () => {}),
}));

vi.mock("../api.js", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../api.js")>();
  return { ...original, ...api };
});

import { MissionControlScreen } from "./MissionControlScreen.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const run: MissionRun = {
  id: "voice-root",
  traceId: "trace-1",
  parentRunId: null,
  rootTaskId: "voice-root",
  sessionId: "session-1",
  runKind: "voice_session",
  runtimeId: "ava",
  runtimeType: "ava",
  hostRuntimeId: null,
  ownerType: "ava",
  ownerId: "voice",
  ownerRole: "orchestrator",
  title: "Voice session",
  objective: "Help Niko through voice",
  status: "running",
  outcome: null,
  verificationStatus: "pending",
  privacyLevel: "personal",
  compactSummary: "Listening for the next request.",
  version: 7,
  startedAt: Date.now() - 2_000,
  updatedAt: Date.now(),
  lastEventAt: Date.now(),
  completedAt: null,
  staleAfterMs: 30_000,
  stale: false,
  controlAvailable: true,
  directCostMicrousd: 0,
  inputTokens: 120,
  outputTokens: 42,
  cachedTokens: 0,
  eventCount: 2,
  errorCount: 0,
  retryCount: 0,
};

const event: MissionEvent = {
  seq: 2,
  eventId: "event-2",
  schemaVersion: 1,
  runId: run.id,
  traceId: run.traceId,
  spanId: "span-voice",
  parentSpanId: null,
  causationEventId: null,
  producerId: "ava.voice",
  producerEventId: "provider-2",
  producerSequence: 2,
  runtimeId: "ava",
  runtimeType: "ava",
  hostRuntimeId: null,
  actorType: "agent",
  actorId: "ava",
  actorRole: "orchestrator",
  type: "voice.transcript.accepted",
  status: "success",
  title: "Transcript accepted",
  summary: "A voice request was accepted.",
  visibility: "sensitive_collapsed",
  privacyLevel: "personal",
  payload: { transcript: "sanitized request" },
  error: null,
  actionId: null,
  actionOwner: "observer",
  actionCounted: false,
  providerRequestId: null,
  costKind: null,
  costMicrousd: null,
  accountingApplied: false,
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  durationMs: 15,
  occurredAt: Date.now(),
  receivedAt: Date.now(),
  terminal: false,
  late: false,
  projectionApplied: true,
};

const claudeCommunicationRun: MissionRun = {
  ...run,
  id: "communication:provider_discussion:disc-1",
  traceId: "trace-communication",
  parentRunId: "chat-parent",
  rootTaskId: "chat-parent",
  runKind: "agent_communication",
  runtimeId: "claude_code:communication",
  runtimeType: "claude_code",
  ownerType: "agent",
  ownerId: "claude_code",
  ownerRole: "external-executor",
  title: "Claude background discussion",
  objective: "Compare the two cache strategies",
  status: "completed",
  outcome: "response_received_unverified",
  verificationStatus: "partially_verified",
  compactSummary: "Prefer the bounded cache.",
  controlAvailable: false,
  inputTokens: 0,
  outputTokens: 0,
  eventCount: 3,
};

const claudeCommunicationEvent: MissionEvent = {
  ...event,
  seq: 9,
  eventId: "communication-event-9",
  runId: claudeCommunicationRun.id,
  traceId: claudeCommunicationRun.traceId,
  runtimeId: claudeCommunicationRun.runtimeId,
  runtimeType: claudeCommunicationRun.runtimeType,
  actorId: "claude_code",
  actorRole: "external-executor",
  type: "communication.response.completed",
  status: "success",
  title: "Claude response received",
  summary: "AVA received a sanitized Claude response.",
  visibility: "sensitive_collapsed",
  payload: {
    communicationSource: "provider_discussion",
    requestAvailability: "sanitized_recorded",
    responseAvailability: "sanitized_recorded",
    usageAvailability: "not_reported",
    evidenceProvenance: "ava_observed_boundary",
  },
  terminal: true,
};

const codexCommunicationRun: MissionRun = {
  ...claudeCommunicationRun,
  id: "communication:codex_watcher:watch-1",
  traceId: "trace-codex",
  parentRunId: null,
  rootTaskId: "communication:codex_watcher:watch-1",
  runtimeId: "codex:communication",
  runtimeType: "codex",
  ownerId: "codex",
  title: "Codex watcher handoff",
  objective: "Implement one bounded task",
  outcome: "task_boundary_observed_sanitized_response_recorded",
  compactSummary: "Implemented and tested the bounded task.",
};

const codexCommunicationEvent: MissionEvent = {
  ...claudeCommunicationEvent,
  seq: 10,
  eventId: "communication-event-10",
  runId: codexCommunicationRun.id,
  traceId: codexCommunicationRun.traceId,
  runtimeId: codexCommunicationRun.runtimeId,
  runtimeType: codexCommunicationRun.runtimeType,
  actorId: "codex",
  type: "communication.response.completed",
  title: "Codex task boundary completed",
  payload: {
    communicationSource: "codex_watcher",
    requestAvailability: "sanitized_recorded",
    responseAvailability: "sanitized_recorded",
    responseEvidenceProvenance: "exact_thread_terminal_result",
    usageAvailability: "not_reported",
    evidenceProvenance: "ava_observed_boundary",
  },
};

const evidenceExport: MissionEvidenceExport = {
  service: "ava-mission-control",
  format: "json",
  apiVersion: 1,
  exportSchemaVersion: 1,
  observabilitySchemaVersion: 1,
  generatedAt: Date.now(),
  scope: { type: "trace", anchorRunId: run.id, traceId: run.traceId },
  snapshot: {
    highWaterEventSeq: 2,
    oldestRetainedEventSeq: 1,
    newestRetainedEventSeq: 2,
    rule: "events_at_or_before_high_water",
  },
  appliedFilters: {
    format: "json",
    content: "operational_summaries_and_bounded_detail",
    throughEventSeq: 2,
  },
  bounds: {
    maxRows: 1_000,
    maxBytes: 1_000_000,
    maxTimeRangeMs: 2_592_000_000,
    rows: { runs: 1, events: 1, total: 2 },
    timeRangeMs: 2_000,
  },
  completeness: {
    evidence: "partial_due_to_retention",
    partial: true,
    truncated: false,
    reasons: ["Detailed events were already compacted for 1 run(s)."],
    activeRunIdsAtSnapshot: [],
  },
  retention: {
    detailedDays: 30,
    compactDays: 365,
    detailedCutoffAt: Date.now() - 1_000,
    compactCutoffAt: Date.now() - 2_000,
  },
  redaction: {
    reappliedAtExport: true,
    policy: "ava_operational_sanitizer_v1",
    notice: "Secrets excluded.",
    collapsedContent: "Sensitive details omitted.",
  },
  runs: [],
  events: [],
};

describe("MissionControlScreen", () => {
  it("shows the correlated live timeline and sends version-guarded Stop", async () => {
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 2 },
    });
    api.fetchMissionRuns.mockResolvedValue([run]);
    api.fetchMissionRun.mockResolvedValue({ run, events: [event] });
    api.stopMissionRun.mockResolvedValue({
      ...run,
      status: "cancelling",
      version: 8,
    });

    render(<MissionControlScreen />);

    expect(await screen.findByText("Transcript accepted")).toBeTruthy();
    expect(screen.getByText("A voice request was accepted.")).toBeTruthy();
    expect(screen.getByText(/AVA is actively processing this run/)).toBeTruthy();
    expect(screen.getByText("Sanitized request · collapsed by default")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop voice session" }));
    await waitFor(() => expect(api.stopMissionRun).toHaveBeenCalledWith("voice-root", 7));
  });

  it("does not present missing token accounting as a measured zero", async () => {
    const noUsageRun = { ...run, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 2 },
    });
    api.fetchMissionRuns.mockResolvedValue([noUsageRun]);
    api.fetchMissionRun.mockResolvedValue({ run: noUsageRun, events: [event] });

    render(<MissionControlScreen />);

    expect(await screen.findByText("Transcript accepted")).toBeTruthy();
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Export evidence" })).toBeNull();
  });

  it("downloads the selected trace scope and shows redaction and partial notices", async () => {
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 2 },
      evidenceExport: {
        enabled: true,
        scopes: ["run", "trace"],
        formats: ["json"],
        schemaVersion: 1,
        maxRows: 1_000,
        maxBytes: 1_000_000,
        maxTimeRangeMs: 2_592_000_000,
        content: "operational_summaries_and_bounded_detail",
        redactionReapplied: true,
      },
    });
    api.fetchMissionRuns.mockResolvedValue([run]);
    api.fetchMissionRun.mockResolvedValue({ run, events: [event] });
    api.fetchMissionExport.mockResolvedValue(evidenceExport);

    render(<MissionControlScreen />);
    expect(await screen.findByText("Transcript accepted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export evidence" }));
    expect(screen.getByText("Privacy-safe JSON evidence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "trace" }));
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    await waitFor(() => expect(api.fetchMissionExport).toHaveBeenCalledWith(run.id, "trace"));
    expect(api.saveMissionExport).toHaveBeenCalledWith(evidenceExport);
    expect(screen.getByText("Export schema v1")).toBeTruthy();
    expect(screen.getByText("Sanitizer reapplied")).toBeTruthy();
    expect(screen.getByText("Evidence partial")).toBeTruthy();
    expect(screen.getByText(/Detailed events were already compacted/)).toBeTruthy();
  });

  it("reports export errors without presenting a completed download", async () => {
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 2 },
      evidenceExport: {
        enabled: true,
        scopes: ["run", "trace"],
        formats: ["json"],
        schemaVersion: 1,
        maxRows: 1_000,
        maxBytes: 1_000_000,
        maxTimeRangeMs: 2_592_000_000,
        content: "operational_summaries_and_bounded_detail",
        redactionReapplied: true,
      },
    });
    api.fetchMissionRuns.mockResolvedValue([run]);
    api.fetchMissionRun.mockResolvedValue({ run, events: [event] });
    api.fetchMissionExport.mockRejectedValue(new Error("Evidence scope exceeds the byte limit."));

    render(<MissionControlScreen />);
    expect(await screen.findByText("Transcript accepted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    expect(await screen.findByText("Evidence scope exceeds the byte limit.")).toBeTruthy();
    expect(api.saveMissionExport).not.toHaveBeenCalled();
  });

  it("filters to provider-neutral communications and exposes sanitized Claude evidence", async () => {
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 9 },
    });
    api.fetchMissionRuns.mockImplementation(async (_limit: number, category: string) =>
      category === "communications" ? [claudeCommunicationRun] : [run]);
    api.fetchMissionRun.mockImplementation(async (id: string) => id === claudeCommunicationRun.id
      ? { run: claudeCommunicationRun, events: [claudeCommunicationEvent] }
      : { run, events: [event] });

    render(<MissionControlScreen />);
    expect(await screen.findByText("Transcript accepted")).toBeTruthy();
    const communications = screen.getByRole("button", { name: "Communications" });
    expect(communications.tabIndex).toBe(0);
    fireEvent.click(communications);

    expect(await screen.findByText("Claude response received")).toBeTruthy();
    expect(api.fetchMissionRuns).toHaveBeenCalledWith(75, "communications");
    const evidenceRegion = screen.getByRole("region", { name: "Communication evidence" });
    expect(evidenceRegion.textContent).toContain("AVA");
    expect(evidenceRegion.textContent).toContain("Claude Code");
    expect(screen.getAllByText("Sanitized evidence recorded")).toHaveLength(2);
    expect(screen.getByText("Parent chat-parent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Stop agent communication/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open exact watcher/i })).toBeNull();

    fireEvent.click(screen.getByText("Sanitized request summary"));
    expect(screen.getAllByText("Compare the two cache strategies")).toHaveLength(2);
    fireEvent.click(screen.getByText("Sanitized outcome summary"));
    expect(screen.getAllByText("Prefer the bounded cache.")).toHaveLength(2);
  });

  it("labels Codex distinctly and exposes only its exact-thread terminal result", async () => {
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 10 },
    });
    api.fetchMissionRuns.mockResolvedValue([codexCommunicationRun]);
    api.fetchMissionRun.mockResolvedValue({
      run: codexCommunicationRun,
      events: [codexCommunicationEvent],
      navigation: { kind: "watcher", availability: "available", watcherId: "watch-1" },
    });

    render(<MissionControlScreen />);

    expect(await screen.findByText("Codex task boundary completed")).toBeTruthy();
    const evidenceRegion = screen.getByRole("region", { name: "Communication evidence" });
    expect(evidenceRegion.textContent).toContain("AVA");
    expect(evidenceRegion.textContent).toContain("Codex");
    expect(screen.getAllByText("Sanitized evidence recorded")).toHaveLength(2);
    expect(screen.getByText("Exact-thread terminal result")).toBeTruthy();
    fireEvent.click(screen.getByText("Sanitized outcome summary"));
    expect(screen.getAllByText("Implemented and tested the bounded task.")).toHaveLength(2);
    expect(screen.getAllByText("Not reported").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole("button", { name: /retry|send|approve/i })).toBeNull();
    const exactWatcher = screen.getByRole("link", { name: "Open exact watcher in Watches" });
    expect(exactWatcher.getAttribute("href")).toBe("/?view=watches&watch=watch-1&from=mission-control");
    exactWatcher.focus();
    expect(document.activeElement).toBe(exactWatcher);
    expect(screen.getByText("Exact watcher record available")).toBeTruthy();
  });

  it("keeps a completed Codex result explicitly not recorded when terminal content is absent", async () => {
    const unavailableRun = {
      ...codexCommunicationRun,
      outcome: "task_boundary_observed_response_not_recorded",
      compactSummary: "Codex reached a completed task boundary without recorded result content.",
    };
    const unavailableEvent = {
      ...codexCommunicationEvent,
      payload: {
        ...codexCommunicationEvent.payload as Record<string, unknown>,
        responseAvailability: "not_recorded",
        responseEvidenceProvenance: null,
      },
    };
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 10 },
    });
    api.fetchMissionRuns.mockResolvedValue([unavailableRun]);
    api.fetchMissionRun.mockResolvedValue({
      run: unavailableRun,
      events: [unavailableEvent],
      navigation: { kind: "watcher", availability: "unavailable" },
    });

    render(<MissionControlScreen />);
    expect(await screen.findByText("Codex task boundary completed")).toBeTruthy();
    expect(screen.getByText("Not recorded by this transport")).toBeTruthy();
    expect(screen.getByText("No result content recorded")).toBeTruthy();
    expect(screen.getByText(/Watcher record unavailable/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open exact watcher/i })).toBeNull();
  });

  it("applies a communication lifecycle event from SSE once and preserves the filtered reload", async () => {
    api.fetchMissionMeta.mockResolvedValue({
      ok: true,
      service: "ava-mission-control",
      apiVersion: 1,
      schemaVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      eventBounds: { min: 1, max: 9 },
    });
    api.fetchMissionRuns.mockImplementation(async (_limit: number, category: string) =>
      category === "communications" ? [claudeCommunicationRun] : [run]);
    api.fetchMissionRun.mockImplementation(async (id: string) => id === claudeCommunicationRun.id
      ? { run: claudeCommunicationRun, events: [claudeCommunicationEvent] }
      : { run, events: [event] });

    render(<MissionControlScreen />);
    expect(await screen.findByText("Transcript accepted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Communications" }));
    expect(await screen.findByText("Claude response received")).toBeTruthy();

    const stream = api.subscribeMissionEvents.mock.calls.at(-1)?.[0] as {
      onEvent: (next: MissionEvent) => void;
    };
    const retryEvent: MissionEvent = {
      ...claudeCommunicationEvent,
      seq: 11,
      eventId: "communication-event-11",
      type: "communication.executor.retrying",
      status: "retrying",
      title: "Claude consultation retrying",
      terminal: false,
    };
    act(() => {
      stream.onEvent(retryEvent);
      stream.onEvent(retryEvent);
    });

    expect(screen.getAllByText("Claude consultation retrying")).toHaveLength(1);
    expect(api.fetchMissionRuns).toHaveBeenCalledWith(75, "communications");
  });
});
