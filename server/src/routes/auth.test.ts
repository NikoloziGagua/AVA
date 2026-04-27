import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { openDb, type Db } from "../state/db.js";
import { issuePairingCode } from "../auth/pairing.js";
import { issueToken } from "../auth/tokens.js";
import { requireToken } from "../auth/middleware.js";
import { authRoutes } from "./auth.js";

function makeApp(db: Db) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes(db, requireToken(db)));
  return app;
}

async function callJson(
  app: express.Express,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const port = (server.address() as { port: number }).port;
        const r = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: { "content-type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await r.text();
        const parsed = text ? JSON.parse(text) : undefined;
        server.close();
        resolve({ status: r.status, body: parsed });
      } catch (e) {
        server.close();
        reject(e);
      }
    });
  });
}

describe("auth routes", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("POST /api/auth/pair exchanges a valid code for a token", async () => {
    const code = issuePairingCode(db, 60_000);
    const app = makeApp(db);
    const { status, body } = await callJson(app, "POST", "/api/auth/pair", { code, label: "iPhone" });
    expect(status).toBe(200);
    expect((body as { token: string }).token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("POST /api/auth/pair rejects unknown codes (400)", async () => {
    const app = makeApp(db);
    const { status } = await callJson(app, "POST", "/api/auth/pair", { code: "ZZZZZZ", label: "x" });
    expect(status).toBe(400);
  });

  it("GET /api/auth/devices requires auth", async () => {
    const app = makeApp(db);
    const { status } = await callJson(app, "GET", "/api/auth/devices");
    expect(status).toBe(401);
  });

  it("GET /api/auth/devices lists active tokens", async () => {
    const { secret } = issueToken(db, { label: "iPad" });
    issueToken(db, { label: "iPhone" });
    const app = makeApp(db);
    const { status, body } = await callJson(app, "GET", "/api/auth/devices", undefined, { authorization: `Bearer ${secret}` });
    expect(status).toBe(200);
    expect((body as { devices: unknown[] }).devices).toHaveLength(2);
  });

  it("DELETE /api/auth/devices/:id revokes", async () => {
    const a = issueToken(db, { label: "a" });
    const b = issueToken(db, { label: "b" });
    const app = makeApp(db);
    const { status } = await callJson(app, "DELETE", `/api/auth/devices/${b.id}`, undefined, { authorization: `Bearer ${a.secret}` });
    expect(status).toBe(204);
  });
});
