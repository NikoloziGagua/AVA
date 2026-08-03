// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MissionEvent, MissionRun } from "../api.js";

const api = vi.hoisted(() => ({
  fetchMissionMeta: vi.fn(),
  fetchMissionRuns: vi.fn(),
  fetchMissionRun: vi.fn(),
  stopMissionRun: vi.fn(),
  subscribeMissionEvents: vi.fn(() => () => {}),
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
  });
});
