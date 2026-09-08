import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { notesRoutes } from "./notes.js";

let db: Db;
const auth: express.RequestHandler = (_req, _res, next) => next();

function app(queueSelfImprove?: (goal: string) => string) {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/notes", notesRoutes(db, auth, { queueSelfImprove }));
  return instance;
}

beforeEach(() => { db = openInMemoryDb(); });

describe("Notes API", () => {
  it("reserves General as the built-in space instead of creating a duplicate project", async () => {
    const response = await request(app()).post("/api/notes/projects").send({ name: "General" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_project");
  });

  it("creates project spaces and structured notes", async () => {
    const project = await request(app()).post("/api/notes/projects").send({
      name: "AVA Voice",
      description: "Voice reliability",
    }).expect(201);
    const created = await request(app()).post("/api/notes").send({
      title: "Interruptions",
      content: "Speech must stop once and stay stopped.",
      kind: "requirement",
      projectId: project.body.project.id,
      section: "priorities",
      pinned: true,
      links: [{ label: "Spec", url: "https://example.com/spec" }],
    }).expect(201);
    expect(created.body.note).toMatchObject({
      status: "ideas",
      section: "priorities",
      collection: "AVA Voice",
      pinned: true,
    });

    const snapshot = await request(app()).get("/api/notes").expect(200);
    expect(snapshot.body.projects[0]).toMatchObject({ name: "AVA Voice", noteCount: 1 });
    expect(snapshot.body.notes).toHaveLength(1);
  });

  it("rejects stale edits and preserves the latest note", async () => {
    const created = await request(app()).post("/api/notes").send({ content: "Initial" }).expect(201);
    const id = created.body.note.id;
    await request(app()).patch(`/api/notes/${id}`).send({ expectedVersion: 1, status: "doing" }).expect(200);
    const stale = await request(app()).patch(`/api/notes/${id}`).send({ expectedVersion: 1, content: "lost" }).expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version", note: { status: "doing", version: 2 } });
  });

  it("promotes a note to an actionable task draft", async () => {
    const created = await request(app()).post("/api/notes").send({
      title: "Morning brief",
      content: "Combine weather and schedule.",
    }).expect(201);
    const promoted = await request(app()).post(`/api/notes/${created.body.note.id}/promote`).send({
      expectedVersion: 1,
      target: "task",
    }).expect(200);
    expect(promoted.body.prompt).toContain("Turn this AVA Note into a completed task");
    expect(promoted.body.note).toMatchObject({ status: "doing", promotion: { type: "task" } });
  });

  it("queues an approval-gated self-improvement request", async () => {
    const queue = vi.fn(() => "intent-1");
    const created = await request(app(queue)).post("/api/notes").send({
      title: "Improve retries",
      content: "Make browser retries deterministic.",
    }).expect(201);
    const promoted = await request(app(queue)).post(`/api/notes/${created.body.note.id}/promote`).send({
      expectedVersion: 1,
      target: "self_improvement",
    }).expect(200);
    expect(queue).toHaveBeenCalledWith(expect.stringContaining("Improve retries"));
    expect(promoted.body).toMatchObject({ promotionId: "intent-1", note: { promotion: { type: "self_improvement" } } });
  });
});
