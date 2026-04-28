import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { listRules, getRule } from "../state/rules.js";
import { rulesRoutes } from "./rules.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

function setup(opts: { provider?: MockLLMProvider | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ava-rules-r-"));
  const db = openDb(join(dir, "x.db"));
  const app = express();
  app.use(express.json());
  const auth = (_req: any, _res: any, next: any) => next();
  app.use("/api/rules", rulesRoutes(db, auth, { provider: opts.provider ?? null }));
  return { app, db };
}

describe("rules routes", () => {
  it("GET /api/rules returns empty rules array initially", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/rules").expect(200);
    expect(res.body.rules).toEqual([]);
  });

  it("POST /api/rules creates a pending rule and returns it (no provider)", async () => {
    const { app, db } = setup();
    const res = await request(app)
      .post("/api/rules")
      .send({ source: "allow all shell commands" })
      .expect(200);
    expect(res.body.rule).toBeDefined();
    expect(res.body.rule.source).toBe("allow all shell commands");
    expect(res.body.rule.status).toBe("pending");
    expect(res.body.rule.id).toBeTruthy();
    const rules = listRules(db);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.status).toBe("pending");
  });

  it("POST /api/rules with provider → status becomes active and parsed is set", async () => {
    const validParsed = { match: { tool: "*" }, action: "allow" };
    const provider = new MockLLMProvider({ completions: [JSON.stringify(validParsed)] });
    const { app, db } = setup({ provider });
    const res = await request(app)
      .post("/api/rules")
      .send({ source: "allow all tools" })
      .expect(200);
    const id = res.body.rule.id;
    // Fire-and-forget: wait for async parse to complete
    await new Promise((r) => setTimeout(r, 50));
    const rule = getRule(db, id);
    expect(rule).not.toBeNull();
    expect(rule!.status).toBe("active");
    expect(rule!.parsed).toBe(JSON.stringify(validParsed));
    expect(provider.calls.complete).toHaveLength(1);
  });

  it("POST /api/rules with provider returning bad JSON → status becomes failed", async () => {
    const provider = new MockLLMProvider({ completions: ["not valid json at all"] });
    const { app, db } = setup({ provider });
    const res = await request(app)
      .post("/api/rules")
      .send({ source: "deny all shell" })
      .expect(200);
    const id = res.body.rule.id;
    await new Promise((r) => setTimeout(r, 50));
    const rule = getRule(db, id);
    expect(rule).not.toBeNull();
    expect(rule!.status).toBe("failed");
  });

  it("PATCH /api/rules/:id { enabled: false } persists and returns ok", async () => {
    const { app, db } = setup();
    const postRes = await request(app)
      .post("/api/rules")
      .send({ source: "allow reads" })
      .expect(200);
    const id = postRes.body.rule.id;
    const patchRes = await request(app)
      .patch(`/api/rules/${id}`)
      .send({ enabled: false })
      .expect(200);
    expect(patchRes.body.ok).toBe(true);
    const rule = getRule(db, id);
    expect(rule!.enabled).toBe(0);
  });

  it("PATCH /api/rules/:id with non-existent id returns 404", async () => {
    const { app } = setup();
    await request(app)
      .patch("/api/rules/nonexistent-id-xxx")
      .send({ enabled: false })
      .expect(404);
  });

  it("DELETE /api/rules/:id removes the rule", async () => {
    const { app, db } = setup();
    const postRes = await request(app)
      .post("/api/rules")
      .send({ source: "deny shell rm" })
      .expect(200);
    const id = postRes.body.rule.id;
    await request(app).delete(`/api/rules/${id}`).expect(200);
    expect(listRules(db)).toHaveLength(0);
  });

  it("POST /api/rules with empty body returns 400", async () => {
    const { app } = setup();
    await request(app).post("/api/rules").send({}).expect(400);
  });
});
