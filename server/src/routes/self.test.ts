import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, updateIntent } from "../self/intents.js";
import { selfRoutes } from "./self.js";

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "ava-selfroute-")), "x.db"));
  const start = vi.fn((_id: string) => {});
  const revert = vi.fn((_id: string) => {});
  const cancel = vi.fn((_id: string) => true);
  const approve = vi.fn((_id: string) => true);
  const reject = vi.fn((_id: string) => true);
  const app = express(); app.use(express.json());
  app.use("/api/self", selfRoutes(db, (_q, _s, n) => n(), { startImprovement: start, revert, cancel, approve, reject }));
  return { app, db, start, revert, cancel, approve, reject };
}

describe("/api/self", () => {
  it("POST /improve queues an intent and kicks off the loop", async () => {
    const { app, start } = setup();
    const res = await request(app).post("/api/self/improve").send({ goal: "be faster" }).expect(200);
    expect(res.body.id).toBeTruthy();
    expect(start).toHaveBeenCalledWith(res.body.id);
  });

  it("GET / lists intents newest first", async () => {
    const { app } = setup();
    await request(app).post("/api/self/improve").send({ goal: "x" });
    const res = await request(app).get("/api/self").expect(200);
    expect(res.body.intents.length).toBe(1);
  });

  it("rejects an empty goal", async () => {
    const { app } = setup();
    await request(app).post("/api/self/improve").send({ goal: "" }).expect(400);
  });

  it("POST /:id/revert calls revert when there is a known-good", async () => {
    const { app, db, revert } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    updateIntent(db, id, { last_known_good: "abc123", status: "swapped" });
    await request(app).post(`/api/self/${id}/revert`).expect(200);
    expect(revert).toHaveBeenCalledWith(id);
  });

  it("POST /:id/revert 404s when there is no known-good", async () => {
    const { app, db } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    await request(app).post(`/api/self/${id}/revert`).expect(404);
  });

  it("POST /:id/cancel calls cancel and reports the result", async () => {
    const { app, cancel } = setup();
    const res = await request(app).post("/api/self/some-id/cancel").expect(200);
    expect(cancel).toHaveBeenCalledWith("some-id");
    expect(res.body).toEqual({ ok: true, cancelled: true });
  });

  it("POST /:id/approve calls approve", async () => {
    const { app, approve } = setup();
    const res = await request(app).post("/api/self/some-id/approve").expect(200);
    expect(approve).toHaveBeenCalledWith("some-id");
    expect(res.body).toEqual({ ok: true, approved: true });
  });

  it("POST /:id/reject calls reject", async () => {
    const { app, reject } = setup();
    const res = await request(app).post("/api/self/some-id/reject").expect(200);
    expect(reject).toHaveBeenCalledWith("some-id");
    expect(res.body).toEqual({ ok: true, rejected: true });
  });
});
