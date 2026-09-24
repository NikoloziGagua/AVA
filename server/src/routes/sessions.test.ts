import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createSession, listSessions, markHumanActivity, setPinned, setStatus, softDeleteSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { sessionsRoutes } from "./sessions.js";
import { createResearchVisual, createVisualExplanation } from "../state/visual-explanations.js";
import { requestPathFixture } from "../visual-explanations/fixtures.test-helper.js";
import { vikingMapFixture } from "../visual-explanations/research-fixtures.test-helper.js";

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

  it("restores cited research visuals from exact assistant-message revisions", async () => {
    const { app, db } = setup();
    const session = createSession(db, { title: "research visual" });
    const visual = createResearchVisual(db, vikingMapFixture, {
      source: "ava_chat", sessionId: session.id, runId: "run-research-inline",
    }).visual;
    appendMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "Here is the cited map.",
      metadata: { visualMessages: [{ visualMessageId: visual.visualMessageId, revision: visual.revision }] },
    });

    const res = await request(app).get(`/api/sessions/${session.id}`).expect(200);
    expect(res.body.messages[0].visualMessages[0]).toMatchObject({
      visualMessageId: visual.visualMessageId,
      revision: 1,
      schemaVersion: "2.0",
      diagramKind: "geographic_map",
    });
    expect(res.body.messages[0].visualMessages[0].sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sourcePrimary", url: "https://example.org/research/primary" }),
    ]));
    expect(res.body.messages[0].visualMessages[0]).not.toHaveProperty("html");
  });
});

describe("scoped sessions history", () => {
  it("preserves the no-query response and includes provenance in exact reads", async () => {
    const { app, db } = setup();
    const human = createSession(db, { origin: "human" });
    const automation = createSession(db, { origin: "automation" });
    markHumanActivity(db, human.id, 123);
    const old = await request(app).get("/api/sessions").expect(200);
    expect(old.body).not.toHaveProperty("nextCursor");
    expect(old.body.sessions).toHaveLength(2);
    const exact = await request(app).get(`/api/sessions/${human.id}`).expect(200);
    expect(exact.body.session).toMatchObject({ origin: "human", last_human_activity_at: 123 });
    const audit = await request(app).get(`/api/sessions/${automation.id}`).expect(200);
    expect(audit.body.session).toMatchObject({ origin: "automation", last_human_activity_at: null });
    softDeleteSession(db, human.id);
    await request(app).get(`/api/sessions/${human.id}`).expect(404);
    db.close();
  });

  it("separates human, automation and legacy scopes while preserving pinned legacy", async () => {
    const { app, db } = setup();
    const human = createSession(db, { origin: "human" });
    const automation = createSession(db, { origin: "automation" });
    const legacy = createSession(db, {});
    const pinnedLegacy = createSession(db, {});
    const activeLegacy = createSession(db, {});
    const archived = createSession(db, { origin: "human" });
    markHumanActivity(db, human.id, 100);
    markHumanActivity(db, activeLegacy.id, 200);
    setPinned(db, pinnedLegacy.id, true);
    setPinned(db, automation.id, true);
    setStatus(db, archived.id, "archived");
    const humans = await request(app).get("/api/sessions?scope=human").expect(200);
    expect(humans.body.sessions.map((s: { id: string }) => s.id)).toEqual([pinnedLegacy.id, activeLegacy.id, human.id]);
    expect(humans.body.nextCursor).toBeNull();
    const automated = await request(app).get("/api/sessions?scope=automation").expect(200);
    expect(automated.body.sessions.map((s: { id: string }) => s.id)).toEqual([automation.id]);
    const history = await request(app).get("/api/sessions?scope=legacy").expect(200);
    expect(history.body.sessions.map((s: { id: string }) => s.id).sort()).toEqual([legacy.id, pinnedLegacy.id].sort());
    const all = await request(app).get("/api/sessions?scope=all").expect(200);
    expect(all.body.sessions).toHaveLength(6);
    db.close();
  });

  it("defaults scoped pages to 20 and traverses a larger history without hiding exact records", async () => {
    const { app, db } = setup();
    const insert = db.prepare(`INSERT INTO sessions (id, created_at, updated_at, origin, last_human_activity_at)
      VALUES (?, 100, 999, 'human', ?)`);
    for (let i = 0; i < 57; i++) insert.run(`human-${String(i).padStart(3, "0")}`, i % 5);
    const first = await request(app).get("/api/sessions?scope=human").expect(200);
    expect(first.body.sessions).toHaveLength(20);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const firstIds = new Set(first.body.sessions.map((s: { id: string }) => s.id));
    const absent = listSessions(db).find(row => !firstIds.has(row.id))!;
    await request(app).get(`/api/sessions/${absent.id}`).expect(200);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: request.Response = await request(app).get("/api/sessions").query({ scope: "human", limit: 7, ...(cursor ? { cursor } : {}) }).expect(200);
      seen.push(...page.body.sessions.map((s: { id: string }) => s.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(57);
    expect(new Set(seen).size).toBe(57);
    const expected = (db.prepare("SELECT id FROM sessions ORDER BY last_human_activity_at DESC, id DESC").all() as { id: string }[]).map(row => row.id);
    expect(seen).toEqual(expected);
    db.close();
  });

  it.each([
    "scope=invalid", "scope=Human", "scope=", "scope=human&scope=all",
    "limit=2", "cursor=abc", "scope=human&limit=0", "scope=human&limit=101",
    "scope=human&limit=-1", "scope=human&limit=1.5", "scope=human&limit=01",
    "scope=human&limit=1e1", "scope=human&limit=", "scope=human&limit=1&limit=2",
    "scope=human&cursor=", "scope=human&cursor=???", "scope=human&cursor=a&cursor=b",
  ])("rejects malformed list query %s", async (query) => {
    const { app, db } = setup();
    const response = await request(app).get(`/api/sessions?${query}`).expect(400);
    expect(response.body).toEqual({ error: "bad_request" });
    db.close();
  });

  it("rejects a valid cursor used against another scope", async () => {
    const { app, db } = setup();
    createSession(db, { origin: "human" });
    createSession(db, { origin: "human" });
    const page = await request(app).get("/api/sessions?scope=human&limit=1").expect(200);
    await request(app).get("/api/sessions").query({ scope: "all", cursor: page.body.nextCursor }).expect(400);
    db.close();
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
