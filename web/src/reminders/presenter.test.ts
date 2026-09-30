import { describe, expect, it } from "vitest";
import { REMINDER_REASON_CODES, REMINDER_STATES, type WatchRow } from "../api.js";
import { isDirectReminder, parseReminderStatus, presentReminder, reasonCopy } from "./presenter.js";

const DUE = Date.UTC(2026, 9, 25, 8, 0); // Sun 25 Oct 2026, 08:00 GMT (after the change)
const ACCEPTED = {
  acceptedAt: DUE + 1_000,
  subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
};

function status(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    occurrenceId: `reminder:w1:${DUE}`,
    revision: 1,
    state: "scheduled",
    dueAt: DUE,
    timeZone: "Europe/London",
    expiresAt: DUE + 15 * 60_000,
    attempts: 0,
    attemptedAt: null,
    nextAttemptAt: null,
    acceptedAt: null,
    subscriptions: { total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
    reasonCode: null,
    phoneReceipt: "unconfirmed",
    ...over,
  };
}

function reminder(over: Partial<WatchRow> = {}): WatchRow {
  return {
    id: "w1", prompt: "Submit the essay", interval_minutes: 0, once: 1, enabled: 1, session_id: null,
    created_at: 1, last_run_at: null, last_status: null, last_result: null,
    run_at: DUE, kind: "reminder", reminder_status: status(), ...over,
  };
}

describe("parseReminderStatus", () => {
  it("accepts a well-formed v1 receipt and always reports phone receipt unconfirmed", () => {
    const parsed = parseReminderStatus(status({ phoneReceipt: "confirmed" }));
    expect(parsed?.occurrenceId).toBe(`reminder:w1:${DUE}`);
    expect(parsed?.phoneReceipt).toBe("unconfirmed");
  });

  it("rejects missing, wrong-version and malformed receipts", () => {
    expect(parseReminderStatus(undefined)).toBeNull();
    expect(parseReminderStatus(null)).toBeNull();
    expect(parseReminderStatus([])).toBeNull();
    expect(parseReminderStatus(status({ version: 2 }))).toBeNull();
    expect(parseReminderStatus(status({ dueAt: "soon" }))).toBeNull();
    expect(parseReminderStatus(status({ subscriptions: { total: 1 } }))).toBeNull();
    expect(parseReminderStatus(status({ attemptedAt: Number.NaN }))).toBeNull();
  });
});

describe("presentReminder", () => {
  it("only describes direct one-off reminders", () => {
    expect(presentReminder(reminder({ kind: "check" }))).toBeNull();
    expect(presentReminder(reminder({ run_at: null, daily_at: "09:00" }))).toBeNull();
    expect(isDirectReminder(reminder())).toBe(true);
  });

  it("shows when it is due in the zone it was chosen in", () => {
    expect(presentReminder(reminder())!.due).toBe("Sun 25 Oct 2026, 08:00 (Europe/London, UTC+00:00)");
  });

  it("labels every visible state honestly", () => {
    const labels = Object.fromEntries(REMINDER_STATES.map((state) => [
      state, presentReminder(reminder({ reminder_status: status({ state, ...(state === "accepted" ? ACCEPTED : {}) }) }))!.label,
    ]));
    expect(labels).toEqual({
      scheduled: "Scheduled",
      paused: "Paused",
      trying: "Trying",
      retry_scheduled: "Retry scheduled",
      accepted: "Accepted by notification service",
      failed: "Could not send",
      expired: "Expired",
      acceptance_unknown: "Acceptance unknown",
      cancelled: "Cancelled",
    });
  });

  it("never claims a phone received anything", () => {
    for (const state of REMINDER_STATES) {
      for (const reasonCode of [null, ...REMINDER_REASON_CODES]) {
        const view = presentReminder(reminder({ reminder_status: status({ state, reasonCode, ...(state === "accepted" ? ACCEPTED : {}) }) }))!;
        const text = `${view.label} ${view.detail}`.toLowerCase().replace("can't confirm your phone showed it.", "");
        for (const claim of ["delivered to your", "reached your phone", "your phone received", "arrived on your", "sent to your phone", "phone showed it"]) {
          expect(text, `${state}/${reasonCode}`).not.toContain(claim);
        }
      }
    }
    const accepted = presentReminder(reminder({ reminder_status: status({ state: "accepted", ...ACCEPTED }) }))!;
    expect(accepted.detail).toContain("can't confirm your phone showed it");
  });

  it("gives every closed reason code its own copy and never shows a raw code", () => {
    const copies = REMINDER_REASON_CODES.map((code) => reasonCopy(code));
    expect(new Set(copies).size).toBe(REMINDER_REASON_CODES.length);
    // Codes such as push_not_configured must never leak into the UI verbatim.
    for (const [index, code] of REMINDER_REASON_CODES.entries()) {
      if (code.includes("_")) expect(copies[index]).not.toContain(code);
    }
    expect(reasonCopy("brand_new_code")).toBe("AVA could not confirm what happened.");
    expect(reasonCopy(null)).toBeNull();
  });

  it("explains a missed window without claiming the PC slept", () => {
    const view = presentReminder(reminder({ reminder_status: status({ state: "expired", reasonCode: "missed_window" }) }))!;
    expect(view.label).toBe("Expired");
    expect(view.detail).toBe("The delivery window passed without a recorded attempt. AVA may have been offline.");
  });

  it("shows partial acceptance counts", () => {
    const view = presentReminder(reminder({
      reminder_status: status({
        state: "accepted",
        acceptedAt: DUE + 1_000,
        subscriptions: { total: 3, accepted: 1, rejectedTransient: 1, rejectedPermanent: 1, unknown: 0 },
      }),
    }))!;
    expect(view.detail).toContain("In the last attempt it was accepted for 1 of 3 registered subscriptions.");
  });

  it("says when the next retry is and why", () => {
    const view = presentReminder(reminder({
      reminder_status: status({ state: "retry_scheduled", reasonCode: "transient_rejection", nextAttemptAt: DUE + 15_000 }),
    }))!;
    expect(view.detail).toBe("The notification service turned it down for now. Next try Sun 25 Oct 2026, 08:00.");
  });

  it("keeps pre-send blockers visible while still scheduled", () => {
    const view = presentReminder(reminder({ reminder_status: status({ state: "scheduled", reasonCode: "no_subscriptions" }) }))!;
    expect(view.label).toBe("Scheduled");
    expect(view.detail).toBe("No device is registered for AVA notifications, so nothing was sent.");
  });

  it("does not pretend a pause recalled a send already in flight", () => {
    const view = presentReminder(reminder({
      enabled: 0,
      reminder_status: status({ state: "trying", attempts: 1, attemptedAt: DUE }),
    }))!;
    expect(view.label).toBe("Pause requested");
    expect(view.detail).toContain("outcome is still pending");
  });

  it("promises no resend after an unknown acceptance", () => {
    const view = presentReminder(reminder({ reminder_status: status({ state: "acceptance_unknown", reasonCode: "transport_timeout" }) }))!;
    expect(view.detail).toContain("won't resend it automatically");
  });

  it("shows an unknown future state as 'Could not confirm'", () => {
    expect(presentReminder(reminder({ reminder_status: status({ state: "teleported" }) }))!.label).toBe("Could not confirm");
  });

  it("is honest about older reminders without a receipt", () => {
    expect(presentReminder(reminder({ reminder_status: undefined }), DUE + 1)!.label).toBe("Delivery not recorded");
    expect(presentReminder(reminder({ reminder_status: undefined }), DUE - 1)!.label).toBe("Status unavailable");
  });
});

describe("untrustworthy receipts (#385)", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["a negative count", { subscriptions: { total: 1, accepted: -1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 } }],
    ["a fractional count", { subscriptions: { total: 1.5, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 } }],
    ["parts outnumbering the total", { subscriptions: { total: 1, accepted: 1, rejectedTransient: 1, rejectedPermanent: 0, unknown: 0 } }],
    ["a time outside the Date range", { dueAt: 9e15 }],
    ["a negative time", { attemptedAt: -5 }],
    ["an expiry before the due time", { expiresAt: DUE - 1 }],
    ["revision zero", { revision: 0 }],
    ["fractional attempts", { attempts: 0.5 }],
    ["'accepted' without an acceptance time", { state: "accepted", acceptedAt: null, subscriptions: { total: 1, accepted: 1, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 } }],
    ["'accepted' with nothing accepted", { state: "accepted", acceptedAt: DUE, subscriptions: { total: 1, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 1 } }],
    ["a malformed reason code", { reasonCode: "Not A Code" }],
  ];
  for (const [what, over] of bad) {
    it(`does not trust ${what}`, () => {
      expect(parseReminderStatus(status(over))).toBeNull();
      const view = presentReminder(reminder({ reminder_status: status(over) }))!;
      expect(view.label).toBe("Could not confirm");
      expect(view.label).not.toBe("Accepted by notification service");
    });
  }

  it("ignores a receipt that belongs to another reminder or another time, without showing its id", () => {
    for (const over of [{ occurrenceId: `reminder:other:${DUE}` }, { dueAt: DUE + 60_000, expiresAt: DUE + 960_000 }]) {
      const view = presentReminder(reminder({ reminder_status: status({ state: "accepted", ...ACCEPTED, ...over }) }))!;
      expect(view.label).toBe("Could not confirm");
      expect(`${view.detail} ${view.due}`).not.toContain("reminder:");
    }
  });
  it("describes a known expired pause in the past tense, not as an offline guess", () => {
    const view = presentReminder(reminder({ reminder_status: status({ state: "expired", reasonCode: "paused" }) }))!;
    expect(view.label).toBe("Expired");
    expect(view.detail).toBe("The delivery window ended without a send. It was paused when AVA last checked.");
    expect(view.detail).not.toMatch(/offline|will be sent/);
  });

  it("tells the two London 01:30s on 25 October apart", () => {
    const first = Date.UTC(2026, 9, 25, 0, 30);
    const second = Date.UTC(2026, 9, 25, 1, 30);
    const at = (runAt: number) => presentReminder(reminder({
      run_at: runAt,
      reminder_status: status({ occurrenceId: `reminder:w1:${runAt}`, dueAt: runAt, expiresAt: runAt + 900_000 }),
    }))!.due;
    expect(at(first)).toBe("Sun 25 Oct 2026, 01:30 (Europe/London, UTC+01:00)");
    expect(at(second)).toBe("Sun 25 Oct 2026, 01:30 (Europe/London, UTC+00:00)");
  });
});
