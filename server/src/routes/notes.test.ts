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

  it("exposes a versioned folder tree, exact document reads and folder-aware filters", async () => {
    const university = await request(app()).post("/api/notes/folders").send({ name: "University" }).expect(201);
    const agile = await request(app()).post("/api/notes/folders").send({
      parentId: university.body.folder.id,
      name: "Agile Development",
    }).expect(201);
    const created = await request(app()).post("/api/notes").send({
      folderId: agile.body.folder.id,
      documentType: "study",
      title: "Lecture 1",
      content: "## Key concepts\n\nScrum",
    }).expect(201);

    const exact = await request(app()).get(`/api/notes/${created.body.note.id}`).expect(200);
    expect(exact.body.note).toMatchObject({
      folderId: agile.body.folder.id,
      documentType: "study",
      folderPath: [{ name: "University" }, { name: "Agile Development" }],
    });

    const tree = await request(app()).get("/api/notes/tree").expect(200);
    expect(tree.body.snapshot).toMatchObject({ complete: true });
    expect(tree.body.snapshot.fetchedAt).toEqual(expect.any(Number));
    expect(tree.body.snapshot.version).toEqual(expect.any(String));
    expect(tree.body.folders.find((folder: { id: string }) => folder.id === agile.body.folder.id)).toMatchObject({
      version: 1,
      documentCount: 1,
      path: "University/Agile Development",
    });
    expect(tree.body.documents).toContainEqual(expect.objectContaining({
      id: created.body.note.id,
      folderId: agile.body.folder.id,
      documentType: "study",
    }));

    const subtree = await request(app()).get(`/api/notes?folderId=${university.body.folder.id}&subtree=true`).expect(200);
    expect(subtree.body.notes.map((note: { id: string }) => note.id)).toEqual([created.body.note.id]);
  });

  it("returns stable book-page order and version-guards page reordering", async () => {
    const folder = await request(app()).post("/api/notes/folders").send({ name: "Book" }).expect(201);
    const later = await request(app()).post("/api/notes").send({
      folderId: folder.body.folder.id,
      title: "Later",
      content: "Later page",
      documentPosition: 5,
    }).expect(201);
    const earlier = await request(app()).post("/api/notes").send({
      folderId: folder.body.folder.id,
      title: "Earlier",
      content: "Earlier page",
      documentPosition: 1,
    }).expect(201);

    const tree = await request(app()).get("/api/notes/tree").expect(200);
    expect(tree.body.documents.filter((note: { folderId: string }) => note.folderId === folder.body.folder.id)
      .map((note: { id: string; documentPosition: number }) => [note.id, note.documentPosition]))
      .toEqual([[earlier.body.note.id, 1], [later.body.note.id, 5]]);

    await request(app()).patch(`/api/notes/${later.body.note.id}`).send({
      expectedVersion: later.body.note.version,
      documentPosition: 0,
    }).expect(200);
    await request(app()).patch(`/api/notes/${later.body.note.id}`).send({
      expectedVersion: later.body.note.version,
      documentPosition: 9,
    }).expect(409);
  });

  it("returns typed hierarchy conflicts and protects built-in/non-empty folders", async () => {
    const root = await request(app()).post("/api/notes/folders").send({ name: "University" }).expect(201);
    await request(app()).post("/api/notes/folders").send({ name: "university" }).expect(409, {
      error: "name_conflict",
      message: "a folder with this name already exists here",
    });
    const child = await request(app()).post("/api/notes/folders").send({ parentId: root.body.folder.id, name: "Course" }).expect(201);
    await request(app()).patch(`/api/notes/folders/${child.body.folder.id}`).send({
      expectedVersion: 1,
      parentId: child.body.folder.id,
    }).expect(409, {
      error: "invalid_move",
      message: "a folder cannot be moved inside itself",
    });
    await request(app()).post("/api/notes").send({ folderId: child.body.folder.id, title: "Topic", content: "Body" }).expect(201);
    await request(app()).delete(`/api/notes/folders/${child.body.folder.id}?expectedVersion=1`).expect(409, {
      error: "folder_not_empty",
      message: "move or delete this folder's contents first",
    });
    await request(app()).delete("/api/notes/folders/notes_general?expectedVersion=1").expect(409, {
      error: "invalid_move",
      message: "the built-in General folder cannot be deleted",
    });
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
