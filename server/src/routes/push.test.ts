import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { listSubscriptions } from "../state/push.js";
import { pushRoutes } from "./push.js";

function setup(opts: { vapidPublicKey?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ava-push-r-"));
  const db = openDb(join(dir, "x.db"));
  const app = express();
  app.use(express.json());
  const auth = (_req: any, _res: any, next: any) => next();
  const vapidPublicKey = "vapidPublicKey" in opts ? opts.vapidPublicKey ?? null : "test-key";
  app.use("/api/push", pushRoutes(db, auth, { vapidPublicKey }));
  return { app, db };
}

describe("push routes", () => {
  it("POST /subscribe stores the subscription", async () => {
    const { app, db } = setup();
    await request(app)
      .post("/api/push/subscribe")
      .send({
        endpoint: "https://fcm.googleapis.com/fcm/send/x",
        keys: { p256dh: "p", auth: "a" },
        deviceLabel: "iphone",
      })
      .expect(200);
    expect(listSubscriptions(db).length).toBe(1);
  });

  it("POST /subscribe is idempotent on the same endpoint", async () => {
    const { app, db } = setup();
    const body = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a" }, deviceLabel: "iphone" };
    await request(app).post("/api/push/subscribe").send(body).expect(200);
    await request(app).post("/api/push/subscribe").send(body).expect(200);
    expect(listSubscriptions(db).length).toBe(1);
  });

  it("DELETE /subscribe removes by endpoint", async () => {
    const { app, db } = setup();
    await request(app).post("/api/push/subscribe").send({
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      keys: { p256dh: "p", auth: "a" },
      deviceLabel: null,
    }).expect(200);
    await request(app).delete("/api/push/subscribe").send({ endpoint: "https://fcm.googleapis.com/fcm/send/x" }).expect(200);
    expect(listSubscriptions(db).length).toBe(0);
  });

  it("POST /subscribe rejects malformed body with 400", async () => {
    const { app } = setup();
    await request(app).post("/api/push/subscribe").send({ endpoint: "x" }).expect(400);
  });

  it("GET /vapid-public returns the configured key", async () => {
    const { app } = setup({ vapidPublicKey: "my-public-key" });
    const res = await request(app).get("/api/push/vapid-public").expect(200);
    expect(res.body.key).toBe("my-public-key");
  });

  it("GET /vapid-public returns 503 when no key configured", async () => {
    const { app } = setup({ vapidPublicKey: null });
    await request(app).get("/api/push/vapid-public").expect(503);
  });
});
