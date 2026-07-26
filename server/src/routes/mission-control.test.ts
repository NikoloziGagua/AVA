import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { ObservabilityService } from "../observability/store.js";
import { missionControlRoutes } from "./mission-control.js";

function setup() {
  const db = openInMemoryDb();
  const observability = new ObservabilityService(db);
  const app = express();
  app.use(express.json());
  app.use(
    "/api/mission-control",
    missionControlRoutes((_req, _res, next) => next(), observability),
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
});
