import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, openInMemoryDb, type Db } from "./db.js";
import { createWatch, deleteWatch, getWatch, setWatchEnabled } from "./watches.js";
import {
  beginReminderSend, claimDueReminders, ensureReminderOccurrence, finishReminder, getReminderOccurrence,
  getReminderStatus, deferReminder, REMINDER_LEASE_MS, REMINDER_WINDOW_MS,
} from "./reminders.js";

const dbs: Db[] = [];
const dirs: string[] = [];
afterEach(() => { for (const db of dbs.splice(0)) if (db.open) db.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const db = openInMemoryDb(); dbs.push(db);
  const watch = createWatch(db, { prompt: "Disposable fixture", kind: "reminder", runAt: 100_000, timeZone: "Europe/London" });
  return { db, watch };
}
const accepted = { subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 }, reasonCode: null } as const;

describe("durable reminder occurrences", () => {
  it("watch and occurrence creation rolls back as one transaction", () => {
    const db = openInMemoryDb(); dbs.push(db);
    db.exec("CREATE TRIGGER fixture_abort BEFORE INSERT ON reminder_occurrences BEGIN SELECT RAISE(ABORT,'fixture'); END");
    expect(() => createWatch(db, { kind: "reminder", prompt: "fixture", runAt: 100_000 })).toThrow("fixture");
    expect(db.prepare("SELECT count(*) n FROM watches").get()).toEqual({ n: 0 });
  });
  it("creates exactly one transactional receipt and projects only bounded public fields", () => {
    const { db, watch } = setup();
    ensureReminderOccurrence(db, watch);
    expect(db.prepare("SELECT count(*) n FROM reminder_occurrences").get()).toEqual({ n: 1 });
    expect(getReminderStatus(db, watch)).toMatchObject({ version: 1, state: "scheduled", dueAt: 100_000,
      timeZone: "Europe/London", expiresAt: 100_000 + REMINDER_WINDOW_MS, attempts: 0, phoneReceipt: "unconfirmed" });
    expect(JSON.stringify(getReminderStatus(db, watch))).not.toMatch(/lease|Disposable/);
  });
  it("never assigns receipt evidence to recurrence or old already-attempted reminders", () => {
    const { db, watch } = setup();
    db.prepare("DELETE FROM reminder_occurrences").run();
    db.prepare("UPDATE watches SET last_run_at=100001,last_result='reminder delivered' WHERE id=?").run(watch.id);
    claimDueReminders(db, 100_001);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toBeUndefined();
    const recurring = createWatch(db, { prompt: "daily", kind: "reminder", dailyAt: "08:00" });
    expect(getReminderStatus(db, recurring)).toBeUndefined();
  });
  it("backfills unattempted legacy rows without guessing a historical time zone", () => {
    const { db, watch } = setup();
    db.prepare("DELETE FROM reminder_occurrences").run();
    db.prepare("UPDATE watches SET time_zone=NULL WHERE id=?").run(watch.id);
    claimDueReminders(db, 99_999);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toMatchObject({ timeZone: null, state: "scheduled" });
  });
  it("CAS claims and completions are idempotent; terminal rows cannot be rearmed", () => {
    const { db, watch } = setup();
    expect(claimDueReminders(db, 99_999)).toEqual([]);
    const [claim] = claimDueReminders(db, 100_000);
    expect(claimDueReminders(db, 100_000)).toEqual([]);
    const sending = beginReminderSend(db, claim!, 100_001)!;
    expect(beginReminderSend(db, claim!, 100_001)).toBeNull();
    expect(finishReminder(db, sending, accepted, 100_002)).toBe(true);
    expect(finishReminder(db, sending, accepted, 100_003)).toBe(false);
    const receipt = getReminderStatus(db, getWatch(db, watch.id)!);
    expect(receipt).toMatchObject({ state: "accepted", attempts: 1, acceptedAt: 100_002, phoneReceipt: "unconfirmed" });
    setWatchEnabled(db, watch.id, true);
    expect(claimDueReminders(db, 200_000)).toEqual([]);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toEqual(receipt);
  });
  it("only wholly known-unaccepted attempts retry, at15s then60s, at most3 sends", () => {
    const { db, watch } = setup();
    const transient = { subscriptions: { total: 1, accepted: 0, rejectedTransient: 1, rejectedPermanent: 0, unknown: 0 }, reasonCode: "transient_rejection" as const };
    let now = 100_000;
    for (let n = 1; n <= 3; n++) {
      const [claim] = claimDueReminders(db, now);
      const sending = beginReminderSend(db, claim!, now)!;
      finishReminder(db, sending, transient, now);
      const receipt = getReminderStatus(db, getWatch(db, watch.id)!)!;
      expect(receipt.attempts).toBe(n);
      if (n < 3) {
        expect(receipt.state).toBe("retry_scheduled");
        expect(receipt.nextAttemptAt).toBe(now + (n === 1 ? 15_000 : 60_000));
        expect(claimDueReminders(db, receipt.nextAttemptAt! - 1)).toEqual([]);
        now = receipt.nextAttemptAt!;
      } else expect(receipt).toMatchObject({ state: "failed", reasonCode: "retry_exhausted" });
    }
  });
  it("accepted + unknown is accepted with partial counts; unknown alone never retries", () => {
    const { db, watch } = setup();
    let [claim] = claimDueReminders(db, 100_000);
    const sending = beginReminderSend(db, claim!, 100_001)!;
    finishReminder(db, sending, { subscriptions: { ...accepted.subscriptions, total: 2, unknown: 1 }, reasonCode: "transport_timeout" }, 100_002);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toMatchObject({ state: "accepted", subscriptions: { accepted: 1, unknown: 1 } });
    const other = createWatch(db, { prompt: "second", kind: "reminder", runAt: 100_000 });
    [claim] = claimDueReminders(db, 100_003);
    finishReminder(db, beginReminderSend(db, claim!, 100_003)!, {
      subscriptions: { total: 1, accepted: 0, unknown: 1, rejectedTransient: 0, rejectedPermanent: 0 }, reasonCode: "transport_timeout",
    }, 100_004);
    expect(getReminderStatus(db, getWatch(db, other.id)!)).toMatchObject({ state: "acceptance_unknown" });
    expect(claimDueReminders(db, 120_000)).toEqual([]);
  });
  it("pause/delete before send suppresses transmission; in-flight pause is not recall", () => {
    const { db, watch } = setup();
    const [claim] = claimDueReminders(db, 100_000);
    setWatchEnabled(db, watch.id, false);
    expect(beginReminderSend(db, claim!, 100_001)).toBeNull();
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toMatchObject({ state: "paused", reasonCode: "paused" });
    setWatchEnabled(db, watch.id, true);
    const sending = beginReminderSend(db, claim!, 100_002)!;
    setWatchEnabled(db, watch.id, false);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toMatchObject({ state: "trying" });
    deleteWatch(db, watch.id);
    expect(finishReminder(db, sending, accepted, 100_003)).toBe(false);
    expect(getReminderOccurrence(db, sending.id)).toBeNull();
  });
  it("new attempts clear old aggregate evidence and expiry is not retry exhaustion", () => {
    const { db, watch } = setup();
    const transient = { subscriptions: { total: 1, accepted: 0, rejectedTransient: 1, rejectedPermanent: 0, unknown: 0 }, reasonCode: "transient_rejection" as const };
    const [first] = claimDueReminders(db, 100_000);
    finishReminder(db, beginReminderSend(db, first!, 100_000)!, transient, 100_001);
    const [retry] = claimDueReminders(db, 115_001);
    beginReminderSend(db, retry!, 115_001);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)!.subscriptions).toEqual({ total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 });
    claimDueReminders(db, 145_002);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toMatchObject({ state: "acceptance_unknown", subscriptions: { total: 0, rejectedTransient: 0 } });
    const nearExpiry = createWatch(db, { prompt: "expiry", kind: "reminder", runAt: 100_000 });
    const [last] = claimDueReminders(db, 100_000 + REMINDER_WINDOW_MS - 1);
    const sending = beginReminderSend(db, last!, 100_000 + REMINDER_WINDOW_MS - 1)!;
    finishReminder(db, sending, transient, 100_000 + REMINDER_WINDOW_MS);
    expect(getReminderStatus(db, getWatch(db, nearExpiry.id)!)).toMatchObject({ state: "expired", reasonCode: "delivery_window_expired", attempts: 1 });
  });
  it("expiry uses original due time and preserves known pre-send blocker", () => {
    const { db, watch } = setup();
    const [claim] = claimDueReminders(db, 100_000);
    deferReminder(db, claim!, "no_subscriptions", 100_001);
    claimDueReminders(db, 100_000 + REMINDER_WINDOW_MS);
    expect(getReminderStatus(db, watch)).toMatchObject({ state: "expired", attempts: 0, reasonCode: "no_subscriptions" });
    const missed = createWatch(db, { prompt: "missed", kind: "reminder", runAt: 1 });
    claimDueReminders(db, 2 * REMINDER_WINDOW_MS);
    expect(getReminderStatus(db, missed)).toMatchObject({ state: "expired", attempts: 0, reasonCode: "missed_window" });
  });
  it("restart recovers a pre-send lease but makes a sending lease uncertain; late results cannot overwrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-reminder-state-")); dirs.push(dir);
    const path = join(dir, "state.db");
    let db = openDb(path); dbs.push(db);
    const watch = createWatch(db, { prompt: "restart", kind: "reminder", runAt: 100_000, timeZone: "UTC" });
    const [old] = claimDueReminders(db, 100_000);
    db.close(); db = openDb(path); dbs.push(db);
    expect(claimDueReminders(db, 100_001)).toEqual([]);
    const [recovered] = claimDueReminders(db, 100_000 + REMINDER_LEASE_MS);
    expect(recovered!.lease_token).not.toBe(old!.lease_token);
    expect(beginReminderSend(db, old!, 100_000 + REMINDER_LEASE_MS)).toBeNull();
    const sending = beginReminderSend(db, recovered!, 130_001)!;
    db.close(); db = openDb(path); dbs.push(db);
    expect(claimDueReminders(db, 160_002)).toEqual([]);
    expect(getReminderStatus(db, getWatch(db, watch.id)!)).toMatchObject({ state: "acceptance_unknown", attempts: 1 });
    expect(finishReminder(db, sending, accepted, 160_003)).toBe(false);
  });
  it("migrates older stores, isolates connections and preserves unknown historical evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-reminder-migrate-")); dirs.push(dir);
    const path = join(dir, "state.db");
    let db = openDb(path); dbs.push(db);
    const watch = createWatch(db, { prompt: "old", kind: "reminder", runAt: 100_000 });
    db.exec("DROP TABLE reminder_occurrences; ALTER TABLE watches DROP COLUMN time_zone");
    db.close(); db = openDb(path); dbs.push(db);
    expect(getWatch(db, watch.id)?.time_zone).toBeNull();
    const otherDb = openDb(path); dbs.push(otherDb);
    expect(claimDueReminders(db, 100_001)).toHaveLength(1);
    expect(claimDueReminders(otherDb, 100_001)).toEqual([]);
    expect(getReminderStatus(otherDb, getWatch(otherDb, watch.id)!)).toMatchObject({ state: "trying", timeZone: null });
  });
});
