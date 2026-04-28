import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../state/db.js";
import { upsertSubscription, listSubscriptions } from "../state/push.js";
import { createSession } from "../state/sessions.js";
import { createApproval } from "../state/approvals.js";
import { deliverApprovalPush } from "./deliver.js";

let db: Db;
let sessionId: string;
beforeEach(() => {
  db = openDb(join(mkdtempSync(join(tmpdir(), "ava-deliver-")), "x.db"));
  sessionId = createSession(db, { title: "t" }).id;
});

const VAPID = {
  publicKey: "BPyp8gfWoDMdhiy1O2UVpZ3XKeje_kmgMLMuLHao2zwkNygsAa0r0RIG7p0J9GUfZHuhxjOsrprronPOA8ed1uc",
  privateKey: "Yf-N33PnyzisTT8cGqCFPQ3t0NIQUQoAM1SATI89a4U",
  subject: "mailto:test@example.com",
};

function addSub(endpoint: string) {
  upsertSubscription(db, { endpoint, p256dh: "p", auth: "a", deviceLabel: null, deviceTokenId: null });
}

describe("deliverApprovalPush", () => {
  it("sends to all subscriptions, returns sent count", async () => {
    addSub("https://fcm.googleapis.com/x/1");
    addSub("https://fcm.googleapis.com/x/2");
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "test" });
    const send = vi.fn().mockResolvedValue({ statusCode: 201 });
    const r = await deliverApprovalPush({ db, vapid: VAPID, approval: a, send });
    expect(r.sent).toBe(2);
    expect(r.removed).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
    // Payload contains the approval id and summary
    const callArg = send.mock.calls[0]![1] as string;
    expect(callArg).toContain("test");
    expect(callArg).toContain(`approval-${a.id}`);
  });

  it("prunes subscriptions on 410 Gone", async () => {
    addSub("https://fcm.googleapis.com/x/stale");
    addSub("https://fcm.googleapis.com/x/ok");
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "x" });
    const send = vi.fn(async (sub: any) => {
      if (sub.endpoint.endsWith("stale")) {
        const e = new Error("gone") as any;
        e.statusCode = 410;
        throw e;
      }
      return { statusCode: 201 };
    });
    const r = await deliverApprovalPush({ db, vapid: VAPID, approval: a, send });
    expect(r.sent).toBe(1);
    expect(r.removed).toBe(1);
    expect(listSubscriptions(db).map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/x/ok"]);
  });

  it("counts failures without throwing", async () => {
    addSub("https://fcm.googleapis.com/x/1");
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "x" });
    const send = vi.fn(async () => {
      const e = new Error("server error") as any;
      e.statusCode = 500;
      throw e;
    });
    const r = await deliverApprovalPush({ db, vapid: VAPID, approval: a, send });
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(0);
    expect(r.removed).toBe(0);
  });

  it("noops when there are no subscriptions", async () => {
    const a = createApproval(db, { sessionId, tool: "shell", args: {}, summary: "x" });
    const send = vi.fn();
    const r = await deliverApprovalPush({ db, vapid: VAPID, approval: a, send });
    expect(r).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
