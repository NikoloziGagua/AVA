import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requireToken } from "../auth/middleware.js";
import { issueToken } from "../auth/tokens.js";
import { openInMemoryDb } from "../state/db.js";
import { UfoExperimentService } from "../ufo/experiment.js";
import { ufoExperimentRoutes } from "./ufo-experiment.js";

function setup(auth: RequestHandler) {
  const db = openInMemoryDb();
  const service = new UfoExperimentService(db, { enabled: false, mode: "off", isolation: "none",
    allowFixtureActions: false, allowedFixtures: ["counter-v1"], timeoutMs: 500, maxSteps: 3 });
  const app = express();
  app.use("/api/ufo-experiment", ufoExperimentRoutes(auth, service));
  return { app, db, service };
}

describe("UFO experiment read-only routes", () => {
  it("requires authentication and reports default-off truthfully", async () => {
    const initial = setup((_req, res) => { res.status(401).json({ error: "unauthorized" }); });
    await request(initial.app).get("/api/ufo-experiment/health").expect(401);
    initial.db.close();

    const db = openInMemoryDb();
    const service = new UfoExperimentService(db, { enabled: false, mode: "off", isolation: "none",
      allowFixtureActions: false, allowedFixtures: ["counter-v1"], timeoutMs: 500, maxSteps: 3 });
    const app = express();
    app.use("/api/ufo-experiment", ufoExperimentRoutes(requireToken(db), service));
    const token = issueToken(db, { label: "test" }).secret;
    const response = await request(app).get("/api/ufo-experiment/health")
      .set("authorization", `Bearer ${token}`).expect(200);
    expect(response.body).toMatchObject({ experimental: true, enabled: false, available: false });
    db.close();
  });

  it("provides only validated readback and no mutation route", async () => {
    const db = openInMemoryDb();
    const service = new UfoExperimentService(db, { enabled: true, mode: "fixture", isolation: "synthetic-fixture-v1",
      allowFixtureActions: false, allowedFixtures: ["counter-v1"], timeoutMs: 500, maxSteps: 3 });
    const app = express();
    app.use(express.json());
    app.use("/api/ufo-experiment", ufoExperimentRoutes((_req, _res, next) => next(), service));
    const record = await service.run({ requestKey: "route.observe.1", fixtureId: "counter-v1", operation: "observe" });
    await request(app).get(`/api/ufo-experiment/requests/${record.id}`).expect(200)
      .expect((res) => expect(res.body).toMatchObject({ id: record.id, status: "completed" }));
    await request(app).get("/api/ufo-experiment/requests/not-valid").expect(400);
    await request(app).post("/api/ufo-experiment/requests").send({}).expect(404);
    db.close();
  });
});
