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
    const index = new MemoryIndexService(db, null);
    app.use("/api/memory", memoryRoutes(auth, { memoryDir: dir, index }));
    return { app, db, session, first, last, index };
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

  it("exposes versioned correction, pin and supersession endpoints without rewriting the entry", async () => {
    const { app, db, session, first, last } = indexSetup();
    const create = async (input: { title: string; summary: string; sessionId: string; from: number; through: number }) => {
      const response = await request(app).post("/api/memory/index/capture")
        .set("authorization", "Bearer test")
        .send({
          sessionId: input.sessionId,
          fromMessageId: input.from,
          throughMessageId: input.through,
          kind: "idea",
          title: input.title,
          summary: input.summary,
          tags: ["governance"],
        })
        .expect(201);
      return response.body.result as any;
    };
    const firstMemory = await create({
      title: "Old launch plan",
      summary: "Launch on Monday.",
      sessionId: session.id,
      from: first.id,
      through: last.id,
    });
    const secondSession = createSession(db, { title: "Replacement plan" });
    const secondFrom = appendMessage(db, { sessionId: secondSession.id, role: "user", content: "Set the new launch plan." });
    const secondThrough = appendMessage(db, { sessionId: secondSession.id, role: "assistant", content: "Launch on Tuesday." });
    const secondMemory = await create({
      title: "Current launch plan",
      summary: "Launch on Tuesday.",
      sessionId: secondSession.id,
      from: secondFrom.id,
      through: secondThrough.id,
    });

    await request(app).post(`/api/memory/index/${firstMemory.entry.id}/correct`)
      .send({ expectedVersion: 1, reason: "missing auth", requestId: "route-no-auth", correction: { summary: "x" } })
      .expect(401);
    const corrected = await request(app).post(`/api/memory/index/${firstMemory.entry.id}/correct`)
      .set("authorization", "Bearer test")
      .send({
        expectedVersion: 1,
        reason: "Niko corrected the day before supersession.",
        requestId: "route-correct-launch",
        correction: { summary: "Launch on Tuesday after approval." },
      })
      .expect(200);
    expect(corrected.body).toMatchObject({
      ok: true,
      result: {
        entry: { summary: "Launch on Tuesday after approval." },
        originalEntry: { summary: "Launch on Monday." },
        governance: { corrected: true, threadVersion: 2 },
      },
    });
    const stale = await request(app).post(`/api/memory/index/threads/${firstMemory.lineage.threadId}/pin`)
      .set("authorization", "Bearer test")
      .send({ expectedVersion: 1, pinned: true, reason: "stale", requestId: "route-pin-stale" })
      .expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version", currentVersion: 2 });

    const pinned = await request(app).post(`/api/memory/index/threads/${firstMemory.lineage.threadId}/pin`)
      .set("authorization", "Bearer test")
      .send({ expectedVersion: 2, pinned: true, reason: "Keep visible.", requestId: "route-pin-current" })
      .expect(200);
    expect(pinned.body.result.governance).toMatchObject({ pinned: true, threadVersion: 3 });

    const superseded = await request(app).post(`/api/memory/index/threads/${firstMemory.lineage.threadId}/supersede`)
      .set("authorization", "Bearer test")
      .send({
        expectedVersion: 3,
        replacementThreadId: secondMemory.lineage.threadId,
        replacementExpectedVersion: 1,
        reason: "The current approved plan replaces the draft.",
        requestId: "route-supersede-launch",
      })
      .expect(200);
    expect(superseded.body.result.governance).toMatchObject({ state: "superseded", pinned: false });

    const currentOnly = await request(app).post("/api/memory/index/search")
      .set("authorization", "Bearer test")
      .send({ query: "launch plan" })
      .expect(200);
    expect(currentOnly.body.results.map((item: any) => item.lineage.threadId)).toEqual([secondMemory.lineage.threadId]);
    const history = await request(app).post("/api/memory/index/search")
      .set("authorization", "Bearer test")
      .send({ query: "launch plan", includeHistory: true })
      .expect(200);
    expect(history.body.results).toHaveLength(2);
    expect(history.body.results.find((item: any) => item.lineage.threadId === firstMemory.lineage.threadId))
      .toMatchObject({ governance: { state: "superseded" }, originalEntry: { summary: "Launch on Monday." } });
  });

  it("opens and resolves a conflict idempotently through the authenticated boundary", async () => {
    const { app, db, index, session, first, last } = indexSetup();
    const left = (await index.capture({
      sessionId: session.id,
      fromMessageId: first.id,
      throughMessageId: last.id,
      kind: "idea",
      title: "Short cache policy",
      summary: "Cache entries for five minutes.",
    })).result;
    const rightSession = createSession(db, { title: "Long cache policy" });
    const rightFrom = appendMessage(db, { sessionId: rightSession.id, role: "user", content: "Set the cache duration." });
    const rightThrough = appendMessage(db, { sessionId: rightSession.id, role: "assistant", content: "Cache entries for thirty minutes." });
    const right = (await index.capture({
      sessionId: rightSession.id,
      fromMessageId: rightFrom.id,
      throughMessageId: rightThrough.id,
      kind: "idea",
      title: "Long cache policy",
      summary: "Cache entries for thirty minutes.",
    })).result;

    const opened = await request(app).post(`/api/memory/index/threads/${left.lineage.threadId}/conflict`)
      .set("authorization", "Bearer test")
      .send({
        expectedVersion: 1,
        otherThreadId: right.lineage.threadId,
        otherExpectedVersion: 1,
        reason: "These two cache durations contradict each other.",
        requestId: "route-cache-conflict-open",
      })
      .expect(200);
    expect(opened.body.result.governance).toMatchObject({ state: "conflicted", retrievalEligible: false, threadVersion: 2 });
    const replay = await request(app).post(`/api/memory/index/threads/${left.lineage.threadId}/conflict`)
      .set("authorization", "Bearer test")
      .send({
        expectedVersion: 1,
        otherThreadId: right.lineage.threadId,
        otherExpectedVersion: 1,
        reason: "These two cache durations contradict each other.",
        requestId: "route-cache-conflict-open",
      })
      .expect(200);
    expect(replay.body.event.id).toBe(opened.body.event.id);

    const rightCurrent = index.get(right.entry.id)!;
    const resolved = await request(app).post(`/api/memory/index/threads/${left.lineage.threadId}/resolve-conflict`)
      .set("authorization", "Bearer test")
      .send({
        expectedVersion: 2,
        losingThreadId: right.lineage.threadId,
        losingExpectedVersion: rightCurrent.governance.threadVersion,
        reason: "Five minutes is the approved duration.",
        requestId: "route-cache-conflict-resolve",
      })
      .expect(200);
    expect(resolved.body.result.governance).toMatchObject({ state: "current", retrievalEligible: true, threadVersion: 3 });
    expect(index.get(right.entry.id)?.governance).toMatchObject({
      state: "superseded",
      supersededByThreadId: left.lineage.threadId,
    });
  });
});
