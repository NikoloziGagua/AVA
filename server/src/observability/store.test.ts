import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { ObservabilityService, ObservabilityStore } from "./store.js";

describe("Mission Control observability store", () => {
  it("persists only sanitised content and keeps a compact run projection", () => {
    const db = openInMemoryDb();
    const store = new ObservabilityStore(db);
    const run = store.startRun({
      id: "voice-1",
      traceId: "trace-1",
      runKind: "voice_turn",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Send a message; password is hunter2",
      objective: "Authorization: Bearer owner-secret",
      startedAt: 1_000,
    }).run;

    store.recordEvent(run.id, {
      eventId: "evt-tool",
      producerId: "ava",
      producerEventId: "tool-1",
      type: "tool.call.completed",
      status: "success",
      title: "Tool completed",
      visibility: "detail",
      payload: {
        password: "never-store-this",
        headers: { cookie: "sid=private-cookie", accept: "application/json" },
        output: "Authorization: Basic raw-secret\nbody: useful",
      },
      actionId: "action-1",
      actionOwner: "executor",
      terminal: true,
      occurredAt: 1_100,
    });

    const returned = JSON.stringify({
      run: store.getRun(run.id),
      events: store.getEvents(run.id),
    });
    for (const secret of [
      "hunter2",
      "owner-secret",
      "never-store-this",
      "private-cookie",
      "raw-secret",
    ]) expect(returned).not.toContain(secret);
    expect(returned).toContain("application/json");
    expect(returned).toContain("useful");
    db.close();
  });

  it("deduplicates replayed producer events and flags out-of-order events without regressing state", () => {
    const db = openInMemoryDb();
    const store = new ObservabilityStore(db);
    const { run } = store.startRun({
      id: "forge-1",
      traceId: "trace-forge",
      runKind: "forge_run",
      runtimeId: "forge-runtime-1",
      runtimeType: "forge",
      hostRuntimeId: "ava",
      ownerType: "forge",
      title: "Build feature",
      startedAt: 1,
    });

    const first = store.recordEvent(run.id, {
      producerId: "forge:1",
      producerEventId: "journal-2",
      producerSequence: 2,
      type: "forge.stage.started",
      status: "running",
      title: "Stage started",
      occurredAt: 20,
    });
    const replay = store.recordEvent(run.id, {
      producerId: "forge:1",
      producerEventId: "journal-2",
      producerSequence: 2,
      type: "forge.stage.started",
      status: "running",
      title: "Stage started again",
      occurredAt: 20,
    });
    const older = store.recordEvent(run.id, {
      producerId: "forge:1",
      producerEventId: "journal-1",
      producerSequence: 1,
      type: "forge.stage.failed",
      status: "error",
      title: "Late old failure",
      terminal: true,
      runStatus: "failed",
      occurredAt: 10,
    });

    expect(first.inserted).toBe(true);
    expect(replay).toMatchObject({ inserted: false, duplicate: true });
    expect(older.event).toMatchObject({ late: true, projectionApplied: false });
    expect(store.getRun(run.id)?.status).toBe("running");
    expect(store.getEvents(run.id)).toHaveLength(3); // run.created + seq 2 + late seq 1
    db.close();
  });

  it("keeps parent-owned correlation and tolerates a stale optional session link", () => {
    const db = openInMemoryDb();
    const store = new ObservabilityStore(db);
    const parent = store.startRun({
      id: "ava-root",
      traceId: "trace-owned-by-ava",
      runKind: "root_task",
      runtimeType: "ava",
      ownerType: "ava",
      title: "AVA root",
    }).run;
    const child = store.startRun({
      id: "adapter-child",
      traceId: "trace-injected-by-adapter",
      parentRunId: parent.id,
      rootTaskId: "injected-root",
      sessionId: "stale-session-id",
      runKind: "agent_task",
      runtimeType: "external_adapter",
      ownerType: "agent",
      title: "Adapter child",
    }).run;

    expect(child).toMatchObject({
      traceId: parent.traceId,
      parentRunId: parent.id,
      rootTaskId: parent.id,
      sessionId: null,
    });
    db.close();
  });

  it("counts one provider cost and one action when nested observers report the same work", () => {
    const db = openInMemoryDb();
    const store = new ObservabilityStore(db);
    const parent = store.startRun({
      id: "forge-parent",
      traceId: "trace-nested",
      runKind: "forge_run",
      runtimeId: "forge-7",
      runtimeType: "forge",
      hostRuntimeId: "ava",
      ownerType: "forge",
      title: "Forge run",
    }).run;
    const child = store.startRun({
      id: "codex-child",
      traceId: "trace-nested",
      parentRunId: parent.id,
      runKind: "agent_task",
      runtimeId: "codex-2",
      runtimeType: "codex",
      hostRuntimeId: "forge-7",
      ownerType: "agent",
      ownerId: "codex-2",
      ownerRole: "backend-engineer",
      title: "Codex implementation",
    }).run;

    store.recordEvent(parent.id, {
      producerId: "forge-7",
      type: "delegation.observed",
      status: "success",
      title: "Forge observed the nested action",
      actionId: "logical-action-9",
      actionOwner: "router",
      terminal: true,
    });
    store.recordEvent(child.id, {
      producerId: "codex-2",
      type: "tool.call.completed",
      status: "success",
      title: "Codex executed the action",
      actionId: "logical-action-9",
      actionOwner: "executor",
      providerRequestId: "openai-response-44",
      costKind: "actual_provider",
      costMicrousd: 51_000,
      inputTokens: 100,
      outputTokens: 20,
      terminal: true,
    });
    store.recordEvent(parent.id, {
      producerId: "forge-7",
      type: "provider.usage.forwarded",
      status: "success",
      title: "Forge forwarded Codex usage",
      actionId: "logical-action-9",
      actionOwner: "executor",
      providerRequestId: "openai-response-44",
      costKind: "actual_provider",
      costMicrousd: 51_000,
      inputTokens: 100,
      outputTokens: 20,
      terminal: true,
    });

    const events = [
      ...store.getEvents(parent.id),
      ...store.getEvents(child.id),
    ];
    expect(events.filter((event) => event.actionCounted)).toHaveLength(1);
    expect(events.filter((event) => event.accountingApplied && event.costKind === "actual_provider"))
      .toHaveLength(1);
    expect(
      store.getRun(parent.id)!.directCostMicrousd +
      store.getRun(child.id)!.directCostMicrousd,
    ).toBe(51_000);
    db.close();
  });

  it("uses optimistic versioning for Stop and lets the owning handler terminate the run", async () => {
    const db = openInMemoryDb();
    const service = new ObservabilityService(db);
    const run = service.startRun({
      id: "stoppable",
      runKind: "voice_turn",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Working",
    });
    service.registerStopHandler(run.id, () => {
      service.record(run.id, {
        type: "voice.turn.cancelled",
        status: "cancelled",
        title: "Voice turn cancelled",
        terminal: true,
        runStatus: "cancelled",
        outcome: "cancelled_by_user",
        verificationStatus: "not_verified",
      });
      return true;
    });

    const stale = await service.requestStop(run.id, run.version - 1);
    expect(stale).toMatchObject({ ok: false, reason: "stale_version" });

    const current = service.getRun(run.id)!;
    const stopped = await service.requestStop(run.id, current.version);
    expect(stopped.ok).toBe(true);
    expect(service.getRun(run.id)).toMatchObject({
      status: "cancelled",
      outcome: "cancelled_by_user",
      controlAvailable: false,
    });
    db.close();
  });

  it("compacts detailed content after 30 days and removes the compact outcome after 365", () => {
    const db = openInMemoryDb();
    const store = new ObservabilityStore(db);
    const start = 1_000;
    const run = store.startRun({
      id: "retained",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Retained outcome",
      objective: "personal detailed request",
      startedAt: start,
    }).run;
    store.recordEvent(run.id, {
      type: "agent.response.completed",
      status: "success",
      title: "Completed",
      payload: { response: "detailed response" },
      terminal: true,
      runStatus: "completed",
      outcome: "completed_unverified",
      compactSummary: "Compact result",
      occurredAt: start + 100,
    });

    const compacted = store.purgeExpiredDetails(start + 31 * 24 * 60 * 60 * 1_000);
    expect(compacted).toMatchObject({ compactedRuns: 1, deletedRuns: 0 });
    expect(store.getRun(run.id)).toMatchObject({
      objective: null,
      compactSummary: "Compact result",
      retentionClass: "compact_outcome_365d",
      eventCount: 0,
    });

    const removed = store.purgeExpiredDetails(start + 366 * 24 * 60 * 60 * 1_000);
    expect(removed.deletedRuns).toBe(1);
    expect(store.getRun(run.id)).toBeNull();
    db.close();
  });
});
