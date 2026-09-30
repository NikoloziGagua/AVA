import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, updateIntent } from "../self/intents.js";
import { selfRoutes, type SelfRouteDeps } from "./self.js";
import type { SelfWorkerAdapter } from "../self/workers.js";
import { buildSelfWorkerRegistry } from "../self/workers.js";
import { setSelfWorkerSelection } from "../self/worker-selection.js";

function setup(options: { codexAvailable?: boolean } = {}) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "ava-selfroute-")), "x.db"));
  const start = vi.fn((_id: string) => {});
  const revert = vi.fn((_id: string) => {});
  const cancel = vi.fn((_id: string) => true);
  const approve = vi.fn((_id: string) => true);
  const reject = vi.fn((_id: string) => true);
  const resumeSwap = vi.fn<SelfRouteDeps["resumeSwap"]>(
    (_id: string, _expected: { candidateSha: string; headSha: string }) => ({ ok: true, status: "started" }),
  );
  const adapter = (provider: "claude" | "codex", available = true): SelfWorkerAdapter => ({
    provider,
    label: provider === "claude" ? "Claude Code" : "Codex",
    probe: async () => ({
      provider, label: provider === "claude" ? "Claude Code" : "Codex",
      installed: available, configuration: available ? "not_checked" : "unavailable",
      available, version: available ? `${provider}-1` : null, reason: available ? null : "missing",
    }),
    run: async () => ({ ok: true, output: "ok" }),
  });
  const workers = buildSelfWorkerRegistry([adapter("claude"), adapter("codex", options.codexAvailable !== false)]);
  const app = express(); app.use(express.json());
  app.use("/api/self", selfRoutes(db, (_q, _s, n) => n(), {
    startImprovement: start,
    revert,
    cancel,
    approve,
    reject,
    headSha: () => "a".repeat(40),
    resumeSwap,
    workers,
  }));
  return { app, db, start, revert, cancel, approve, reject, resumeSwap };
}

describe("/api/self", () => {
  it("POST /improve queues an intent and kicks off the loop", async () => {
    const { app, start } = setup();
    const res = await request(app).post("/api/self/improve").send({ goal: "be faster" }).expect(200);
    expect(res.body.id).toBeTruthy();
    expect(start).toHaveBeenCalledWith(res.body.id);
  });

  it("GET / lists intents newest first", async () => {
    const { app } = setup();
    await request(app).post("/api/self/improve").send({ goal: "x" });
    const res = await request(app).get("/api/self").expect(200);
    expect(res.body.intents.length).toBe(1);
    expect(res.body.worker).toMatchObject({ provider: "claude", version: 1 });
    expect(res.body.repositoryHead).toBe("a".repeat(40));
    expect(res.body.worker.options).toHaveLength(2);
  });

  it("persists a versioned Codex selection and snapshots it onto new intents", async () => {
    const { app, db } = setup();
    const selected = await request(app).post("/api/self/worker")
      .send({ provider: "codex", expectedVersion: 1 }).expect(200);
    expect(selected.body.worker).toMatchObject({ provider: "codex", version: 2 });
    const created = await request(app).post("/api/self/improve").send({ goal: "use Codex" }).expect(200);
    expect(created.body.worker).toBe("codex");
    const row = db.prepare("SELECT worker_provider, worker_selection_version FROM self_improvements WHERE id = ?")
      .get(created.body.id) as Record<string, unknown>;
    expect(row).toEqual({ worker_provider: "codex", worker_selection_version: 2 });
  });

  it("rejects stale selector writes without overwriting the newer choice", async () => {
    const { app } = setup();
    await request(app).post("/api/self/worker").send({ provider: "codex", expectedVersion: 1 }).expect(200);
    const stale = await request(app).post("/api/self/worker")
      .send({ provider: "claude", expectedVersion: 1 }).expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version", worker: { provider: "codex", version: 2 } });
  });

  it("refuses an unavailable worker instead of falling back", async () => {
    const { app } = setup({ codexAvailable: false });
    const res = await request(app).post("/api/self/worker")
      .send({ provider: "codex", expectedVersion: 1 }).expect(409);
    expect(res.body).toMatchObject({ error: "worker_unavailable", provider: "codex", reason: "missing" });
  });

  it("fails closed when a previously selected worker becomes unavailable", async () => {
    const { app, db, start } = setup({ codexAvailable: false });
    setSelfWorkerSelection(db, "codex", 1);
    const res = await request(app).post("/api/self/improve").send({ goal: "must not fall back" }).expect(409);
    expect(res.body).toMatchObject({ error: "worker_unavailable", provider: "codex" });
    expect(start).not.toHaveBeenCalled();
    expect((db.prepare("SELECT COUNT(*) AS n FROM self_improvements").get() as { n: number }).n).toBe(0);
  });

  it("rejects an empty goal", async () => {
    const { app } = setup();
    await request(app).post("/api/self/improve").send({ goal: "" }).expect(400);
  });

  it("preserves a substantial approved goal and rejects input beyond the worker envelope", async () => {
    const { app, db } = setup();
    const goal = `authoritative scope\n${"evidence-backed requirement\n".repeat(180)}`;
    expect(goal.length).toBeGreaterThan(2_000);
    expect(goal.length).toBeLessThan(8_000);

    const accepted = await request(app).post("/api/self/improve").send({ goal }).expect(200);
    const stored = db.prepare("SELECT goal FROM self_improvements WHERE id = ?")
      .get(accepted.body.id) as { goal: string };
    expect(stored.goal).toBe(goal);

    await request(app).post("/api/self/improve").send({ goal: "x".repeat(8_001) }).expect(400);
  });

  it("POST /:id/revert calls revert when there is a known-good", async () => {
    const { app, db, revert } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    updateIntent(db, id, { last_known_good: "abc123", status: "swapped" });
    await request(app).post(`/api/self/${id}/revert`).expect(200);
    expect(revert).toHaveBeenCalledWith(id);
  });

  it("POST /:id/revert 404s when there is no known-good", async () => {
    const { app, db } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    await request(app).post(`/api/self/${id}/revert`).expect(404);
  });

  it("POST /:id/cancel calls cancel and reports the result", async () => {
    const { app, cancel } = setup();
    const res = await request(app).post("/api/self/some-id/cancel").expect(200);
    expect(cancel).toHaveBeenCalledWith("some-id");
    expect(res.body).toEqual({ ok: true, cancelled: true });
  });

  it("POST /:id/approve locks the current worker, including a post-intake Codex switch", async () => {
    const { app, approve, db } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    updateIntent(db, id, { status: "awaiting_approval" });
    await request(app).post("/api/self/worker")
      .send({ provider: "codex", expectedVersion: 1 }).expect(200);
    const res = await request(app).post(`/api/self/${id}/approve`)
      .send({ expectedWorkerVersion: 2 }).expect(200);
    expect(approve).toHaveBeenCalledWith(id, expect.objectContaining({ provider: "codex", version: 2 }));
    expect(res.body).toMatchObject({ ok: true, approved: true, worker: { provider: "codex", version: 2 } });
  });

  it("POST /:id/approve rejects a stale displayed worker version", async () => {
    const { app, approve, db } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    updateIntent(db, id, { status: "awaiting_approval" });
    await request(app).post("/api/self/worker")
      .send({ provider: "codex", expectedVersion: 1 }).expect(200);
    const res = await request(app).post(`/api/self/${id}/approve`)
      .send({ expectedWorkerVersion: 1 }).expect(409);
    expect(res.body).toMatchObject({ error: "stale_version", worker: { provider: "codex", version: 2 } });
    expect(approve).not.toHaveBeenCalled();
  });

  it("POST /:id/approve fails closed if the selected worker is unavailable", async () => {
    const { app, approve, db } = setup({ codexAvailable: false });
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    updateIntent(db, id, { status: "awaiting_approval" });
    setSelfWorkerSelection(db, "codex", 1);
    const res = await request(app).post(`/api/self/${id}/approve`)
      .send({ expectedWorkerVersion: 2 }).expect(409);
    expect(res.body).toMatchObject({ error: "worker_unavailable", provider: "codex" });
    expect(approve).not.toHaveBeenCalled();
  });

  it("POST /:id/reject calls reject", async () => {
    const { app, reject } = setup();
    const res = await request(app).post("/api/self/some-id/reject").expect(200);
    expect(reject).toHaveBeenCalledWith("some-id");
    expect(res.body).toEqual({ ok: true, rejected: true });
  });

  it("POST /:id/resume-swap uses candidate and HEAD stale guards", async () => {
    const { app, db, resumeSwap } = setup();
    const id = createIntent(db, { trigger: "explicit", goal: "g" });
    const candidate = "b".repeat(40);
    updateIntent(db, id, {
      status: "blocked",
      commit_sha: candidate,
      last_known_good: "c".repeat(40),
    });
    const response = await request(app).post(`/api/self/${id}/resume-swap`).send({
      expectedCandidateSha: candidate,
      expectedHead: "a".repeat(40),
    }).expect(202);
    expect(response.body).toEqual({ ok: true, status: "started" });
    expect(resumeSwap).toHaveBeenCalledWith(id, {
      candidateSha: candidate,
      headSha: "a".repeat(40),
    });
  });

  it("POST /:id/resume-swap rejects malformed and stale requests", async () => {
    const { app, resumeSwap } = setup();
    await request(app).post("/api/self/x/resume-swap").send({
      expectedCandidateSha: "short",
      expectedHead: "a".repeat(40),
    }).expect(400);
    resumeSwap.mockReturnValueOnce({ ok: false, error: "stale_head", currentHead: "d".repeat(40) });
    const stale = await request(app).post("/api/self/x/resume-swap").send({
      expectedCandidateSha: "b".repeat(40),
      expectedHead: "a".repeat(40),
    }).expect(409);
    expect(stale.body).toMatchObject({ ok: false, error: "stale_head" });
  });
});
