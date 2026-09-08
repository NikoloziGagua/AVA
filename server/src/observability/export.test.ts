import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { buildMissionControlExport } from "./export.js";
import { ObservabilityService } from "./store.js";

describe("Mission Control evidence export", () => {
  it("takes one stable ordered trace snapshot and excludes later arrivals", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const root = observability.startRun({
      id: "export-root",
      traceId: "trace-export",
      runKind: "voice_session",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Root",
      startedAt: 1_000,
    });
    observability.startRun({
      id: "export-child",
      parentRunId: root.id,
      runKind: "tool_action",
      runtimeType: "ava",
      ownerType: "agent",
      title: "Child",
      startedAt: 1_010,
    });
    observability.startRun({
      id: "foreign-run",
      traceId: "trace-foreign",
      runKind: "chat_agent",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Foreign",
      startedAt: 1_020,
    });
    observability.record(root.id, {
      producerId: "fixture",
      producerEventId: "root-progress",
      type: "run.progress",
      status: "running",
      title: "Progress",
      occurredAt: 1_030,
    });

    const selected = observability.store.selectExportSnapshot(root.id, "trace", 100);
    expect(selected.status).toBe("ok");
    if (selected.status !== "ok") throw new Error("snapshot was not selected");
    const highWater = selected.snapshot.highWaterSeq;
    observability.record(root.id, {
      producerId: "fixture",
      producerEventId: "after-snapshot",
      type: "run.progress",
      status: "running",
      title: "After snapshot",
      occurredAt: 1_040,
    });

    expect(selected.snapshot.runs.map((run) => run.id)).toEqual([
      "export-root",
      "export-child",
    ]);
    expect(selected.snapshot.events.map((event) => event.seq)).toEqual(
      [...selected.snapshot.events.map((event) => event.seq)].sort((a, b) => a - b),
    );
    expect(selected.snapshot.events.every((event) => event.seq <= highWater)).toBe(true);
    expect(selected.snapshot.events.some((event) => event.title === "After snapshot")).toBe(false);
    db.close();
  });

  it("re-sanitizes contaminated stored fields and excludes prohibited evidence bodies", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const run = observability.startRun({
      id: "sanitized-export",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "agent",
      title: "Safe",
    });
    const event = observability.record(run.id, {
      producerId: "fixture",
      producerEventId: "unsafe-fixture",
      type: "tool.result",
      status: "success",
      title: "Result",
      visibility: "detail",
      payload: { safe: true },
    }).event!;

    // Simulate legacy/foreign contamination that bypassed the normal write
    // sanitizer. Export must independently enforce the disclosure boundary.
    db.prepare("UPDATE observability_runs SET title = ? WHERE id = ?")
      .run("authorization: Bearer should-never-export", run.id);
    db.prepare("UPDATE observability_events SET sanitised_payload = ? WHERE event_id = ?")
      .run(JSON.stringify({
        authorization: "Bearer impossible-secret",
        cookie: "sid=private-cookie",
        rawAudio: "base64-audio-secret",
        screenshot: "base64-screen-secret",
        providerPayload: { private: "provider-secret" },
        hiddenReasoning: "private chain",
        safe: "retained",
      }), event.eventId);

    const built = buildMissionControlExport({
      store: observability.store,
      anchorRunId: run.id,
      scope: "run",
      apiVersion: 1,
      generatedAt: 50_000,
    });
    expect(built.status).toBe("ok");
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain("should-never-export");
    expect(serialized).not.toContain("impossible-secret");
    expect(serialized).not.toContain("private-cookie");
    expect(serialized).not.toContain("base64-audio-secret");
    expect(serialized).not.toContain("base64-screen-secret");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("private chain");
    expect(serialized).toContain("retained");
    expect(serialized).toContain("***");
    expect(serialized).toContain("[excluded from Mission Control export]");
    db.close();
  });

  it("discloses retention compaction as partial rather than inventing detail", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const now = Date.now();
    const startedAt = now - 31 * 24 * 60 * 60 * 1_000;
    const run = observability.startRun({
      id: "retained-compact",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Old outcome",
      objective: "This detail should expire",
      startedAt,
    });
    observability.record(run.id, {
      producerId: "fixture",
      producerEventId: "old-terminal",
      type: "run.completed",
      status: "success",
      title: "Completed",
      occurredAt: startedAt + 1_000,
      terminal: true,
      runStatus: "completed",
      outcome: "completed",
      compactSummary: "Compact result retained",
    });
    observability.store.purgeExpiredDetails(now);

    const built = buildMissionControlExport({
      store: observability.store,
      anchorRunId: run.id,
      scope: "run",
      apiVersion: 1,
      generatedAt: now,
    });
    expect(built.status).toBe("ok");
    if (built.status !== "ok") throw new Error("export was not built");
    expect(built.document.completeness).toMatchObject({
      evidence: "partial_due_to_retention",
      partial: true,
      truncated: false,
    });
    expect(built.document.events).toEqual([]);
    expect(built.document.runs[0]).toMatchObject({
      compactSummary: "Compact result retained",
      objective: { availableInRetainedRecord: false },
    });
    db.close();
  });

  it("rejects a trace whose observed execution span exceeds the time bound", () => {
    const db = openInMemoryDb();
    const observability = new ObservabilityService(db);
    const now = Date.now();
    const root = observability.startRun({
      id: "long-root",
      runKind: "root",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Long trace",
      startedAt: now - 31 * 24 * 60 * 60 * 1_000,
    });
    observability.startRun({
      id: "late-child",
      parentRunId: root.id,
      runKind: "child",
      runtimeType: "ava",
      ownerType: "agent",
      title: "Late child",
      startedAt: now,
    });
    const built = buildMissionControlExport({
      store: observability.store,
      anchorRunId: root.id,
      scope: "trace",
      apiVersion: 1,
      generatedAt: now,
    });
    expect(built).toMatchObject({ status: "time_range_exceeded" });
    db.close();
  });
});
