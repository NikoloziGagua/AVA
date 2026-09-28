import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDb, type Db } from "../state/db.js";
import { upsertSubscription, listSubscriptions } from "../state/push.js";
import { createSession } from "../state/sessions.js";
import { createApproval } from "../state/approvals.js";
import { buildDeliverer, deliverApprovalPush, deliverDonePush, type ReminderDeliveryRequest } from "./deliver.js";

let db: Db;
let sessionId: string;
beforeEach(() => {
  db = openDb(":memory:");
  sessionId = createSession(db, { title: "t" }).id;
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); db.close(); });

const VAPID = {
  publicKey: "BPyp8gfWoDMdhiy1O2UVpZ3XKeje_kmgMLMuLHao2zwkNygsAa0r0RIG7p0J9GUfZHuhxjOsrprronPOA8ed1uc",
  privateKey: "Yf-N33PnyzisTT8cGqCFPQ3t0NIQUQoAM1SATI89a4U",
  subject: "mailto:test@example.com",
};

function addSub(endpoint: string) {
  upsertSubscription(db, { endpoint, p256dh: "p", auth: "a", deviceLabel: null, deviceTokenId: null });
}

describe("initiative push boundary", () => {
  it("uses the exact encoded pair and tag, bounded receipt and redaction", async () => {
    addSub("https://example.test/initiative");
    const send = vi.fn().mockResolvedValue({ statusCode: 201 });
    const deliver = buildDeliverer({ db, vapid: VAPID, send });
    const result = await deliver.deliverInitiativePush({ initiativeId: "ini_fixture", sessionId: "session-fixture",
      title: "AVA has a thought for you", body: "password=fixture-secret-value", expiresAt: Date.now() + 60_000 });
    expect(result.subscriptions.accepted).toBe(1);
    const raw = send.mock.calls[0]![1];
    expect(raw).not.toContain("fixture-secret-value");
    expect(JSON.parse(raw)).toMatchObject({ tag: "initiative-ini_fixture", data: { kind: "initiative",
      initiativeId: "ini_fixture", sessionId: "session-fixture", deepLink: "/?session=session-fixture&initiative=ini_fixture" } });
    await expect(deliver.deliverInitiativePush({ initiativeId: "../bad", sessionId: "s", title: "x", body: "x", expiresAt: Date.now() + 1000 })).rejects.toThrow("invalid_initiative_request");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("a hanging initiative transport has the same finite timeout as reminders", async () => {
    vi.useFakeTimers(); addSub("https://example.test/hang");
    const deliver = buildDeliverer({ db, vapid: VAPID, reminderTimeoutMs: 100, send: () => new Promise(() => {}) });
    const pending = deliver.deliverInitiativePush({ initiativeId: "ini_fixture", sessionId: "session-fixture", title: "AVA", body: "A thought", expiresAt: Date.now() + 60_000 });
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ subscriptions: { unknown: 1 }, reasonCode: "transport_timeout" });
  });
});

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

describe("deliverDonePush", () => {
  it("sends a 'task done' notification with the summary to all subscriptions", async () => {
    addSub("https://fcm.googleapis.com/x/1");
    addSub("https://fcm.googleapis.com/x/2");
    const send = vi.fn().mockResolvedValue({ statusCode: 201 });
    const r = await deliverDonePush({ db, vapid: VAPID, summary: "Opened Downloads", send });
    expect(r.sent).toBe(2);
    const payload = send.mock.calls[0]![1] as string;
    expect(payload).toContain("Opened Downloads");
    expect(payload).toContain("task done");
    expect(payload).toContain("ava-done");
  });

  it("prunes dead subscriptions on 410, like the approval path", async () => {
    addSub("https://fcm.googleapis.com/x/stale");
    addSub("https://fcm.googleapis.com/x/ok");
    const send = vi.fn(async (sub: any) => {
      if (sub.endpoint.endsWith("stale")) { const e = new Error("gone") as any; e.statusCode = 410; throw e; }
      return { statusCode: 201 };
    });
    const r = await deliverDonePush({ db, vapid: VAPID, summary: "done", send });
    expect(r).toMatchObject({ sent: 1, removed: 1 });
    expect(listSubscriptions(db).map((s) => s.endpoint)).toEqual(["https://fcm.googleapis.com/x/ok"]);
  });
});

describe("deliverReminderPush", () => {
  beforeEach(() => { vi.useFakeTimers({ now: 100_000 }); });
  const reminder = (patch: Partial<ReminderDeliveryRequest> = {}): ReminderDeliveryRequest => ({
    occurrenceId: "reminder:occurrence-1", summary: "Review the chapter", expiresAt: Date.now() + 60_000, ...patch,
  });
  const make = (send: NonNullable<Parameters<typeof buildDeliverer>[0]["send"]>, options: { now?: () => number; reminderTimeoutMs?: number } = {}) =>
    buildDeliverer({ db, vapid: VAPID, send, ...options });

  it("returns no_subscriptions without calling the transport", async () => {
    const send = vi.fn();
    expect(await make(send).deliverReminderPush(reminder())).toEqual({
      subscriptions: { total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
      reasonCode: "no_subscriptions",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([200, 201, 204, 299])("accepts only explicit fulfilled 2xx evidence (%s)", async (statusCode) => {
    addSub("https://push.invalid/one");
    const send = vi.fn().mockResolvedValue({ statusCode });
    expect(await make(send).deliverReminderPush(reminder())).toEqual({
      subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
      reasonCode: null,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, null, "ok", {}, { statusCode: "201" }, { statusCode: 201.5 }, { statusCode: 302 }, { statusCode: NaN }])(
    "treats malformed/missing/unsupported response status as unknown (%j)", async (response) => {
      addSub("https://push.invalid/one");
      const result = await make(vi.fn().mockResolvedValue(response)).deliverReminderPush(reminder());
      expect(result.subscriptions).toEqual({ total: 1, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 1 });
      expect(result.reasonCode).toBe("transport_unknown");
      expect(listSubscriptions(db)).toHaveLength(1);
    },
  );

  it.each([429, 500, 503, 599])("classifies explicit %s rejection as transient", async (statusCode) => {
    addSub("https://push.invalid/one");
    const result = await make(vi.fn().mockRejectedValue({ statusCode })).deliverReminderPush(reminder());
    expect(result.subscriptions.rejectedTransient).toBe(1);
    expect(result.subscriptions.accepted).toBe(0);
    expect(result.reasonCode).toBe("transient_rejection");
    expect(listSubscriptions(db)).toHaveLength(1);
  });

  it.each([400, 401, 403, 413])("classifies explicit %s rejection as permanent", async (statusCode) => {
    addSub("https://push.invalid/one");
    const result = await make(vi.fn().mockRejectedValue({ statusCode })).deliverReminderPush(reminder());
    expect(result.subscriptions.rejectedPermanent).toBe(1);
    expect(result.reasonCode).toBe("permanent_rejection");
    expect(listSubscriptions(db)).toHaveLength(1);
  });

  it.each([404, 410])("prunes explicit %s dead subscriptions and counts them as permanent rejections", async (statusCode) => {
    addSub("https://push.invalid/gone");
    const result = await make(vi.fn().mockRejectedValue({ statusCode })).deliverReminderPush(reminder());
    expect(result.subscriptions).toEqual({ total: 1, accepted: 0, rejectedTransient: 0, rejectedPermanent: 1, unknown: 0 });
    expect(result.reasonCode).toBe("subscription_gone");
    expect(listSubscriptions(db)).toHaveLength(0);
  });

  it("does not mistake fulfilled non-2xx responses for acceptance", async () => {
    for (const endpoint of ["transient", "permanent", "gone"]) addSub(`https://push.invalid/${endpoint}`);
    const send = vi.fn().mockResolvedValueOnce({ statusCode: 429 }).mockResolvedValueOnce({ statusCode: 403 }).mockResolvedValueOnce({ statusCode: 410 });
    const result = await make(send).deliverReminderPush(reminder());
    expect(result.subscriptions).toEqual({ total: 3, accepted: 0, rejectedTransient: 1, rejectedPermanent: 2, unknown: 0 });
    expect(result.reasonCode).toBe("transient_rejection");
    expect(listSubscriptions(db)).toHaveLength(2);
  });

  it("preserves mixed confirmed counts without returning or logging raw transport detail", async () => {
    const secret = "fixture-private-endpoint-key-body";
    for (let i = 0; i < 5; i++) addSub(`https://push.invalid/${secret}-${i}`);
    const logs = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
    const send = vi.fn().mockResolvedValueOnce({ statusCode: 201, body: secret })
      .mockRejectedValueOnce({ statusCode: 503, body: secret })
      .mockRejectedValueOnce({ statusCode: 404, endpoint: secret })
      .mockRejectedValueOnce({ statusCode: 401, headers: { authorization: secret } })
      .mockRejectedValueOnce(new Error(secret));
    const result = await make(send).deliverReminderPush(reminder());
    expect(result).toEqual({
      subscriptions: { total: 5, accepted: 1, rejectedTransient: 1, rejectedPermanent: 2, unknown: 1 },
      reasonCode: "transport_unknown",
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(listSubscriptions(db)).toHaveLength(4);
  });

  it("bounds an unending send while preserving an already accepted subscriber", async () => {
    addSub("https://push.invalid/accepted");
    addSub("https://push.invalid/hung");
    const send = vi.fn().mockResolvedValueOnce({ statusCode: 201 }).mockImplementationOnce(() => new Promise(() => {}));
    const completed = vi.fn();
    const pending = make(send, { reminderTimeoutMs: 50 }).deliverReminderPush(reminder()).then((result) => { completed(result); return result; });
    await vi.advanceTimersByTimeAsync(49);
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({
      subscriptions: { total: 2, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 1 },
      reasonCode: "transport_timeout",
    });
    expect(send.mock.calls[1]?.[2]).toEqual({ TTL: 60, timeout: 50 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([201, 410])("ignores late %s settlement after returning unknown (including pruning)", async (statusCode) => {
    addSub("https://push.invalid/late");
    let settle!: (value: unknown) => void;
    const send = vi.fn(() => new Promise((resolve, reject) => { settle = statusCode === 201 ? resolve : reject; }));
    const pending = make(send, { reminderTimeoutMs: 10 }).deliverReminderPush(reminder());
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    const before = JSON.stringify(result);
    settle({ statusCode });
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(result)).toBe(before);
    expect(result.subscriptions.unknown).toBe(1);
    expect(listSubscriptions(db)).toHaveLength(1);
  });

  it.each([new Error("Socket timeout"), { code: "ETIMEDOUT" }, { code: "ESOCKETTIMEDOUT" }])("recognizes bounded socket timeouts without exposing errors", async (error) => {
    addSub("https://push.invalid/one");
    const result = await make(vi.fn().mockRejectedValue(error)).deliverReminderPush(reminder());
    expect(result.reasonCode).toBe("transport_timeout");
    expect(result.subscriptions.unknown).toBe(1);
  });

  it("classifies synchronous/network/contradictory transport failure as unknown", async () => {
    addSub("https://push.invalid/one");
    for (const send of [
      vi.fn(() => { throw new Error("fixture network failure"); }),
      vi.fn().mockRejectedValue({ statusCode: 201 }),
      vi.fn().mockResolvedValue(Object.defineProperty({}, "statusCode", { get() { throw new Error("bad response"); } })),
    ]) {
      const result = await make(send).deliverReminderPush(reminder());
      expect(result.reasonCode).toBe("transport_unknown");
      expect(result.subscriptions.accepted).toBe(0);
    }
  });

  it("uses an occurrence-specific tag, safe deep link, and explicit expiry-bounded TTL", async () => {
    addSub("https://push.invalid/one");
    const send = vi.fn().mockResolvedValue({ statusCode: 201 });
    const deliverer = make(send, { now: () => 100_000 });
    await deliverer.deliverReminderPush(reminder({ expiresAt: 102_999 }));
    await deliverer.deliverReminderPush(reminder({ occurrenceId: "reminder:occurrence-2", expiresAt: 100_999 }));
    const first = JSON.parse(send.mock.calls[0]![1] as string);
    const second = JSON.parse(send.mock.calls[1]![1] as string);
    expect(first).toMatchObject({ title: "Ava — reminder", body: "Review the chapter", tag: "ava-reminder-reminder:occurrence-1", data: { occurrenceId: "reminder:occurrence-1", deepLink: "/" } });
    expect(second.tag).not.toBe(first.tag);
    expect(send.mock.calls[0]?.[2]).toEqual({ TTL: 2, timeout: 2999 });
    expect(send.mock.calls[1]?.[2]).toEqual({ TTL: 0, timeout: 999 });
  });

  it.each([
    [undefined, 10_000], [0, 10_000], [-1, 10_000], [NaN, 10_000], [Infinity, 10_000], [0.5, 1], [25_000, 20_000],
  ])("bounds configured timeout %s to %s ms", async (configured, expected) => {
    addSub("https://push.invalid/one");
    const send = vi.fn().mockResolvedValue({ statusCode: 201 });
    await make(send, { reminderTimeoutMs: configured }).deliverReminderPush(reminder());
    expect(send.mock.calls[0]?.[2]).toMatchObject({ timeout: expected });
  });

  it("does not accept a settlement after wall-clock expiry even if the timer callback has not run", async () => {
    addSub("https://push.invalid/one");
    let clock = 100_000;
    const send = vi.fn(async () => { clock += 11_000; return { statusCode: 201 }; });
    const result = await make(send, { now: () => clock }).deliverReminderPush(reminder());
    expect(result.reasonCode).toBe("transport_timeout");
    expect(result.subscriptions.accepted).toBe(0);
  });

  it.each([
    { occurrenceId: "" }, { occurrenceId: "unsafe\nfixture" }, { summary: " " },
    { expiresAt: 100_000 }, { expiresAt: 99_999 }, { expiresAt: NaN }, { expiresAt: Infinity },
  ])("rejects invalid or expired internal requests before any send (%j)", async (patch) => {
    addSub("https://push.invalid/one");
    const send = vi.fn();
    await expect(make(send).deliverReminderPush(reminder(patch))).rejects.toThrow("invalid_reminder_request");
    expect(send).not.toHaveBeenCalled();
  });
});
