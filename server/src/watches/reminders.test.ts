import { afterEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { createWatch, deleteWatch, getWatch, setWatchEnabled } from "../state/watches.js";
import { emptyReminderCounts, getReminderStatus, REMINDER_WINDOW_MS } from "../state/reminders.js";
import { startWatchScheduler } from "./scheduler.js";
import { upsertSubscription } from "../state/push.js";
import { tickReminders } from "./reminders.js";
const dbs: Db[] = [];
afterEach(() => { vi.useRealTimers(); for (const db of dbs.splice(0)) db.close(); });
function setup() {
  const db = openInMemoryDb(); dbs.push(db);
  const watch = createWatch(db, { kind: "reminder", prompt: "Fixture", runAt: 100_000, timeZone: "UTC" });
  return { db, watch, status: () => getReminderStatus(db, getWatch(db, watch.id)!) };
}
const accepted = () => ({ subscriptions: { ...emptyReminderCounts(), total: 1, accepted: 1 }, reasonCode: null });
const log = { info: vi.fn(), warn: vi.fn() };

describe("direct reminder runner", () => {
  it("persists accepted evidence without pretending phone receipt", async () => {
    const { db, watch, status } = setup();
    const deliver = vi.fn(async () => accepted());
    await tickReminders({ db, now: () => 100_001, deliverReminder: deliver, subscriptionCount: () => 1 });
    expect(deliver).toHaveBeenCalledWith({ occurrenceId: status()!.occurrenceId, summary: "Fixture", expiresAt: 100_000 + REMINDER_WINDOW_MS });
    expect(status()).toMatchObject({ state: "accepted", attempts: 1, phoneReceipt: "unconfirmed" });
    expect(getWatch(db, watch.id)?.last_result).not.toContain("delivered");
    await tickReminders({ db, now: () => 200_000, deliverReminder: deliver, subscriptionCount: () => 1 });
    expect(deliver).toHaveBeenCalledOnce();
  });
  it("configuration and subscription absence remain visible without invented attempts", async () => {
    const { db, status } = setup();
    await tickReminders({ db, now: () => 100_001 });
    expect(status()).toMatchObject({ state: "scheduled", attempts: 0, reasonCode: "push_not_configured" });
    const deliver = vi.fn(async () => accepted());
    await tickReminders({ db, now: () => 115_001, deliverReminder: deliver, subscriptionCount: () => 0 });
    expect(status()).toMatchObject({ attempts: 0, reasonCode: "no_subscriptions" });
    expect(deliver).not.toHaveBeenCalled();
    await tickReminders({ db, now: () => 130_001, deliverReminder: deliver, subscriptionCount: () => 1 });
    expect(status()).toMatchObject({ state: "accepted", attempts: 1 });
  });
  it("subscription removal during preflight does not count a transmission", async () => {
    const { db, status } = setup();
    await tickReminders({ db, now: () => 100_001, subscriptionCount: () => 1,
      deliverReminder: async () => ({ subscriptions: emptyReminderCounts(), reasonCode: "no_subscriptions" }) });
    expect(status()).toMatchObject({ state: "scheduled", attempts: 0, attemptedAt: null, reasonCode: "no_subscriptions" });
  });
  it("concurrent ticks cannot send twice", async () => {
    const { db, status } = setup();
    let release!: (value: ReturnType<typeof accepted>) => void;
    const deliver = vi.fn(() => new Promise<ReturnType<typeof accepted>>((resolve) => { release = resolve; }));
    const input = { db, now: () => 100_001, deliverReminder: deliver, subscriptionCount: () => 1 };
    const first = tickReminders(input);
    await tickReminders(input);
    expect(status()).toMatchObject({ state: "trying", attempts: 1 });
    expect(deliver).toHaveBeenCalledOnce();
    release(accepted()); await first;
  });
  it("pause or delete during preflight prevents transport", async () => {
    const { db, watch } = setup();
    const deliver = vi.fn(async () => accepted());
    await tickReminders({ db, now: () => 100_001, deliverReminder: deliver, subscriptionCount: () => {
      setWatchEnabled(db, watch.id, false); return 1;
    } });
    expect(deliver).not.toHaveBeenCalled();
    setWatchEnabled(db, watch.id, true);
    await tickReminders({ db, now: () => 140_001, deliverReminder: deliver, subscriptionCount: () => {
      deleteWatch(db, watch.id); return 1;
    } });
    expect(deliver).not.toHaveBeenCalled();
  });
  it("timeout is uncertain, with no retry or late terminal upgrade", async () => {
    vi.useFakeTimers({ now: 100_001 });
    const { db, status } = setup();
    let release!: (value: ReturnType<typeof accepted>) => void;
    const deliver = vi.fn(() => new Promise<ReturnType<typeof accepted>>((resolve) => { release = resolve; }));
    const pending = tickReminders({ db, deliverReminder: deliver, subscriptionCount: () => 1, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101); await pending;
    expect(status()).toMatchObject({ state: "acceptance_unknown", attempts: 1, reasonCode: "transport_timeout" });
    const receipt = status();
    release(accepted()); await Promise.resolve();
    await tickReminders({ db, deliverReminder: deliver, subscriptionCount: () => 1 });
    expect(status()).toEqual(receipt); expect(deliver).toHaveBeenCalledOnce();
  });
  it("throws never persist raw error or claim success", async () => {
    const { db, status } = setup();
    await tickReminders({ db, now: () => 100_001, subscriptionCount: () => 1,
      deliverReminder: async () => { throw new Error("Bearer private-token https://private-endpoint"); } });
    expect(status()).toMatchObject({ state: "acceptance_unknown", reasonCode: "transport_unknown" });
    expect(JSON.stringify(db.prepare("SELECT * FROM reminder_occurrences").all())).not.toMatch(/private|Bearer/);
  });
  it.each([{}, { total: 0 }])("malformed empty subscription results cannot become retryable: %j", async (subscriptions) => {
    const { db, status } = setup();
    await tickReminders({ db, now: () => 100_001, subscriptionCount: () => 1,
      deliverReminder: async () => ({ subscriptions, reasonCode: "no_subscriptions" }) as never });
    expect(status()).toMatchObject({ state: "acceptance_unknown", reasonCode: "transport_unknown", attempts: 1 });
  });
  it("runs without an LLM and independently of a stuck agent check", async () => {
    vi.useFakeTimers({ now: 100_000 });
    const { db, status } = setup();
    const runCheck = vi.fn(() => new Promise<never>(() => {}));
    createWatch(db, { prompt: "stuck check", kind: "check", intervalMinutes: 1 });
    const deliver = vi.fn(async () => accepted());
    const stop = startWatchScheduler({ db, baseUrl: "http://unused", token: () => "fixture", notify: vi.fn(), log,
      agentChecksEnabled: false, runCheck, tickMs: 5, reminderTickMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(runCheck).not.toHaveBeenCalled();
    expect(status()).toMatchObject({ reasonCode: "push_not_configured", attempts: 0 }); stop();
    upsertSubscription(db, { endpoint: "https://fixture.invalid/push", p256dh: "fixture", auth: "fixture", deviceTokenId: null, deviceLabel: null });
    const other = createWatch(db, { prompt: "later", kind: "reminder", runAt: Date.now() });
    const stop2 = startWatchScheduler({ db, baseUrl: "http://unused", token: () => "fixture", notify: vi.fn(), log,
      runCheck, tickMs: 5, reminderTickMs: 10, deliverReminder: deliver });
    await vi.advanceTimersByTimeAsync(10);
    expect(runCheck).toHaveBeenCalledOnce();
    expect(getReminderStatus(db, getWatch(db, other.id)!)).toMatchObject({ state: "accepted", attempts: 1, phoneReceipt: "unconfirmed" });
    expect(deliver).toHaveBeenCalledOnce();
    stop2();
  });
});
