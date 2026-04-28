import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "./db.js";
import { upsertSubscription, listSubscriptions, deleteSubscription } from "./push.js";

let db: Db;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ava-push-"));
  db = openDb(join(dir, "x.db"));
});

describe("push repo", () => {
  it("upsert inserts a new subscription", () => {
    upsertSubscription(db, { endpoint: "https://x/1", p256dh: "p", auth: "a", deviceLabel: "phone", deviceTokenId: null });
    const all = listSubscriptions(db);
    expect(all.length).toBe(1);
    expect(all[0]?.endpoint).toBe("https://x/1");
  });

  it("upsert on existing endpoint updates p256dh/auth", () => {
    upsertSubscription(db, { endpoint: "https://x/1", p256dh: "p1", auth: "a1", deviceLabel: null, deviceTokenId: null });
    upsertSubscription(db, { endpoint: "https://x/1", p256dh: "p2", auth: "a2", deviceLabel: null, deviceTokenId: null });
    const all = listSubscriptions(db);
    expect(all.length).toBe(1);
    expect(all[0]?.p256dh).toBe("p2");
  });

  it("delete by endpoint removes the row", () => {
    upsertSubscription(db, { endpoint: "https://x/1", p256dh: "p", auth: "a", deviceLabel: null, deviceTokenId: null });
    deleteSubscription(db, "https://x/1");
    expect(listSubscriptions(db).length).toBe(0);
  });
});
