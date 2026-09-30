import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { getVisualExplanation } from "../state/visual-explanations.js";
import { vikingMapFixture } from "../visual-explanations/research-fixtures.test-helper.js";
import { visualExplanationRoutes } from "./visual-explanations.js";

let db: Db;
const auth: express.RequestHandler = (req, res, next) => req.headers.authorization === "Bearer test-device" ? next() : void res.status(401).json({ error: "unauthorized" });
function app() { const value = express(); value.use(express.json()); value.use("/api/visual-explanations", visualExplanationRoutes(db, auth)); return value; }
beforeEach(() => { db = openInMemoryDb(); });

describe("research visual API and persistence", () => {
  it("uses an authenticated separate write boundary and restores exact v2 revisions", async () => {
    await request(app()).post("/api/visual-explanations/research").send(vikingMapFixture).expect(401);
    const created = await request(app()).post("/api/visual-explanations/research").set("authorization", "Bearer test-device").send(vikingMapFixture).expect(201);
    expect(created.body.visual).toMatchObject({ schemaVersion: "2.0", diagramKind: "geographic_map", renderer: { renderer: "d3-geo" } });
    expect(created.body.visual.sources[0].url).toBe("https://example.org/research/primary");
    const id = created.body.visual.visualMessageId as string;
    expect(getVisualExplanation(db, id, 1)).toMatchObject({ schemaVersion: "2.0", revision: 1 });
    await request(app()).get(`/api/visual-explanations/${id}?revision=1`).set("authorization", "Bearer test-device").expect(200);
  });

  it("deduplicates retries and rejects stale research revisions", async () => {
    const first = await request(app()).post("/api/visual-explanations/research").set("authorization", "Bearer test-device").send(vikingMapFixture).expect(201);
    const retry = await request(app()).post("/api/visual-explanations/research").set("authorization", "Bearer test-device").send(vikingMapFixture).expect(200);
    expect(retry.body.visual.visualMessageId).toBe(first.body.visual.visualMessageId);
    const revision = { ...structuredClone(vikingMapFixture), title: "Revised map", revisesVisualMessageId: first.body.visual.visualMessageId, expectedRevision: 1 };
    await request(app()).post("/api/visual-explanations/research").set("authorization", "Bearer test-device").send(revision).expect(201);
    const stale = { ...revision, title: "Stale collision" };
    const rejected = await request(app()).post("/api/visual-explanations/research").set("authorization", "Bearer test-device").send(stale).expect(409);
    expect(rejected.body).toMatchObject({ error: "stale_visual_revision", currentRevision: 2 });
  });

  it("stores canonical semantics, never disposable render artifacts", async () => {
    await request(app()).post("/api/visual-explanations/research").set("authorization", "Bearer test-device").send(vikingMapFixture).expect(201);
    const row = db.prepare("SELECT * FROM visual_message_revisions").get() as Record<string, unknown>;
    expect(row.schema_version).toBe("2.0");
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["html", "svg", "png"]));
    expect(String(row.semantic_model)).not.toContain("<script");
  });
});
