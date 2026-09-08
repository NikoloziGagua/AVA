import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../state/db.js";
import { getWatch } from "../state/watches.js";
import { watchesRoutes } from "./watches.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-watches-route-"));
  dirs.push(dir);
  const db = openDb(join(dir, "state.db"));
  const app = express();
  app.use(express.json());
  const auth = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
  app.use("/api/watches", watchesRoutes(db, auth));
  return { app, db, auth };
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
});
