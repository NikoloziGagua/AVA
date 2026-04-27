import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Request, Response } from "express";
import { openDb, type Db } from "../state/db.js";
import { issueToken } from "./tokens.js";
import { requireToken } from "./middleware.js";

function makeApp(db: Db) {
  const app = express();
  app.get("/protected", requireToken(db), (req: Request, res: Response) => {
    res.json({ ok: true, deviceId: (req as Request & { deviceId?: string }).deviceId });
  });
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

describe("requireToken middleware", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("rejects requests with no Authorization header (401)", async () => {
    const { status } = await callJson(makeApp(db), "GET", "/protected");
    expect(status).toBe(401);
  });

  it("rejects malformed Authorization header (401)", async () => {
    const { status } = await callJson(makeApp(db), "GET", "/protected", undefined, { authorization: "Bogus xxx" });
    expect(status).toBe(401);
  });

  it("rejects an unknown bearer token (401)", async () => {
    const { status } = await callJson(makeApp(db), "GET", "/protected", undefined, {
      authorization: "Bearer not-a-real-token",
    });
    expect(status).toBe(401);
  });

  it("passes a valid bearer token (200) and exposes deviceId", async () => {
    const { secret, id } = issueToken(db, { label: "x" });
    const { status, body } = await callJson(makeApp(db), "GET", "/protected", undefined, {
      authorization: `Bearer ${secret}`,
    });
    expect(status).toBe(200);
    expect((body as { deviceId: string }).deviceId).toBe(id);
  });
});
