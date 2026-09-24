import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../state/db.js";
import { AgentroomClient } from "../agentroom/client.js";
import { AgentroomService } from "../agentroom/service.js";
import { agentroomRoutes } from "./agentroom.js";

function auth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  (req as express.Request & { deviceId: string }).deviceId = "test";
  next();
}

function identity(name = "AVA", kind = "other") {
  return new Response(JSON.stringify({ agent: { name, kind }, room_name: "klevar" }), { status: 200 });
}

describe("agentroomRoutes", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  function app(client: AgentroomClient) {
    const value = express();
    value.use(express.json());
    value.use("/api/agentroom", agentroomRoutes(auth, new AgentroomService(db, client)));
    return value;
  }

  it("reports disabled by default without exposing credentials", async () => {
    const response = await request(app(new AgentroomClient({ hubUrl: "https://room.test", token: "top-secret" })))
      .get("/api/agentroom").expect(200);
    expect(response.body).toEqual({
      schemaVersion: 1, enabled: false, version: 1, availability: "disabled",
      identity: "AVA", roomName: null, reason: "AVA's development-room connection is switched off.",
    });
    expect(JSON.stringify(response.body)).not.toContain("top-secret");
  });

  it("enables only after exact identity evidence and rejects stale updates", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(identity()));
    const value = app(new AgentroomClient({ hubUrl: "https://room.test", token: "secret", fetchImpl }));
    const enabled = await request(value).post("/api/agentroom").send({ enabled: true, expectedVersion: 1 }).expect(200);
    expect(enabled.body).toMatchObject({ enabled: true, version: 2, availability: "ready", roomName: "klevar" });
    const stale = await request(value).post("/api/agentroom").send({ enabled: false, expectedVersion: 1 }).expect(409);
    expect(stale.body).toMatchObject({ error: "stale_version", enabled: true, version: 2 });
  });

  it("fails closed for missing credentials or identity mismatch", async () => {
    const missing = await request(app(new AgentroomClient({ hubUrl: null, token: null })))
      .post("/api/agentroom").send({ enabled: true, expectedVersion: 1 }).expect(409);
    expect(missing.body).toMatchObject({ error: "unconfigured", availability: "unconfigured", enabled: false });

    const wrong = await request(app(new AgentroomClient({
      hubUrl: "https://room.test", token: "secret",
      fetchImpl: vi.fn().mockImplementation(() => Promise.resolve(identity("Nika-codex", "codex"))),
    }))).post("/api/agentroom").send({ enabled: true, expectedVersion: 1 }).expect(409);
    expect(wrong.body).toMatchObject({ error: "identity_mismatch", availability: "identity_mismatch", enabled: false });
  });

  it("disables without requiring a live hub", async () => {
    const readyFetch = vi.fn().mockImplementation(() => Promise.resolve(identity()));
    const client = new AgentroomClient({ hubUrl: "https://room.test", token: "secret", fetchImpl: readyFetch });
    const value = app(client);
    await request(value).post("/api/agentroom").send({ enabled: true, expectedVersion: 1 }).expect(200);
    readyFetch.mockRejectedValue(new Error("offline"));
    const disabled = await request(value).post("/api/agentroom").send({ enabled: false, expectedVersion: 2 }).expect(200);
    expect(disabled.body).toMatchObject({ enabled: false, version: 3, availability: "disabled" });
  });
});
