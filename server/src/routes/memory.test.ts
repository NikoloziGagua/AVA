import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryRoutes } from "./memory.js";
import { openInMemoryDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { MemoryIndexService } from "../memory-index/store.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-mem-r-"));
  mkdirSync(join(dir, "projects"));
  const app = express();
  app.use(express.json());
  const auth = (_req: any, _res: any, next: any) => next();
  app.use("/api/memory", memoryRoutes(auth, { memoryDir: dir }));
  return { app, dir };
}

describe("memory routes", () => {
  it("GET returns all sections", async () => {
    const { app, dir } = setup();
    writeFileSync(join(dir, "preferences.md"), "alpha\nbeta\n");
    writeFileSync(join(dir, "observations.md"),
      "- [2026-04-29 / low / preferences] uses pwsh\n");
    writeFileSync(join(dir, "projects", "yov.md"), "yov body\n");

    const res = await request(app).get("/api/memory").expect(200);
    expect(res.body.preferences.lines).toEqual(["alpha", "beta"]);
    expect(res.body.observations.lines).toHaveLength(1);
    expect(res.body.projects[0]).toMatchObject({ slug: "yov" });
    expect(res.body.personaProfile).toMatchObject({
      version: "2.0",
      lab: { kind: "deterministic_contract", scenarioCount: 50, valid: true },
    });
  });

  it("PATCH /lines edits a preference line", async () => {
    const { app, dir } = setup();
    writeFileSync(join(dir, "preferences.md"), "alpha\nbeta\n");
    const r = await request(app).patch("/api/memory/lines")
      .send({ file: "preferences", oldLine: "beta", newLine: "BETA" })
      .expect(200);
    expect(r.body).toEqual({ line: "BETA" });
    expect(readFileSync(join(dir, "preferences.md"), "utf8"))
      .toBe("alpha\nBETA\n");
  });

  it("PATCH /lines without newLine deletes", async () => {
    const { app, dir } = setup();
    writeFileSync(join(dir, "preferences.md"), "alpha\nbeta\n");
    const r = await request(app).patch("/api/memory/lines")
      .send({ file: "preferences", oldLine: "alpha" })
      .expect(200);
    expect(r.body).toEqual({ deleted: true });
    expect(readFileSync(join(dir, "preferences.md"), "utf8"))
      .toBe("beta\n");
  });

  it("PATCH /lines returns 409 with current body when oldLine is stale", async () => {
    const { app, dir } = setup();
    writeFileSync(join(dir, "preferences.md"), "alpha\n");
    const r = await request(app).patch("/api/memory/lines")
      .send({ file: "preferences", oldLine: "missing", newLine: "x" })
      .expect(409);
    expect(r.body.error).toBe("stale_line");
    expect(r.body.current).toBe("alpha\n");
  });

  it("POST /lines appends to preferences with firewall", async () => {
    const { app, dir } = setup();
    const r = await request(app).post("/api/memory/lines")
      .send({ file: "preferences",
        line: "API key sk-ant-1234567890abcdefghijklmnopqrstuvwx" })
      .expect(200);
    expect(r.body.line).toBeTypeOf("string");
    expect(readFileSync(join(dir, "preferences.md"), "utf8"))
      .not.toContain("1234567890abcdefghijklmnopqrstuvwx");
  });

  it("POST /lines rejects file=observations with 400", async () => {
    const { app } = setup();
    await request(app).post("/api/memory/lines")
      .send({ file: "observations", line: "x" })
      .expect(400);
  });
});

describe("memory index routes", () => {
  function indexSetup() {
    const dir = mkdtempSync(join(tmpdir(), "ava-mem-index-r-"));
    mkdirSync(join(dir, "projects"));
    const db = openInMemoryDb();
    const session = createSession(db, { title: "Indexed discussion" });
    const first = appendMessage(db, { sessionId: session.id, role: "user", content: "Design a durable memory index." });
    const last = appendMessage(db, { sessionId: session.id, role: "assistant", content: "SQLite is canonical and source verification is mandatory." });
    const app = express();
    app.use(express.json());
    const auth = (req: any, res: any, next: any) => req.headers.authorization === "Bearer test"
      ? next()
      : res.status(401).json({ error: "unauthorized" });
    app.use("/api/memory", memoryRoutes(auth, { memoryDir: dir, index: new MemoryIndexService(db, null) }));
    return { app, db, session, first, last };
  }

  it("requires authentication for source-linked memory", async () => {
    const { app } = indexSetup();
    await request(app).get("/api/memory/index").expect(401);
    await request(app).post("/api/memory/index/search").send({ query: "memory" }).expect(401);
  });

  it("captures, lists, searches, opens and forgets one bounded source", async () => {
    const { app, session, first, last } = indexSetup();
    const created = await request(app).post("/api/memory/index/capture")
      .set("authorization", "Bearer test")
      .send({
        sessionId: session.id,
        fromMessageId: first.id,
        throughMessageId: last.id,
        kind: "idea",
        title: "Durable memory index",
        summary: "SQLite is canonical and exact conversation evidence must re-verify.",
        tags: ["memory", "sqlite"],
      })
      .expect(201);
    expect(created.body.result).toMatchObject({
      usable: true,
      source: { status: "verified" },
      entry: { checkpointSequence: 1, checkpointKind: "initial", parentEntryId: null },
      lineage: { sequence: 1, totalCheckpoints: 1, isLatest: true },
    });
    const id = created.body.result.entry.id as string;

    const recent = await request(app).get("/api/memory/index")
      .set("authorization", "Bearer test")
      .expect(200);
    expect(recent.body.results).toHaveLength(1);

    const found = await request(app).post("/api/memory/index/search")
      .set("authorization", "Bearer test")
      .send({ query: "canonical sqlite evidence" })
      .expect(200);
    expect(found.body).toMatchObject({ mode: "lexical", results: [{ entry: { id } }] });

    await request(app).get(`/api/memory/index/${id}`)
      .set("authorization", "Bearer test")
      .expect(200);
    await request(app).post(`/api/memory/index/${id}/forget`)
      .set("authorization", "Bearer test")
      .send({ expectedVersion: 99 })
      .expect(409);
    await request(app).post(`/api/memory/index/${id}/forget`)
      .set("authorization", "Bearer test")
      .send({ expectedVersion: 1 })
      .expect(200);
    await request(app).get(`/api/memory/index/${id}`)
      .set("authorization", "Bearer test")
      .expect(404);
  });

  it("rejects malformed and missing source ranges without storing an entry", async () => {
    const { app, db, session } = indexSetup();
    await request(app).post("/api/memory/index/capture")
      .set("authorization", "Bearer test")
      .send({
        sessionId: session.id,
        fromMessageId: 999,
        throughMessageId: 1000,
        kind: "idea",
        title: "Missing",
        summary: "Missing range",
      })
      .expect(404);
    const count = db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get() as { count: number };
    expect(count.count).toBe(0);
  });
});
