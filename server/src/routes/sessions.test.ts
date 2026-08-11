import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createSession, listSessions } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { sessionsRoutes } from "./sessions.js";
import { createVisualExplanation } from "../state/visual-explanations.js";
import { requestPathFixture } from "../visual-explanations/fixtures.test-helper.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-sessions-"));
  const db = openDb(join(dir, "x.db"));
  const app = express();
  app.use(express.json());
  // pass-through auth for testing
  const auth = (_req: any, _res: any, next: any) => next();
  app.use("/api/sessions", sessionsRoutes(db, auth));
  return { app, db };
}

describe("sessionsRoutes", () => {
  it("GET /api/sessions returns sessions newest-first", async () => {
    const { app, db } = setup();
    const a = createSession(db, { title: "first" });
    await new Promise((r) => setTimeout(r, 5));
    const b = createSession(db, { title: "second" });
    const res = await request(app).get("/api/sessions").expect(200);
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual([b.id, a.id]);
  });

  it("GET /api/sessions/:id returns the session and its messages in order", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "t" });
    appendMessage(db, { sessionId: s.id, role: "user", content: "hi" });
    appendMessage(db, { sessionId: s.id, role: "assistant", content: "hello" });
    const res = await request(app).get(`/api/sessions/${s.id}`).expect(200);
    expect(res.body.session.id).toBe(s.id);
    expect(res.body.messages.map((m: { content: string }) => m.content)).toEqual(["hi", "hello"]);
  });

  it("GET /api/sessions/:id returns 404 for unknown session", async () => {
    const { app } = setup();
    await request(app).get("/api/sessions/nope").expect(404);
  });

  it("restores exact visual message revisions with assistant history", async () => {
    const { app, db } = setup();
    const session = createSession(db, { title: "inline visual" });
    const visual = createVisualExplanation(db, requestPathFixture, {
      source: "ava_chat",
      sessionId: session.id,
      runId: "run-inline",
    }).visual;
    appendMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "Here is the path.",
      metadata: { visualMessages: [{ visualMessageId: visual.visualMessageId, revision: visual.revision }] },
    });

    const res = await request(app).get(`/api/sessions/${session.id}`).expect(200);
    expect(res.body.messages[0].visualMessages).toHaveLength(1);
    expect(res.body.messages[0].visualMessages[0]).toMatchObject({
      visualMessageId: visual.visualMessageId,
      revision: 1,
      diagramKind: "flowchart",
    });
    expect(res.body.messages[0].visualMessages[0]).not.toHaveProperty("html");
    expect(res.body.messages[0].visualMessages[0]).not.toHaveProperty("svg");
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("204 and removes from listing", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "to delete" });
    await request(app).delete(`/api/sessions/${s.id}`).expect(204);
    expect(listSessions(db).find((x) => x.id === s.id)).toBeUndefined();
  });

  it("404 for unknown id", async () => {
    const { app } = setup();
    await request(app).delete("/api/sessions/unknown").expect(404);
  });

  it("404 if already deleted", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "x" });
    await request(app).delete(`/api/sessions/${s.id}`).expect(204);
    await request(app).delete(`/api/sessions/${s.id}`).expect(404);
  });
});

describe("PATCH /api/sessions/:id", () => {
  it("204 on { pinned: true } and the row reads back pinned=1", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "to pin" });
    await request(app).patch(`/api/sessions/${s.id}`).send({ pinned: true }).expect(204);
    const row = db.prepare("SELECT pinned FROM sessions WHERE id = ?").get(s.id) as { pinned: number };
    expect(row.pinned).toBe(1);
  });

  it("400 on a non-boolean pinned", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "x" });
    await request(app).patch(`/api/sessions/${s.id}`).send({ pinned: "yes" }).expect(400);
  });

  it("400 on missing pinned", async () => {
    const { app, db } = setup();
    const s = createSession(db, { title: "x" });
    await request(app).patch(`/api/sessions/${s.id}`).send({}).expect(400);
  });

  it("404 on an unknown id", async () => {
    const { app } = setup();
    await request(app).patch("/api/sessions/unknown").send({ pinned: true }).expect(404);
  });
});
