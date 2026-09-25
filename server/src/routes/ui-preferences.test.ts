import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { openDb } from "../state/db.js";
import { uiPreferencesRoutes } from "./ui-preferences.js";

function app(authorized = true) {
  const db = openDb(":memory:");
  const value = express();
  value.use(express.json());
  value.use("/api/ui/preferences", uiPreferencesRoutes(db, authorized
    ? (_req, _res, next) => next()
    : (_req, res) => { res.status(401).json({ error: "unauthorized" }); }));
  return value;
}

describe("UI preferences routes", () => {
  it("requires authentication", async () => {
    await request(app(false)).get("/api/ui/preferences").expect(401);
    await request(app(false)).patch("/api/ui/preferences")
      .send({ expectedVersion: 1, look: "paper" }).expect(401);
  });

  it("reads defaults and applies a versioned partial update", async () => {
    const value = app();
    const initial = await request(value).get("/api/ui/preferences").expect(200);
    expect(initial.body.preferences).toMatchObject({
      look: "ink", motion: "full", faceEnabled: true, version: 1,
    });
    const changed = await request(value).patch("/api/ui/preferences")
      .send({ expectedVersion: 1, look: "paper", motion: "system" }).expect(200);
    expect(changed.body.preferences).toMatchObject({
      look: "paper", motion: "system", faceEnabled: true, version: 2,
    });
  });

  it("returns the authoritative current row on a stale write", async () => {
    const value = app();
    await request(value).patch("/api/ui/preferences")
      .send({ expectedVersion: 1, faceEnabled: false }).expect(200);
    const stale = await request(value).patch("/api/ui/preferences")
      .send({ expectedVersion: 1, look: "paper" }).expect(409);
    expect(stale.body).toMatchObject({
      error: "stale_version",
      preferences: { look: "ink", motion: "full", faceEnabled: false, version: 2 },
    });
  });

  it("rejects invalid enums, unknown fields and an empty patch", async () => {
    const value = app();
    await request(value).patch("/api/ui/preferences")
      .send({ expectedVersion: 1, motion: "cinematic" }).expect(400);
    await request(value).patch("/api/ui/preferences")
      .send({ expectedVersion: 1, secret: "no" }).expect(400);
    await request(value).patch("/api/ui/preferences")
      .send({ expectedVersion: 1 }).expect(400);
  });
});
