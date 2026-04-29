import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryRoutes } from "./memory.js";

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
