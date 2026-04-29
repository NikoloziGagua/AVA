import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { chipsRoutes } from "./chips.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";

function setup(opts: { deviceId?: string | null; provider?: LLMProvider | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ava-chips-r-"));
  const db = openDb(join(dir, "x.db"));
  if (opts.deviceId !== null) {
    db.prepare(
      "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
    ).run(opts.deviceId ?? "d1", "hash-d1", "test", Date.now());
  }
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = (req: any, _res: any, next: any) => {
    if (opts.deviceId !== null) req.deviceId = opts.deviceId ?? "d1";
    next();
  };
  app.use("/api/chips", chipsRoutes(db, auth, {
    memoryDir: dir,
    provider: opts.provider ?? null,
  }));
  return { app, db };
}

describe("chips routes", () => {
  it("GET /api/chips returns empty array initially", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/chips").expect(200);
    expect(res.body.chips).toEqual([]);
  });

  it("POST /api/chips creates a pinned chip", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/chips")
      .send({ label: "Resume", prompt: "let's continue" })
      .expect(200);
    expect(res.body.chip.label).toBe("Resume");
    expect(res.body.chip.pinned).toBe(1);
  });

  it("POST /api/chips rejects empty label", async () => {
    const { app } = setup();
    await request(app).post("/api/chips").send({ label: "", prompt: "x" }).expect(400);
  });

  it("PATCH /api/chips/:id mutates label", async () => {
    const { app } = setup();
    const created = await request(app)
      .post("/api/chips")
      .send({ label: "old", prompt: "p" })
      .expect(200);
    const r = await request(app)
      .patch(`/api/chips/${created.body.chip.id}`)
      .send({ label: "new" })
      .expect(200);
    expect(r.body.chip.label).toBe("new");
  });

  it("PATCH /api/chips/:id returns 404 for foreign device", async () => {
    const { app, db } = setup();
    db.prepare(
      "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
    ).run("d2", "hash-d2", "test2", Date.now());
    db.prepare(
      "INSERT INTO chip_overrides (id, device_id, label, prompt, pinned, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("foreign", "d2", "X", "x", 1, 0, Date.now(), Date.now());
    await request(app).patch("/api/chips/foreign").send({ label: "y" }).expect(404);
  });

  it("DELETE /api/chips/:id removes a chip", async () => {
    const { app } = setup();
    const created = await request(app)
      .post("/api/chips")
      .send({ label: "X", prompt: "p" })
      .expect(200);
    await request(app).delete(`/api/chips/${created.body.chip.id}`).expect(200);
    const list = await request(app).get("/api/chips").expect(200);
    expect(list.body.chips).toHaveLength(0);
  });

  it("GET /api/chips returns 401 when no device id", async () => {
    const { app } = setup({ deviceId: null });
    await request(app).get("/api/chips").expect(401);
  });

  it("GET /api/chips/suggested merges pinned + auto", async () => {
    const { app } = setup();
    await request(app).post("/api/chips").send({ label: "Pinned A", prompt: "p" }).expect(200);
    const r = await request(app).get("/api/chips/suggested").expect(200);
    expect(r.body.chips.some((c: { source: string }) => c.source === "pinned")).toBe(true);
  });

  it("kicks off summarizeChips for auto chips with no cached label (fire-and-forget)", async () => {
    const provider = new MockLLMProvider({
      completions: [JSON.stringify({ labels: [
        { id: "auto:phrase-list-contents-of-home-folder", label: "List home" },
      ]})],
    });
    const { app, db } = setup({ provider });
    // seed two recent user messages to surface the "list contents" auto chip
    const sid = createSession(db, { title: "" }).id;
    appendMessage(db, { sessionId: sid, role: "user", content: "list contents of home folder" });
    appendMessage(db, { sessionId: sid, role: "user", content: "list contents of home folder" });

    await request(app).get("/api/chips/suggested").expect(200);
    // give the background promise a microtask
    await new Promise((r) => setTimeout(r, 30));
    expect(provider.calls.complete).toHaveLength(1);
    // second call should now reflect the cached label
    const r = await request(app).get("/api/chips/suggested").expect(200);
    const labels = r.body.chips.map((c: { label: string }) => c.label);
    expect(labels).toContain("List home");
  });
});
