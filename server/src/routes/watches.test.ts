import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../state/db.js";
import { createWatch, getWatch } from "../state/watches.js";
import { CommunicationObservabilityRecorder, resolveWatcherCommunicationEvidence } from "../observability/communications.js";
import { ObservabilityService } from "../observability/store.js";
import { watchesRoutes, type WatchesRouteOptions } from "./watches.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(options?: WatchesRouteOptions) {
  const dir = mkdtempSync(join(tmpdir(), "ava-watches-route-"));
  dirs.push(dir);
  const db = openDb(join(dir, "state.db"));
  const app = express();
  const observability = new ObservabilityService(db);
  app.use(express.json());
  const auth = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
  app.use("/api/watches", watchesRoutes(db, auth, options ?? {
    resolveCommunicationEvidence: (id) => resolveWatcherCommunicationEvidence(observability, id),
  }));
  return { app, db, auth, observability };
}

describe("watch management routes", () => {
  it("creates, lists, pauses, resumes, and deletes the same durable watch", async () => {
    const { app, db, auth } = setup();
    const created = await request(app).post("/api/watches").send({
      prompt: "Watch the deployment status",
      interval_minutes: 30,
      once: true,
      kind: "check",
    }).expect(200);
    const id = String(created.body.watch.id);
    expect(created.body.watch).toMatchObject({
      prompt: "Watch the deployment status",
      interval_minutes: 30,
      once: 1,
      enabled: 1,
      kind: "check",
    });

    const listed = await request(app).get("/api/watches").expect(200);
    expect(listed.body.watches).toHaveLength(1);
    expect(listed.body.watches[0].id).toBe(id);

    await request(app).post(`/api/watches/${id}/enabled`).send({ enabled: false }).expect(200);
    expect(getWatch(db, id)?.enabled).toBe(0);
    await request(app).post(`/api/watches/${id}/enabled`).send({ enabled: true }).expect(200);
    expect(getWatch(db, id)?.enabled).toBe(1);

    await request(app).delete(`/api/watches/${id}`).expect(200, { deleted: true });
    expect(getWatch(db, id)).toBeNull();
    expect(auth).toHaveBeenCalledTimes(5);
    db.close();
  });

  it("accepts one-time and daily reminder schedules without exposing Codex creation", async () => {
    const { app, db } = setup();
    const at = Date.now() + 60_000;
    const oneTime = await request(app).post("/api/watches").send({
      prompt: "Stretch",
      run_at: at,
      kind: "reminder",
    }).expect(200);
    expect(oneTime.body.watch).toMatchObject({ run_at: at, kind: "reminder", once: 1 });

    const daily = await request(app).post("/api/watches").send({
      prompt: "Morning brief",
      daily_at: "08:15",
      once: false,
      kind: "reminder",
    }).expect(200);
    expect(daily.body.watch).toMatchObject({ daily_at: "08:15", kind: "reminder", once: 0 });

    await request(app).post("/api/watches").send({
      prompt: "hidden target delivery",
      interval_minutes: 5,
      kind: "codex",
    }).expect(400, { error: "bad_request" });
    db.close();
  });

  it("rejects malformed, missing, and oversized schedules without creating rows", async () => {
    const { app, db } = setup();
    await request(app).post("/api/watches").send({ prompt: "no schedule" }).expect(400);
    await request(app).post("/api/watches").send({ prompt: "too frequent", interval_minutes: 0 }).expect(400);
    await request(app).post("/api/watches").send({ prompt: "too slow", interval_minutes: 1441 }).expect(400);
    await request(app).post("/api/watches").send({ prompt: "bad daily", daily_at: "25:90" }).expect(400);
    const listed = await request(app).get("/api/watches").expect(200);
    expect(listed.body.watches).toEqual([]);
    db.close();
  });

  it("adds exact retained Mission Control evidence only to the matching Codex watch", async () => {
    const { app, db, observability } = setup();
    const ordinary = createWatch(db, { prompt: "Ordinary check", intervalMinutes: 30, kind: "check" });
    const codex = createWatch(db, { prompt: "Codex continuation", runAt: Date.now() + 60_000, kind: "codex" });
    new CommunicationObservabilityRecorder(observability).ensureStarted({
      source: "codex_watcher",
      sourceId: codex.id,
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Codex continuation",
    });

    const listed = await request(app).get("/api/watches").expect(200);
    const byId = new Map(listed.body.watches.map((watch: { id: string }) => [watch.id, watch]));
    expect(byId.get(codex.id)).toMatchObject({
      communication_evidence: {
        availability: "available",
        runId: `communication:codex_watcher:${codex.id}`,
      },
    });
    expect(byId.get(ordinary.id)).not.toHaveProperty("communication_evidence");
    db.close();
  });

  it("revalidates an available receipt to ID-free unavailable after detail retention removes its proof", async () => {
    const { app, db, observability } = setup();
    const codex = createWatch(db, { prompt: "Expiring evidence", runAt: Date.now() + 60_000, kind: "codex" });
    const run = new CommunicationObservabilityRecorder(observability).ensureStarted({
      source: "codex_watcher",
      sourceId: codex.id,
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Expiring evidence",
    })!;

    const available = await request(app).get("/api/watches").expect(200);
    expect(available.body.watches[0].communication_evidence).toEqual({
      availability: "available",
      runId: run.id,
    });

    db.prepare("DELETE FROM observability_events WHERE run_id = ?").run(run.id);
    const unavailable = await request(app).get("/api/watches").expect(200);
    expect(unavailable.body.watches[0].communication_evidence).toEqual({ availability: "unavailable" });
    expect(JSON.stringify(unavailable.body.watches[0].communication_evidence)).not.toContain(run.id);
    db.close();
  });

  it("collapses absent and resolver-failed Codex evidence to the same ID-free state", async () => {
    const absent = setup();
    createWatch(absent.db, { prompt: "No retained trace", runAt: Date.now() + 60_000, kind: "codex" });
    const absentResponse = await request(absent.app).get("/api/watches").expect(200);
    expect(absentResponse.body.watches[0].communication_evidence).toEqual({ availability: "unavailable" });
    expect(JSON.stringify(absentResponse.body.watches[0].communication_evidence)).not.toContain("communication:");
    absent.db.close();

    const failed = setup({ resolveCommunicationEvidence: () => { throw new Error("scope denied"); } });
    createWatch(failed.db, { prompt: "Unavailable scope", runAt: Date.now() + 60_000, kind: "codex" });
    const failedResponse = await request(failed.app).get("/api/watches").expect(200);
    expect(failedResponse.body.watches[0].communication_evidence).toEqual({ availability: "unavailable" });
    expect(JSON.stringify(failedResponse.body)).not.toContain("scope denied");
    failed.db.close();
  });

  it("does not resolve communication evidence outside the authenticated watch scope", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-watches-auth-scope-"));
    dirs.push(dir);
    const db = openDb(join(dir, "state.db"));
    createWatch(db, { prompt: "Private Codex watch", runAt: Date.now() + 60_000, kind: "codex" });
    const resolveCommunicationEvidence = vi.fn(() => ({
      availability: "available" as const,
      runId: "communication:codex_watcher:must-not-leak",
    }));
    const app = express();
    app.use("/api/watches", watchesRoutes(
      db,
      (_req, res) => { res.status(401).json({ error: "unauthorized" }); },
      { resolveCommunicationEvidence },
    ));

    await request(app).get("/api/watches").expect(401, { error: "unauthorized" });
    expect(resolveCommunicationEvidence).not.toHaveBeenCalled();
    db.close();
  });
});
