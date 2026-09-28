import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requireToken } from "../auth/middleware.js";
import { issueToken } from "../auth/tokens.js";
import { initiativeFixture, NOW } from "../initiative/fixture.test-helper.js";
import { initiativesRoutes } from "./initiatives.js";
import { updateNote, createNoteFolder } from "../state/notes.js";
import { markHumanActivity, softDeleteSession } from "../state/sessions.js";
describe("authenticated initiative API", () => {
  let f: ReturnType<typeof initiativeFixture>; let app: express.Express; let token: string; let id: string;
  beforeEach(async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    f = initiativeFixture(); await f.engine.tick(); id = f.rows()[0]!.id;
    token = issueToken(f.db, { label: "fixture human" }).secret;
    app = express(); app.use(express.json({ limit: "32kb" })); app.use("/api/initiatives", initiativesRoutes(f.db, requireToken(f.db)));
  });
  afterEach(() => { f.db.close(); vi.restoreAllMocks(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });
  it("requires auth for every read/write; no public ID enumeration", async () => {
    for (const url of ["settings", "inbox-summary", id, "ini_missing"]) {
      await request(app).get(`/api/initiatives/${url}`).expect(401);
    }
    await request(app).post(`/api/initiatives/${id}/opened`).send({}).expect(401);
    await request(app).post(`/api/initiatives/${id}/disposition`).send({ state: "later", expectedVersion: 1 }).expect(401);
    await request(app).patch("/api/initiatives/settings").send({ enabled: true, version: 2 }).expect(401);
  });
  it("returns bounded exact evidence and idempotent opened state, never internal tokens or prompts", async () => {
    const initial = await request(app).get("/api/initiatives/inbox-summary").set(auth()).expect(200);
    expect(initial.body).toMatchObject({ pending: 1, unopened: 1, newest: { initiativeId: id } });
    const view = await request(app).get(`/api/initiatives/${id}`).set(auth()).expect(200);
    expect(view.body.sources[0]).toMatchObject({ type: "note", id: f.note.id, status: "current", version: 1 });
    expect(JSON.stringify(view.body)).not.toMatch(/attempt_token|lease_until|prompt|Launch choices.*Compare a small/);
    for (let i = 0; i < 2; i++) await request(app).post(`/api/initiatives/${id}/opened`).set(auth()).send({}).expect(204);
    const summary = await request(app).get("/api/initiatives/inbox-summary").set(auth());
    expect(summary.body).toMatchObject({ pending: 1, unopened: 0 });
    expect(f.rows()[0]!.disposition_version).toBe(1);
  });
  it("source edits are changed; moved/deleted/archived sources reveal no current label", async () => {
    updateNote(f.db, f.note.id, 1, { title: "Edited title" });
    let result = await request(app).get(`/api/initiatives/${id}`).set(auth()).expect(200);
    expect(result.body.sources[0]).toMatchObject({ status: "changed", title: "Edited title", version: 1 });
    const other = createNoteFolder(f.db, { name: "Private other project" });
    updateNote(f.db, f.note.id, 2, { folderId: other.id, title: "Never reveal this" });
    result = await request(app).get(`/api/initiatives/${id}`).set(auth()).expect(200);
    expect(result.body.sources[0]).toMatchObject({ status: "unavailable", title: null });
    expect(JSON.stringify(result.body)).not.toContain("Never reveal this");
    f.db.prepare("DELETE FROM notes WHERE id=?").run(f.note.id);
    result = await request(app).get(`/api/initiatives/${id}`).set(auth());
    expect(result.body.sources[0].status).toBe("unavailable");
  });
  it("missing, malformed, deleted and mismatched publication collapse to one 404", async () => {
    const missing = await request(app).get("/api/initiatives/ini_missing").set(auth()).expect(404);
    f.db.prepare("UPDATE initiatives SET message_id=NULL WHERE id=?").run(id);
    const mismatch = await request(app).get(`/api/initiatives/${id}`).set(auth()).expect(404);
    const malformed = await request(app).get("/api/initiatives/not-an-initiative").set(auth()).expect(404);
    expect(mismatch.body).toEqual(missing.body); expect(malformed.body).toEqual(missing.body);
    softDeleteSession(f.db, f.rows()[0]!.session_id!);
    await request(app).post(`/api/initiatives/${id}/opened`).set(auth()).send({}).expect(404);
  });
  it("guards disposition versions, preserves Later, removes Not useful, and never overrides engagement", async () => {
    const url = `/api/initiatives/${id}/disposition`;
    await request(app).post(url).set(auth()).send({ state: "later", expectedVersion: 1 }).expect(200);
    expect((await request(app).get("/api/initiatives/inbox-summary").set(auth())).body.pending).toBe(1);
    const stale = await request(app).post(url).set(auth()).send({ state: "not_useful", expectedVersion: 1 }).expect(409);
    expect(stale.body).toEqual({ error: "stale_version", disposition: { state: "later", version: 2 } });
    await request(app).post(url).set(auth()).send({ state: "not_useful", expectedVersion: 2 }).expect(200);
    expect((await request(app).get("/api/initiatives/inbox-summary").set(auth())).body.pending).toBe(0);
    markHumanActivity(f.db, f.rows()[0]!.session_id!, NOW + 1);
    await request(app).post(url).set(auth()).send({ state: "later", expectedVersion: 4 }).expect(409);
    expect(f.rows()[0]!.disposition_state).toBe("engaged");
  });
  it("settings round-trip, stale/malformed writes and expired summary are truthful", async () => {
    const path = "/api/initiatives/settings";
    const before = (await request(app).get(path).set(auth()).expect(200)).body;
    await request(app).patch(path).set(auth()).send({ version: before.version, deliveryLocalTime: "12:15" }).expect(200);
    await request(app).patch(path).set(auth()).send({ version: before.version, enabled: false }).expect(409);
    await request(app).patch(path).set(auth()).send({ version: 3, injected: true }).expect(400);
    f.db.prepare("UPDATE initiatives SET expires_at=? WHERE id=?").run(NOW, id);
    expect((await request(app).get("/api/initiatives/inbox-summary").set(auth())).body).toEqual({ pending: 0, unopened: 0, newest: null });
    await request(app).get(`/api/initiatives/${id}`).set(auth()).expect(200);
  });
});
