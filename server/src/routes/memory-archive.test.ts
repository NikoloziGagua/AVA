import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { openInMemoryDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { MemoryArchive } from "../memory-archive/archive.js";
import type { MemoryChange, NewMemory } from "../memory-archive/types.js";
import { excerpt, memoryArchiveRoutes } from "./memory-archive.js";

const T0 = Date.parse("2026-09-01T12:00:00Z");

function setup() {
  const db = openInMemoryDb();
  const archive = new MemoryArchive(db);
  const changes: MemoryChange[] = [];
  archive.subscribe((change) => changes.push(change));
  const app = express();
  app.use(express.json());
  const auth = (_req: unknown, _res: unknown, next: () => void) => next();
  app.use("/api/memory/archive", memoryArchiveRoutes(auth as never, { db, archive }));
  const sessionId = createSession(db, { title: "Synthetic memory test", origin: "human" }).id;
  const say = (content: string) => appendMessage(db, { sessionId, role: "user", content }).id;
  const add = (over: Partial<NewMemory>) => {
    const result = archive.add({
      kind: "fact", topic: "gym time", text: "Niko trains at the gym at 6 pm.", speechAct: "stated",
      confidence: "high", origin: "conversation", saidAt: T0, ...over,
    }, "extractor", sessionId);
    if (!result.ok) throw new Error(result.message);
    return result.record;
  };
  return { app, archive, changes, sessionId, say, add };
}

describe("Memory tab routes", () => {
  it("lists current, waiting and past records with the feed, and never exposes fingerprints", async () => {
    const { app, add } = setup();
    add({ text: "Niko trains at the gym at 6 pm." });
    add({ text: "Niko trains at the gym at 7 pm.", saidAt: T0 + 1000 });
    add({ topic: "salary", text: "Niko earns 30k.", status: "unconfirmed", sensitive: true });
    const res = await request(app).get("/api/memory/archive").expect(200);
    expect(res.body.records.map((record: { text: string; status: string }) => [record.text, record.status])).toEqual([
      ["Niko trains at the gym at 7 pm.", "active"], ["Niko earns 30k.", "unconfirmed"],
    ]);
    expect(res.body.history).toMatchObject([{ text: "Niko trains at the gym at 6 pm.", status: "history" }]);
    expect(res.body.events[0]).toMatchObject({ action: "added", summary: "Niko earns 30k." });
    expect(res.body.counts).toEqual({ active: 1, history: 1, unconfirmed: 1, forgotten: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/fingerprint|sourceMessageIds/);
  });

  it("shows where a memory came from, but never a line that was forgotten", async () => {
    const { app, archive, say, add, sessionId } = setup();
    const kept = say("By the way I moved, I live in Carlow now.");
    const secret = say("My code word is pelican.");
    const record = add({ topic: "home town", text: "Niko lives in Carlow.", sourceMessageIds: [kept, secret] });
    archive.tombstoneMessages([secret], "forgotten_index_entry");
    const res = await request(app).get(`/api/memory/archive/${record.id}`).expect(200);
    expect(res.body.sources).toEqual([{ id: kept, sessionId, speaker: "niko", text: "By the way I moved, I live in Carlow now.", at: expect.any(Number) }]);
    expect(JSON.stringify(res.body)).not.toContain("pelican");
    await request(app).get("/api/memory/archive/mem_missing").expect(404, { error: "memory_not_found" });
  });

  it("searches current, waiting and old versions", async () => {
    const { app, add } = setup();
    add({ text: "Niko lives near Dublin.", topic: "home town" });
    add({ text: "Niko lives in Carlow, an hour from Dublin.", topic: "home town", saidAt: T0 + 1000 });
    const res = await request(app).get("/api/memory/archive/search?q=dublin").expect(200);
    expect(res.body.hits.map((hit: { text: string; status: string }) => [hit.text, hit.status])).toEqual(expect.arrayContaining([
      ["Niko lives in Carlow, an hour from Dublin.", "active"], ["Niko lives near Dublin.", "history"],
    ]));
    expect(res.body.hits).toHaveLength(2);
    expect((await request(app).get("/api/memory/archive/search?q=").expect(200)).body.hits).toEqual([]);
  });

  it("corrects, stops carrying and confirms as Niko, refusing a version he has not seen", async () => {
    const { app, archive, changes, add } = setup();
    const gym = add({});
    await request(app).post(`/api/memory/archive/${gym.id}/correct`).send({ expectedVersion: 9, text: "Niko trains at 8 pm." })
      .expect(409).expect((res) => expect(res.body.error).toBe("stale_version"));
    const fixed = await request(app).post(`/api/memory/archive/${gym.id}/correct`).send({ expectedVersion: 1, text: "Niko trains at 8 pm." }).expect(200);
    expect(fixed.body.record).toMatchObject({ text: "Niko trains at 8 pm.", origin: "explicit", status: "active", supersedesId: gym.id });
    expect(archive.get(gym.id)).toMatchObject({ status: "history" });
    expect(changes.at(-1)).toMatchObject({ action: "updated", actor: "niko", sessionId: null });
    await request(app).post(`/api/memory/archive/${gym.id}/correct`).send({ expectedVersion: 2, text: "Again." })
      .expect(409).expect((res) => expect(res.body.error).toBe("wrong_state"));

    const quiet = await request(app).post(`/api/memory/archive/${fixed.body.record.id}/carry`).send({ expectedVersion: 1, carry: false }).expect(200);
    expect(quiet.body.record).toMatchObject({ carry: false, version: 2 });

    const waiting = add({ topic: "salary", text: "Niko earns 30k.", status: "unconfirmed" });
    await request(app).post(`/api/memory/archive/${waiting.id}/confirm`).send({ expectedVersion: 1 }).expect(200)
      .expect((res) => expect(res.body.record).toMatchObject({ status: "active" }));
    await request(app).post(`/api/memory/archive/${waiting.id}/correct`).send({ expectedVersion: 1, text: "" }).expect(400);
  });

  it("forgets only the version on screen, and logs a dropped waiting record as rejected", async () => {
    const { app, archive, add } = setup();
    const gym = add({});
    await request(app).post(`/api/memory/archive/${gym.id}/forget`).send({ expectedVersion: 2 }).expect(409);
    expect(archive.get(gym.id)).not.toBeNull();
    await request(app).post(`/api/memory/archive/${gym.id}/forget`).send({ expectedVersion: 1 }).expect(200, { ok: true, forgotten: 1 });
    expect(archive.isForgotten({ kind: "fact", topic: "gym time", text: "Niko trains at the gym at 6 pm." })).toBe(true);
    await request(app).post(`/api/memory/archive/${gym.id}/forget`).send({ expectedVersion: 1 }).expect(404);

    const waiting = add({ topic: "salary", text: "Niko earns 30k.", status: "unconfirmed" });
    await request(app).post(`/api/memory/archive/${waiting.id}/forget`).send({ expectedVersion: 1 }).expect(200);
    await request(app).post(`/api/memory/archive/${waiting.id}/forget`).send({}).expect(400);
  });
});

describe("source excerpts", () => {
  it("keeps short lines whole and finds the part of a long one that matters", () => {
    expect(excerpt("  using an   iphone 15 ", "Niko uses an iPhone 15.")).toBe("using an iphone 15");
    const long = `${"We talked about the weather for a while. ".repeat(6)}My mom's name is Teo, remember that. ${"Then we planned the week ahead. ".repeat(6)}`;
    const shown = excerpt(long, "Niko's mother's name is Teo.", 120);
    expect(shown).toContain("My mom's name is Teo, remember that.");
    expect(shown.startsWith("…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(124);
    const runOn = `${"and then we talked about stuff ".repeat(12)}my mom is called Teo ${"and more stuff after that ".repeat(12)}`;
    expect(excerpt(runOn, "Niko's mother is called Teo.", 100)).toContain("my mom is called Teo");
  });
});
