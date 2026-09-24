/**
 * One honest description of a direct one-off reminder (contract
 * i4-one-off-reminders v1), shared by Schedule, Today and the Watches views.
 *
 * The evidence ends at the notification service. "Accepted" means the service
 * took the message, never that a phone showed it, so no copy here may claim
 * delivery to a device.
 */
import type { ReminderStatus, WatchRow } from "../api.js";
import { browserTimeZone, formatOffset, formatWallTime, isValidTimeZone, offsetMinutesAt } from "./time.js";

export type ReminderTone = "pending" | "active" | "good" | "warn" | "bad" | "muted";

export type ReminderPresentation = {
  /** Short status label, e.g. "Scheduled" or "Accepted by notification service". */
  label: string;
  /** One or two plain sentences explaining the label. */
  detail: string;
  tone: ReminderTone;
  /** When it is (or was) due, in the zone it was chosen in. */
  due: string;
};

const REASON_COPY: Record<string, string> = {
  push_not_configured: "Phone notifications aren't set up on AVA yet, so nothing was sent.",
  no_subscriptions: "No device is registered for AVA notifications, so nothing was sent.",
  transient_rejection: "The notification service turned it down for now.",
  permanent_rejection: "The notification service rejected it, and trying again won't help.",
  subscription_gone: "The registered notification subscriptions have expired or were removed.",
  transport_timeout: "The notification service didn't answer in time, so AVA can't confirm it was accepted.",
  transport_unknown: "The notification service's answer didn't show whether it was accepted.",
  missed_window: "The delivery window passed without a recorded attempt. AVA may have been offline.",
  retry_exhausted: "AVA tried as many times as allowed and the service never accepted it.",
  delivery_window_expired: "The delivery window ended before the service accepted it.",
  paused: "It's paused, so nothing will be sent.",
  deleted: "It was deleted before it was sent.",
  delivery_not_recorded: "AVA has no record of whether this reminder was delivered.",
};

/** Honest copy for a reason code; unknown future codes are never shown raw. */
export function reasonCopy(code: string | null | undefined): string | null {
  if (!code) return null;
  return REASON_COPY[code] ?? "AVA could not confirm what happened.";
}

/** The largest instant a Date can hold. */
const MAX_TIME = 8.64e15;
const MAX_COUNT = 100_000;

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
const instant = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_TIME;
const instantOrNull = (value: unknown): value is number | null => value === null || instant(value);

/**
 * Accept only a well-formed, internally consistent v1 receipt. Anything else
 * (wrong types, negative or fractional counts, impossible times, parts that
 * outnumber the total, an "accepted" state without acceptance evidence) is
 * treated as unreadable, never as a result.
 */
export function parseReminderStatus(raw: unknown): ReminderStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const subs = r.subscriptions as Record<string, unknown> | undefined;
  if (
    r.version !== 1
    || typeof r.occurrenceId !== "string" || r.occurrenceId.length === 0 || r.occurrenceId.length > 200
    || !(typeof r.revision === "number" && Number.isSafeInteger(r.revision) && r.revision >= 1)
    || typeof r.state !== "string" || !/^[a-z_]{1,40}$/.test(r.state)
    || !instant(r.dueAt)
    || !(r.timeZone === null || (typeof r.timeZone === "string" && r.timeZone.length > 0 && r.timeZone.length <= 100))
    || !instant(r.expiresAt) || (r.expiresAt as number) < (r.dueAt as number)
    || !count(r.attempts)
    || !instantOrNull(r.attemptedAt)
    || !instantOrNull(r.nextAttemptAt)
    || !instantOrNull(r.acceptedAt)
    || !subs || typeof subs !== "object" || Array.isArray(subs)
    || !["total", "accepted", "rejectedTransient", "rejectedPermanent", "unknown"].every((key) => count(subs[key]))
    || !(r.reasonCode === null || (typeof r.reasonCode === "string" && /^[a-z_]{1,64}$/.test(r.reasonCode)))
  ) return null;
  const subscriptions = {
    total: subs.total as number,
    accepted: subs.accepted as number,
    rejectedTransient: subs.rejectedTransient as number,
    rejectedPermanent: subs.rejectedPermanent as number,
    unknown: subs.unknown as number,
  };
  const parts = subscriptions.accepted + subscriptions.rejectedTransient + subscriptions.rejectedPermanent + subscriptions.unknown;
  if (parts > subscriptions.total) return null;
  // "Accepted" must carry the evidence that makes it true.
  if (r.state === "accepted" && (r.acceptedAt === null || subscriptions.accepted < 1)) return null;
  return {
    version: 1,
    occurrenceId: r.occurrenceId,
    revision: r.revision,
    state: r.state,
    dueAt: r.dueAt as number,
    timeZone: r.timeZone as string | null,
    expiresAt: r.expiresAt as number,
    attempts: r.attempts as number,
    attemptedAt: r.attemptedAt as number | null,
    nextAttemptAt: r.nextAttemptAt as number | null,
    acceptedAt: r.acceptedAt as number | null,
    subscriptions,
    reasonCode: r.reasonCode as string | null,
    // Whatever the server says, AVA never has proof a phone showed it.
    phoneReceipt: "unconfirmed",
  };
}

/**
 * The receipt only counts for this exact reminder: its occurrence is the one
 * for this watch at this due time. A receipt for anything else is ignored.
 */
export function receiptFor(watch: WatchRow): ReminderStatus | null {
  const status = parseReminderStatus(watch.reminder_status);
  const runAt = Number(watch.run_at);
  if (!status || status.dueAt !== runAt || status.occurrenceId !== `reminder:${watch.id}:${runAt}`) return null;
  return status;
}

/** A direct one-off reminder: kind=reminder with an exact run_at. */
export function isDirectReminder(watch: WatchRow): boolean {
  return watch.kind === "reminder" && instant(Number(watch.run_at));
}

const enabled = (watch: WatchRow) => watch.enabled === true || watch.enabled === 1;

/** "Sun 25 Oct 2026, 01:30 (Europe/London, UTC+01:00)": the offset tells two repeated times apart. */
function dueText(at: number, zone: string | null): string {
  const shown = zone && isValidTimeZone(zone) ? zone : browserTimeZone();
  return `${formatWallTime(at, shown)} (${shown}, ${formatOffset(offsetMinutesAt(at, shown))})`;
}

const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" ");

/** Describe a direct one-off reminder, or null for any other watch. */
export function presentReminder(watch: WatchRow, now: number = Date.now()): ReminderPresentation | null {
  if (!isDirectReminder(watch)) return null;
  const runAt = Number(watch.run_at);
  const status = receiptFor(watch);

  if (!status && watch.reminder_status !== undefined && watch.reminder_status !== null) {
    // A receipt was sent but is malformed or belongs to something else.
    return {
      label: "Could not confirm",
      detail: "AVA couldn't read a trustworthy delivery status for this reminder, so none is shown.",
      tone: "warn",
      due: dueText(runAt, typeof watch.time_zone === "string" ? watch.time_zone : null),
    };
  }

  if (!status) {
    const due = dueText(runAt, null);
    return runAt <= now
      ? { label: "Delivery not recorded", detail: REASON_COPY.delivery_not_recorded!, tone: "muted", due }
      : {
        label: "Status unavailable",
        detail: "This AVA server doesn't report reminder delivery, so its outcome won't be shown here.",
        tone: "muted",
        due,
      };
  }

  const due = dueText(status.dueAt, status.timeZone);
  const reason = reasonCopy(status.reasonCode);
  const at = (when: number | null) => (when ? formatWallTime(when, status.timeZone && isValidTimeZone(status.timeZone) ? status.timeZone : browserTimeZone()) : null);

  // Pausing cannot recall a send already handed to the service (#331).
  if (!enabled(watch) && status.state === "trying" && status.attemptedAt !== null) {
    return {
      label: "Pause requested",
      detail: "A send was already in progress when it was paused. Its outcome is still pending.",
      tone: "warn",
      due,
    };
  }

  switch (status.state) {
    case "scheduled":
      return { label: "Scheduled", detail: reason ?? "AVA will hand it to the notification service when it's due.", tone: "pending", due };
    case "paused":
      return { label: "Paused", detail: "It's paused, so nothing will be sent.", tone: "muted", due };
    case "trying":
      return {
        label: "Trying",
        detail: join("AVA is handing it to the notification service.", status.attempts > 1 ? `Attempt ${status.attempts}.` : null),
        tone: "active",
        due,
      };
    case "retry_scheduled":
      return {
        label: "Retry scheduled",
        detail: join(reason, status.nextAttemptAt ? `Next try ${at(status.nextAttemptAt)}.` : null),
        tone: "warn",
        due,
      };
    case "accepted": {
      const { accepted, total } = status.subscriptions;
      return {
        label: "Accepted by notification service",
        detail: join(
          total > 1 && accepted < total ? `In the last attempt it was accepted for ${accepted} of ${total} registered subscriptions.` : null,
          "AVA can't confirm your phone showed it.",
        ),
        tone: "good",
        due,
      };
    }
    case "failed":
      return { label: "Could not send", detail: reason ?? "The notification service did not accept it.", tone: "bad", due };
    case "expired":
      return { label: "Expired", detail: reason ?? "The delivery window passed.", tone: "bad", due };
    case "acceptance_unknown":
      return {
        label: "Acceptance unknown",
        detail: join(reason, "AVA won't resend it automatically, to avoid a duplicate."),
        tone: "warn",
        due,
      };
    case "cancelled":
      return { label: "Cancelled", detail: reason ?? "It was cancelled before it was sent.", tone: "muted", due };
    default:
      return { label: "Could not confirm", detail: "AVA could not confirm what happened to this reminder.", tone: "warn", due };
  }
}

const PENDING_STATES = new Set(["scheduled", "paused", "trying", "retry_scheduled"]);
const RECENT_LIMIT = 10;

function isPendingReminder(watch: WatchRow, now: number): boolean {
  const status = receiptFor(watch);
  return status ? PENDING_STATES.has(status.state) : Number(watch.run_at) > now;
}

function reminderDueAt(watch: WatchRow): number {
  return Number(watch.run_at);
}

/**
 * Direct one-off reminders split into those still to come (soonest first) and
 * the most recent finished ones. Checks, Codex watches and recurring reminders
 * are never included.
 */
export function orderReminders(watches: WatchRow[], now: number): { upcoming: WatchRow[]; earlier: WatchRow[] } {
  const reminders = watches.filter(isDirectReminder);
  return {
    upcoming: reminders.filter((w) => isPendingReminder(w, now)).sort((a, b) => reminderDueAt(a) - reminderDueAt(b)),
    earlier: reminders.filter((w) => !isPendingReminder(w, now)).sort((a, b) => reminderDueAt(b) - reminderDueAt(a)).slice(0, RECENT_LIMIT),
  };
}
