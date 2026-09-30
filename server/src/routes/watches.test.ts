import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../state/db.js";
import { createWatch, deleteWatch, getWatch } from "../state/watches.js";
import { CommunicationObservabilityRecorder, resolveWatcherCommunicationEvidence } from "../observability/communications.js";
import { ObservabilityService } from "../observability/store.js";
import { watchesRoutes, type WatchesRouteOptions } from "./watches.js";
import { requireToken } from "../auth/middleware.js";

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
  it("requires authenticated access for reminder intake and receipts", async () => {
    const { db } = setup();
    const app = express(); app.use(express.json()); app.use("/api/watches", watchesRoutes(db, requireToken(db)));
    await request(app).get("/api/watches").expect(401);
    await request(app).post("/api/watches").send({ kind: "reminder", prompt: "fixture", run_at: Date.now() + 1000, time_zone: "UTC" }).expect(401);
    expect(db.prepare("SELECT count(*) n FROM watches").get()).toEqual({ n: 0 });
    db.close();
  });
  it("validates explicit one-off instants/zones/conflicts with bounded codes and no writes", async () => {
    const { db, app } = setup();
    const good = { prompt: "fixture", kind: "reminder", run_at: Date.now() + 60_000, time_zone: "UTC" };
    const cases = [
      [{ time_zone: undefined }, "invalid_time_zone"],
      [{ time_zone: "private-invalid-zone" }, "invalid_time_zone"],
      [{ run_at: Date.now() - 1 }, "run_at_not_future"],
      [{ run_at: Date.now() + 367 * 86_400_000 }, "run_at_too_far"],
      [{ run_at: Date.now() + 100.5 }, "invalid_run_at"],
      [{ once: false }, "conflicting_schedule"],
      [{ interval_minutes: 5 }, "conflicting_schedule"],
      [{ daily_at: "08:00" }, "conflicting_schedule"],
    ] as const;
    for (const [changes, reasonCode] of cases) {
      await request(app).post("/api/watches").send({ ...good, ...changes }).expect(400, { error: "bad_request", reasonCode });
    }
    await request(app).post("/api/watches").send({ ...good, run_at: "tomorrow" }).expect(400);
    expect(db.prepare("SELECT count(*) n FROM watches").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) n FROM reminder_occurrences").get()).toEqual({ n: 0 });
    db.close();
  });
  it("keeps one exact durable receipt through list/pause/resume and removes it on deletion", async () => {
    const { db, app } = setup();
    const body = { kind: "reminder", prompt: "fixture", run_at: Date.now() + 60_000, time_zone: "UTC", once: true };
    const created = await request(app).post("/api/watches").send(body).expect(200);
    const { id, reminder_status } = created.body.watch;
    expect(reminder_status).toMatchObject({ state: "scheduled", timeZone: "UTC", phoneReceipt: "unconfirmed" });
    expect(JSON.stringify(reminder_status)).not.toMatch(/lease|prompt/);
    await request(app).post(`/api/watches/${id}/enabled`).send({ enabled: false }).expect(200);
    const paused = await request(app).get("/api/watches").expect(200);
    expect(paused.body.watches[0].reminder_status).toMatchObject({ occurrenceId: reminder_status.occurrenceId, state: "paused", reasonCode: "paused" });
    await request(app).post(`/api/watches/${id}/enabled`).send({ enabled: true }).expect(200);
    const resumed = await request(app).get("/api/watches").expect(200);
    expect(resumed.body.watches[0].reminder_status).toEqual(reminder_status);
    await request(app).delete(`/api/watches/${id}`).expect(200);
    expect(db.prepare("SELECT count(*) n FROM reminder_occurrences").get()).toEqual({ n: 0 });
    db.close();
  });
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
      time_zone: "Europe/London",
      kind: "reminder",
    }).expect(200);
    expect(oneTime.body.watch).toMatchObject({ run_at: at, time_zone: "Europe/London", kind: "reminder", once: 1,
      reminder_status: { state: "scheduled", dueAt: at, attempts: 0, phoneReceipt: "unconfirmed" } });

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

  it("revalidates only one exact authenticated receipt across retention and Watch deletion", async () => {
    const { app, db, observability } = setup();
    const codex = createWatch(db, { prompt: "Exact receipt", runAt: Date.now() + 60_000, kind: "codex" });
    const other = createWatch(db, { prompt: "Other receipt", runAt: Date.now() + 60_000, kind: "codex" });
    const recorder = new CommunicationObservabilityRecorder(observability);
    const run = recorder.ensureStarted({
      source: "codex_watcher",
      sourceId: codex.id,
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Exact receipt",
    })!;
    recorder.ensureStarted({
      source: "codex_watcher",
      sourceId: other.id,
      runtimeType: "codex",
      title: "Codex watcher handoff",
      requestSummary: "Other receipt",
    });
    const stateBefore = JSON.stringify(getWatch(db, codex.id));
    const eventCountBefore = (db.prepare("SELECT COUNT(*) AS value FROM observability_events").get() as { value: number }).value;

    await request(app)
      .get(`/api/watches/${codex.id}/communication-evidence`)
      .expect("Cache-Control", "no-store")
      .expect(200, {
        communication_evidence: { availability: "available", runId: run.id },
      });
    expect(JSON.stringify(getWatch(db, codex.id))).toBe(stateBefore);
    expect((db.prepare("SELECT COUNT(*) AS value FROM observability_events").get() as { value: number }).value)
      .toBe(eventCountBefore);

    db.prepare("DELETE FROM observability_events WHERE run_id = ?").run(run.id);
    const expired = await request(app)
      .get(`/api/watches/${codex.id}/communication-evidence`)
      .expect(200);
    expect(expired.body).toEqual({ communication_evidence: { availability: "unavailable" } });
    expect(JSON.stringify(expired.body)).not.toContain(run.id);

    deleteWatch(db, other.id);
    const deleted = await request(app)
      .get(`/api/watches/${other.id}/communication-evidence`)
      .expect(200);
    expect(deleted.body).toEqual({ communication_evidence: { availability: "unavailable" } });
    expect(JSON.stringify(deleted.body)).not.toContain(other.id);
    db.close();
  });

  it("makes malformed, wrong-kind and resolver-error exact receipts indistinguishable", async () => {
    const resolver = vi.fn(() => { throw new Error("private resolver detail"); });
    const { app, db } = setup({ resolveCommunicationEvidence: resolver });
    const ordinary = createWatch(db, { prompt: "Ordinary", intervalMinutes: 30, kind: "check" });
    const codex = createWatch(db, { prompt: "Private", runAt: Date.now() + 60_000, kind: "codex" });

    for (const path of [
      "/api/watches/%2E%2E%2Fprivate/communication-evidence",
      `/api/watches/${ordinary.id}/communication-evidence`,
      `/api/watches/${codex.id}/communication-evidence`,
      "/api/watches/missing/communication-evidence",
    ]) {
      const response = await request(app).get(path).expect(200);
      expect(response.body).toEqual({ communication_evidence: { availability: "unavailable" } });
      expect(JSON.stringify(response.body)).not.toContain("private resolver detail");
      expect(JSON.stringify(response.body)).not.toContain("communication:");
    }
    expect(resolver).toHaveBeenCalledTimes(1);
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
    await request(app)
      .get("/api/watches/private/communication-evidence")
      .expect(401, { error: "unauthorized" });
    expect(resolveCommunicationEvidence).not.toHaveBeenCalled();
    db.close();
  });
});
