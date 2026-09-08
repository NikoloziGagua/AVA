import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { ObservabilityService } from "../observability/store.js";
import { missionControlRoutes } from "./mission-control.js";
import {
  MISSION_CONTROL_EXPORT_MAX_ROWS,
} from "../observability/export.js";
import { requireToken } from "../auth/middleware.js";
import { issueToken } from "../auth/tokens.js";

function setup(auth: RequestHandler = (_req, _res, next) => next()) {
  const db = openInMemoryDb();
  const observability = new ObservabilityService(db);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/mission-control",
    missionControlRoutes(auth, observability),
  );
  return { app, db, observability };
}

function setupAuthenticated() {
  const db = openInMemoryDb();
  const observability = new ObservabilityService(db);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/mission-control",
    missionControlRoutes(requireToken(db), observability),
  );
  return { app, db, observability };
}

describe("Mission Control API", () => {
  it("exposes the conservative v1 decisions and Forge adapter boundary", async () => {
    const { app, db } = setup();
    const response = await request(app).get("/api/mission-control/meta").expect(200);
    expect(response.body).toMatchObject({
      service: "ava-mission-control",
      apiVersion: 1,
      serverAuthority: "ava",
      controls: ["stop"],
      defaults: {
        autoOpen: false,
        detailedRetentionDays: 30,
        compactRetentionDays: 365,
        screenshots: "off",
        approvalOwner: "ava",
      },
      coverage: {
        openAiRealtimeVoice: "vertical_slice",
        forge: "adapter_contract_ready_not_connected",
      },
      forge: { boundary: "separate_runtime_ava_integrated" },
      evidenceExport: {
        enabled: true,
        scopes: ["run", "trace"],
        formats: ["json"],
        redactionReapplied: true,
      },
    });
    expect(response.body.forge.canonicalRoles).toHaveLength(11);
    db.close();
  });

  it("lists correlated parent/child runs and returns their sanitized events", async () => {
    const { app, db, observability } = setup();
    const root = observability.startRun({
      id: "voice-root",
      traceId: "trace-shared",
      rootTaskId: "voice-root",
      runKind: "voice_session",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Voice",
    });
    observability.startRun({
      id: "agent-child",
      traceId: root.traceId,
      parentRunId: root.id,
      rootTaskId: root.id,
      runKind: "voice_action",
      runtimeType: "ava",
      ownerType: "agent",
      title: "Send message",
      objective: "password: this-must-not-remain",
    });
    observability.record("agent-child", {
      type: "tool.call.started",
      status: "running",
      title: "Started tool",
      payload: { authorization: "Bearer impossible-secret", recipient: "Niko" },
    });

    const list = await request(app).get("/api/mission-control/runs").expect(200);
    expect(list.body.runs.map((run: { id: string }) => run.id)).toEqual(
      expect.arrayContaining(["voice-root", "agent-child"]),
    );
    const detail = await request(app)
      .get("/api/mission-control/runs/agent-child")
      .expect(200);
    expect(detail.body.run).toMatchObject({
      traceId: "trace-shared",
      parentRunId: "voice-root",
      rootTaskId: "voice-root",
    });
    const serialized = JSON.stringify(detail.body);
    expect(serialized).not.toContain("this-must-not-remain");
    expect(serialized).not.toContain("impossible-secret");
    expect(serialized).toContain("***");
    db.close();
  });

  it("makes Stop the only mutation and rejects stale windows", async () => {
    const { app, db, observability } = setup();
    const started = observability.startRun({
      id: "controlled",
      runKind: "chat_agent",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Controlled run",
    });
    observability.registerStopHandler(started.id, async () => {
      observability.record(started.id, {
        type: "agent.run.cancelled",
        status: "cancelled",
        title: "Stopped",
        terminal: true,
        runStatus: "cancelled",
        outcome: "cancelled_by_user",
      });
      return true;
    });
    const current = observability.getRun(started.id)!;

    await request(app)
      .post(`/api/mission-control/runs/${started.id}/stop`)
      .send({ expectedVersion: current.version - 1 })
      .expect(409);

    const accepted = await request(app)
      .post(`/api/mission-control/runs/${started.id}/stop`)
      .send({ expectedVersion: current.version })
      .expect(202);
    expect(accepted.body.run).toMatchObject({
      status: "cancelled",
      outcome: "cancelled_by_user",
      controlAvailable: false,
    });
    db.close();
  });

  it("does not strand a run in cancelling when its owner rejects Stop", async () => {
    const { app, db, observability } = setup();
    const started = observability.startRun({
      id: "owner-race",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "agent",
      title: "Owner race",
    });
    observability.registerStopHandler(started.id, () => false);
    const current = observability.getRun(started.id)!;

    const response = await request(app)
      .post(`/api/mission-control/runs/${started.id}/stop`)
      .send({ expectedVersion: current.version })
      .expect(409);

    expect(response.body).toMatchObject({
      error: "not_running",
      run: { status: "running", controlAvailable: true },
    });
    expect(observability.getEvents(started.id).at(-1)).toMatchObject({
      type: "control.stop_failed",
      status: "error",
    });
    db.close();
  });

  it("authenticates export and derives trace scope from the selected run", async () => {
    const authenticated = setupAuthenticated();
    await request(authenticated.app)
      .get("/api/mission-control/runs/anything/export?scope=run&format=json")
      .expect(401);
    const token = issueToken(authenticated.db, { label: "export-test" });
    authenticated.observability.startRun({
      id: "authenticated-export",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Authenticated export",
    });
    await request(authenticated.app)
      .get("/api/mission-control/runs/authenticated-export/export?scope=run&format=json")
      .set("Authorization", `Bearer ${token.secret}`)
      .expect(200);
    authenticated.db.close();

    const { app, db, observability } = setup();
    const root = observability.startRun({
      id: "export-route-root",
      traceId: "trace-route",
      rootTaskId: "export-route-root",
      runKind: "voice_session",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Root export",
      objective: "password: do-not-copy-objective",
      startedAt: 10_000,
    });
    const child = observability.startRun({
      id: "export-route-child",
      parentRunId: root.id,
      runKind: "tool_action",
      runtimeType: "ava",
      ownerType: "agent",
      title: "Child export",
      startedAt: 10_010,
    });
    observability.record(child.id, {
      producerId: "fixture",
      producerEventId: "verified-child",
      spanId: "child-span",
      parentSpanId: "root-span",
      causationEventId: "cause-event",
      type: "tool.result",
      status: "success",
      title: "Verified result",
      summary: "Independent evidence recorded.",
      actionId: "stable-action",
      actionOwner: "executor",
      providerRequestId: "provider-request-safe",
      terminal: true,
      runStatus: "completed",
      outcome: "completed",
      verificationStatus: "verified",
      occurredAt: 10_020,
    });
    observability.startRun({
      id: "foreign-export-route",
      traceId: "trace-foreign-route",
      runKind: "chat_agent",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Must not leak",
      startedAt: 10_030,
    });
    const before = observability.getRun(child.id)!;
    const beforeEventCount = db.prepare(
      "SELECT COUNT(*) AS value FROM observability_events",
    ).get() as { value: number };

    const response = await request(app)
      .get(`/api/mission-control/runs/${child.id}/export?scope=trace&format=json`)
      .expect(200)
      .expect("Cache-Control", "no-store")
      .expect("X-Content-Type-Options", "nosniff");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.body).toMatchObject({
      service: "ava-mission-control",
      format: "json",
      exportSchemaVersion: 1,
      scope: {
        type: "trace",
        anchorRunId: child.id,
        traceId: root.traceId,
      },
      snapshot: { rule: "events_at_or_before_high_water" },
      completeness: { partial: false, truncated: false },
      redaction: { reappliedAtExport: true },
    });
    expect(response.body.runs.map((run: { id: string }) => run.id)).toEqual([
      root.id,
      child.id,
    ]);
    expect(response.body.events.every((event: { traceId: string }) => event.traceId === root.traceId)).toBe(true);
    expect(response.body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: child.id,
        parentSpanId: "root-span",
        causationEventId: "cause-event",
        action: expect.objectContaining({ id: "stable-action", owner: "executor" }),
        providerRequestId: "provider-request-safe",
      }),
    ]));
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("do-not-copy-objective");
    expect(serialized).not.toContain("Must not leak");
    expect(observability.getRun(child.id)!.version).toBe(before.version);
    const afterEventCount = db.prepare(
      "SELECT COUNT(*) AS value FROM observability_events",
    ).get() as { value: number };
    expect(afterEventCount.value).toBe(beforeEventCount.value);
    db.close();
  });

  it("rejects malformed, missing and row-oversized export scopes honestly", async () => {
    const { app, db, observability } = setup();
    const run = observability.startRun({
      id: "bounded-export",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Bounded export",
    });
    await request(app)
      .get(`/api/mission-control/runs/${run.id}/export?scope=run&unexpected=true`)
      .expect(400);
    await request(app)
      .get("/api/mission-control/runs/not-present/export?scope=run")
      .expect(404);

    // One run + its creation event already consume two rows.
    for (let index = 0; index < MISSION_CONTROL_EXPORT_MAX_ROWS - 1; index += 1) {
      observability.record(run.id, {
        producerId: "row-limit-fixture",
        producerEventId: `row-${index}`,
        type: "fixture.row",
        status: "running",
        title: `Row ${index}`,
      });
    }
    const oversized = await request(app)
      .get(`/api/mission-control/runs/${run.id}/export?scope=run`)
      .expect(413);
    expect(oversized.body).toMatchObject({
      error: "mission_export_row_limit",
      limit: MISSION_CONTROL_EXPORT_MAX_ROWS,
      observed: { totalRows: MISSION_CONTROL_EXPORT_MAX_ROWS + 1 },
    });
    db.close();
  });

  it("rejects a byte-oversized export instead of returning a partial file", async () => {
    const { app, db, observability } = setup();
    const run = observability.startRun({
      id: "byte-bounded-export",
      runKind: "agent_task",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Byte bounded export",
    });
    const large = "x".repeat(20_000);
    for (let index = 0; index < 55; index += 1) {
      observability.record(run.id, {
        producerId: "byte-limit-fixture",
        producerEventId: `bytes-${index}`,
        type: "fixture.bytes",
        status: "running",
        title: `Large evidence ${index}`,
        summary: large,
      });
    }
    const oversized = await request(app)
      .get(`/api/mission-control/runs/${run.id}/export?scope=run`)
      .expect(413);
    expect(oversized.body).toMatchObject({
      error: "mission_export_byte_limit",
    });
    db.close();
  });
});
