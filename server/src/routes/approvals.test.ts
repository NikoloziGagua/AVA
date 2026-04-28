import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { createApproval, getApproval, decide } from "../state/approvals.js";
import { approvalsRoutes } from "./approvals.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-app-r-"));
  const db = openDb(join(dir, "x.db"));
  const app = express();
  app.use(express.json());
  const auth = (_req: any, _res: any, next: any) => next();
  app.use("/api/approvals", approvalsRoutes(db, auth));
  const session = createSession(db, { title: "t" });
  return { app, db, sessionId: session.id };
}

describe("approvals routes", () => {
  it("GET /pending returns the session's pending approvals", async () => {
    const { app, db, sessionId } = setup();
    createApproval(db, { sessionId, tool: "shell", args: { command: "rm -rf" }, summary: "delete files" });
    const r = await request(app).get("/api/approvals/pending").query({ sessionId }).expect(200);
    expect(r.body.approvals.length).toBe(1);
    expect(r.body.approvals[0].tool).toBe("shell");
  });

  it("GET /pending without sessionId is 400", async () => {
    const { app } = setup();
    await request(app).get("/api/approvals/pending").expect(400);
  });

  it("POST /:id/approve flips the row to approved", async () => {
    const { app, db, sessionId } = setup();
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "x" });
    await request(app).post(`/api/approvals/${a.id}/approve`).expect(200);
    expect(getApproval(db, a.id)?.status).toBe("approved");
  });

  it("POST /:id/deny flips the row to denied", async () => {
    const { app, db, sessionId } = setup();
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "x" });
    await request(app).post(`/api/approvals/${a.id}/deny`).expect(200);
    expect(getApproval(db, a.id)?.status).toBe("denied");
  });

  it("POST /:id/approve on a non-existent id → 404", async () => {
    const { app } = setup();
    await request(app).post("/api/approvals/nosuch/approve").expect(404);
  });

  it("POST /:id/approve on an already-decided approval → 400 with current status", async () => {
    const { app, db, sessionId } = setup();
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "x" });
    decide(db, a.id, "denied");
    const r = await request(app).post(`/api/approvals/${a.id}/approve`).expect(400);
    expect(r.body.status).toBe("denied");
  });
});
