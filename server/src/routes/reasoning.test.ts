import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { reasoningRoutes } from "./reasoning.js";

function setup(supported: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "ava-reason-r-"));
  const db = openDb(join(dir, "x.db"));
  const app = express();
  app.use(express.json());
  const auth = (_req: any, _res: any, next: any) => next();
  app.use("/api/reasoning", reasoningRoutes(db, auth, { supported }));
  return { app, db };
}

describe("reasoning routes", () => {
  it("GET defaults to fast", async () => {
    const { app } = setup(true);
    const res = await request(app).get("/api/reasoning").expect(200);
    expect(res.body).toEqual({ level: "fast", supported: true });
  });

  it("PUT { level: 'thorough' } persists and returns the new level", async () => {
    const { app } = setup(true);
    const r = await request(app).put("/api/reasoning")
      .send({ level: "thorough" }).expect(200);
    expect(r.body).toEqual({ level: "thorough" });
    const g = await request(app).get("/api/reasoning").expect(200);
    expect(g.body.level).toBe("thorough");
  });

  it("PUT rejects an invalid level with 400", async () => {
    const { app } = setup(true);
    await request(app).put("/api/reasoning")
      .send({ level: "zoom" }).expect(400);
  });

  it("GET reports supported=false when provider isn't OpenAI", async () => {
    const { app } = setup(false);
    const res = await request(app).get("/api/reasoning").expect(200);
    expect(res.body.supported).toBe(false);
  });
});
