import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { repositoryMapFixture } from "../visual-explanations/fixtures.test-helper.js";
import { visualExplanationRoutes } from "./visual-explanations.js";

let db: Db;
const auth: express.RequestHandler = (req, res, next) => {
  if (req.headers.authorization !== "Bearer test-device") {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/visual-explanations", visualExplanationRoutes(db, auth));
  return instance;
}

beforeEach(() => { db = openInMemoryDb(); });

describe("visual explanations API", () => {
  it("requires authentication for canonical visual data", async () => {
    await request(app()).get("/api/visual-explanations").expect(401);
    await request(app()).post("/api/visual-explanations").send(repositoryMapFixture).expect(401);
  });

  it("creates, lists and reads validated source without persisted render artifacts", async () => {
    const created = await request(app()).post("/api/visual-explanations")
      .set("authorization", "Bearer test-device")
      .send(repositoryMapFixture).expect(201);
    expect(created.body.visual).toMatchObject({ schemaVersion: "1.0", title: repositoryMapFixture.title });
    expect(created.body.visual.topology.nodes.map((node: { id: string }) => node.id)).toContain("agent");
    for (const forbidden of ["html", "svg", "png"]) expect(created.body.visual).not.toHaveProperty(forbidden);

    const id = created.body.visual.id as string;
    const listed = await request(app()).get("/api/visual-explanations")
      .set("authorization", "Bearer test-device").expect(200);
    expect(listed.body.visuals).toHaveLength(1);
    await request(app()).get(`/api/visual-explanations/${id}`)
      .set("authorization", "Bearer test-device").expect(200);

    const columns = db.prepare("PRAGMA table_info(visual_explanations)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(["html", "svg", "png"]));
  });

  it("deduplicates identical canonical source and rejects unsafe Mermaid", async () => {
    const first = await request(app()).post("/api/visual-explanations")
      .set("authorization", "Bearer test-device").send(repositoryMapFixture).expect(201);
    const second = await request(app()).post("/api/visual-explanations")
      .set("authorization", "Bearer test-device").send(repositoryMapFixture).expect(200);
    expect(second.body).toMatchObject({ created: false, visual: { id: first.body.visual.id } });

    const unsafe = structuredClone(repositoryMapFixture);
    unsafe.mermaid += `\nclick ui "https://evil.example"`;
    const rejected = await request(app()).post("/api/visual-explanations")
      .set("authorization", "Bearer test-device").send(unsafe).expect(400);
    expect(rejected.body.error).toBe("invalid_visual_explanation");
    expect(JSON.stringify(rejected.body)).not.toContain("evil.example");
  });

  it("bounds list filters and does not enumerate malformed IDs", async () => {
    await request(app()).get("/api/visual-explanations?limit=1000")
      .set("authorization", "Bearer test-device").expect(400);
    await request(app()).get("/api/visual-explanations/not-a-visual")
      .set("authorization", "Bearer test-device").expect(400);
  });
});

