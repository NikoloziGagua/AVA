import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { ObservabilityService } from "./store.js";
import {
  COMMUNICATION_RUN_KIND,
  CommunicationObservabilityRecorder,
  communicationRunId,
  resolveWatcherCommunicationEvidence,
} from "./communications.js";

describe("CommunicationObservabilityRecorder", () => {
  it("creates one correlated provider-neutral run and deduplicates replayed lifecycle events", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const parent = observability.startRun({
      id: "chat-parent",
      traceId: "trace-parent",
      runKind: "chat_agent",
      runtimeType: "ava",
      ownerType: "ava",
      title: "AVA chat request",
    });
    const recorder = new CommunicationObservabilityRecorder(observability);
    const input = {
      source: "provider_discussion" as const,
      sourceId: "discussion-1",
      runtimeType: "claude_code" as const,
      title: "Claude background discussion",
      requestSummary: "Compare the cache options",
      parentRunId: parent.id,
      startedAt: 1_000,
    };

    recorder.ensureStarted(input);
    recorder.ensureStarted(input);
    recorder.record("provider_discussion", input.sourceId, {
      phase: "executor.running",
      status: "running",
      title: "Claude consultation running",
      runStatus: "running",
      occurredAt: 1_100,
    });
    const complete = {
      phase: "response.completed",
      status: "success",
      title: "Claude response received",
      responseSummary: "Prefer bounded caching.",
      responseAvailability: "sanitized_recorded" as const,
      responseEvidenceProvenance: "provider_result_boundary" as const,
      terminal: true,
      runStatus: "completed" as const,
      outcome: "response_received_unverified",
      verificationStatus: "partially_verified" as const,
      occurredAt: 1_200,
      durationMs: 100,
    };
    recorder.record("provider_discussion", input.sourceId, complete);
    recorder.record("provider_discussion", input.sourceId, complete);

    const runId = communicationRunId("provider_discussion", input.sourceId);
    const run = observability.getRun(runId)!;
    expect(run).toMatchObject({
      traceId: parent.traceId,
      parentRunId: parent.id,
      rootTaskId: parent.id,
      runKind: COMMUNICATION_RUN_KIND,
      runtimeType: "claude_code",
      status: "completed",
      verificationStatus: "partially_verified",
      outcome: "response_received_unverified",
      controlAvailable: false,
    });
    expect(observability.getEvents(runId).map((event) => event.type)).toEqual([
      "run.created",
      "communication.queued",
      "communication.executor.running",
      "communication.response.completed",
    ]);
    expect(observability.getEvents(runId).at(-1)?.payload).toMatchObject({
      communicationSource: "provider_discussion",
      evidenceProvenance: "ava_observed_boundary",
      responseEvidenceProvenance: "provider_result_boundary",
      trustBoundary: {
        from: "ava_orchestrator",
        to: "external_executor",
      },
    });
    expect(observability.listRuns({ runKind: COMMUNICATION_RUN_KIND })).toHaveLength(1);
    db.close();
  });

  it("bounds and sanitizes request, response and error evidence before readback", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const recorder = new CommunicationObservabilityRecorder(observability);
    recorder.ensureStarted({
      source: "provider_discussion",
      sourceId: "secret-discussion",
      runtimeType: "claude_code",
      title: "Claude discussion",
      requestSummary: `Authorization: Bearer request-secret\n${"x".repeat(2_200)}`,
    });
    recorder.record("provider_discussion", "secret-discussion", {
      phase: "response.received",
      status: "running",
      title: "Claude response received",
      responseSummary: `API_KEY=response-secret\n${"z".repeat(4_200)}`,
      responseAvailability: "sanitized_recorded",
      responseEvidenceProvenance: "provider_result_boundary",
      runStatus: "running",
    });
    recorder.record("provider_discussion", "secret-discussion", {
      phase: "response.failed",
      status: "error",
      title: "Claude discussion failed",
      responseAvailability: "unavailable",
      error: `API_KEY=failure-secret\n${"y".repeat(2_200)}`,
      terminal: true,
      runStatus: "failed",
      outcome: "provider_discussion_failed",
      verificationStatus: "not_verified",
    });

    const runId = communicationRunId("provider_discussion", "secret-discussion");
    const serialized = JSON.stringify({
      run: observability.getRun(runId),
      events: observability.getEvents(runId),
    });
    expect(serialized).not.toContain("request-secret");
    expect(serialized).not.toContain("response-secret");
    expect(serialized).not.toContain("failure-secret");
    expect(serialized).toContain("***");
    expect(serialized).toContain("truncated by communication boundary");
    expect(observability.getRun(runId)).toMatchObject({ status: "failed", verificationStatus: "not_verified" });
    db.close();
  });

  it("keeps late signals as history without rewriting a terminal outcome", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const recorder = new CommunicationObservabilityRecorder(observability);
    recorder.ensureStarted({
      source: "codex_watcher",
      sourceId: "watch-1",
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Implement one bounded slice",
    });
    recorder.record("codex_watcher", "watch-1", {
      phase: "response.completed",
      status: "success",
      title: "Codex task boundary completed",
      responseAvailability: "not_recorded",
      terminal: true,
      runStatus: "completed",
      outcome: "task_boundary_observed_response_not_recorded",
      verificationStatus: "partially_verified",
      occurredAt: 2_000,
    });
    recorder.record("codex_watcher", "watch-1", {
      phase: "dispatch.retrying",
      status: "retrying",
      title: "Stale retry",
      error: "late signal",
      runStatus: "retrying",
      occurredAt: 1_900,
    });

    const runId = communicationRunId("codex_watcher", "watch-1");
    expect(observability.getRun(runId)).toMatchObject({
      status: "completed",
      outcome: "task_boundary_observed_response_not_recorded",
    });
    expect(observability.getEvents(runId).at(-1)).toMatchObject({
      type: "communication.dispatch.retrying",
      late: true,
      projectionApplied: false,
    });
    db.close();
  });

  it("resolves one retained exact watcher envelope and rejects zero or malformed evidence", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const recorder = new CommunicationObservabilityRecorder(observability);
    expect(resolveWatcherCommunicationEvidence(observability, "missing-watch")).toEqual({
      availability: "unavailable",
    });
    expect(resolveWatcherCommunicationEvidence(observability, "../malformed")).toEqual({
      availability: "unavailable",
    });

    recorder.ensureStarted({
      source: "codex_watcher",
      sourceId: "watch-exact",
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Continue the exact task",
    });
    expect(resolveWatcherCommunicationEvidence(observability, "watch-exact")).toEqual({
      availability: "available",
      runId: communicationRunId("codex_watcher", "watch-exact"),
    });
    db.close();
  });

  it("fails closed for conflicting identity or retention-compacted detail", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const recorder = new CommunicationObservabilityRecorder(observability);
    recorder.ensureStarted({
      source: "codex_watcher",
      sourceId: "watch-ambiguous",
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Continue the exact task",
    });
    const runId = communicationRunId("codex_watcher", "watch-ambiguous");
    observability.record(runId, {
      producerId: "identity-conflict-fixture",
      producerEventId: "conflicting-source",
      type: "communication.identity.conflict",
      status: "observed",
      title: "Conflicting identity fixture",
      payload: { communicationSource: "codex_watcher", sourceId: "another-watch" },
    });
    expect(resolveWatcherCommunicationEvidence(observability, "watch-ambiguous")).toEqual({
      availability: "unavailable",
    });

    recorder.ensureStarted({
      source: "codex_watcher",
      sourceId: "watch-compacted",
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Retained compact record",
    });
    const compactedRunId = communicationRunId("codex_watcher", "watch-compacted");
    db.prepare("DELETE FROM observability_events WHERE run_id = ?").run(compactedRunId);
    expect(observability.getRun(compactedRunId)).not.toBeNull();
    expect(resolveWatcherCommunicationEvidence(observability, "watch-compacted")).toEqual({
      availability: "unavailable",
    });
    db.close();
  });
});
