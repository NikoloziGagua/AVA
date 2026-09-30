import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { openInMemoryDb } from "../state/db.js";
import { projectRoutes } from "./projects.js";

function setup() {
  const db = openInMemoryDb();
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectRoutes(db, ((_req: unknown, _res: unknown, next: () => void) => next()) as never));
  return app;
}

describe("project routes", () => {
  it("creates, edits with a version, removes and restores a project", async () => {
    const app = setup();
    const created = await request(app).post("/api/projects").send({ name: "Mobile tyre fitting", kind: "business" }).expect(201);
    const id = created.body.project.id;
    await request(app).post("/api/projects").send({ name: "mobile tyre fitting", kind: "business" }).expect(409);
    await request(app).patch(`/api/projects/${id}`).send({ expectedVersion: 5, status: "paused" }).expect(409)
      .expect((res) => expect(res.body.error).toBe("stale_version"));
    const paused = await request(app).patch(`/api/projects/${id}`).send({ expectedVersion: 1, status: "paused" }).expect(200);
    expect(paused.body.project).toMatchObject({ status: "paused", version: 2 });
    await request(app).post(`/api/projects/${id}/remove`).expect(200);
    const listed = await request(app).get("/api/projects").expect(200);
    expect(listed.body.projects).toEqual([]);
    expect(listed.body.removed.map((project: { name: string }) => project.name)).toEqual(["Mobile tyre fitting"]);
    await request(app).post(`/api/projects/${id}/restore`).expect(200);
    expect((await request(app).get("/api/projects").expect(200)).body.projects).toHaveLength(1);
  });

  it("adds and ticks steps, and opens the project's own conversation", async () => {
    const app = setup();
    const id = (await request(app).post("/api/projects").send({ name: "Agile Development", kind: "uni" })).body.project.id;
    const step = (await request(app).post(`/api/projects/${id}/items`).send({ kind: "step", text: "Revise Scrum roles" }).expect(201)).body.item;
    await request(app).patch(`/api/projects/${id}/items/${step.id}`).send({ done: true }).expect(200);
    const detail = (await request(app).get(`/api/projects/${id}`).expect(200)).body;
    expect(detail.steps[0].doneAt).toEqual(expect.any(Number));
    expect(detail.log[0].text).toBe("Done: Revise Scrum roles");
    const talk = (await request(app).post(`/api/projects/${id}/conversation`).expect(200)).body;
    expect(talk).toEqual({ sessionId: expect.any(String), messages: [] });
    expect((await request(app).post(`/api/projects/${id}/conversation`)).body.sessionId).toBe(talk.sessionId);
    await request(app).get("/api/projects/proj_missing").expect(404);
  });
});
