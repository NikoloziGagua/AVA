import webpush from "web-push";
import type { Db } from "../state/db.js";
import type { Approval } from "../state/approvals.js";
import { listSubscriptions, deleteSubscription } from "../state/push.js";

export type Vapid = { publicKey: string; privateKey: string; subject: string };

export type DeliveryResult = { sent: number; removed: number; failed: number };

export type ReminderDeliveryRequest = {
  occurrenceId: string;
  summary: string;
  expiresAt: number;
};

export type ReminderDeliveryResult = {
  subscriptions: {
    total: number;
    accepted: number;
    rejectedTransient: number;
    rejectedPermanent: number;
    unknown: number;
  };
  reasonCode: "no_subscriptions" | "transient_rejection" | "permanent_rejection"
    | "subscription_gone" | "transport_timeout" | "transport_unknown" | null;
};

export type Deliverer = {
  deliverApprovalPush: (approval: Approval) => Promise<DeliveryResult>;
  /** Proactive "task done" ping with a short summary. */
  deliverDonePush: (summary: string) => Promise<DeliveryResult>;
  /** Await bounded transport evidence; acceptance never proves phone receipt. */
  deliverReminderPush: (request: ReminderDeliveryRequest) => Promise<ReminderDeliveryResult>;
};

// Minimal send signature: accepts subscription + payload, returns any promise.
// Compatible with webpush.sendNotification and test mocks alike.
type SendFn = (
  subscription: Parameters<typeof webpush.sendNotification>[0],
  payload?: Parameters<typeof webpush.sendNotification>[1],
  options?: Parameters<typeof webpush.sendNotification>[2],
) => Promise<unknown>;

export type DelivererArgs = {
  db: Db;
  vapid: Vapid;
  // Override the underlying webpush.sendNotification — used for testing.
  send?: SendFn;
  now?: () => number;
  /** Reminder-only wall-clock and socket inactivity limit; capped at 20 seconds. */
  reminderTimeoutMs?: number;
};

type ReminderOutcome = "accepted" | "transient" | "permanent" | "gone" | "timeout" | "unknown";
const DEFAULT_REMINDER_TIMEOUT_MS = 10_000;
const MAX_REMINDER_TIMEOUT_MS = 20_000;

function reminderOutcome(value: unknown, fulfilled: boolean): ReminderOutcome {
  try {
    const status = value && typeof value === "object"
      ? (value as { statusCode?: unknown }).statusCode : undefined;
    if (typeof status === "number" && Number.isInteger(status)) {
      if (fulfilled && status >= 200 && status <= 299) return "accepted";
      if (status === 404 || status === 410) return "gone";
      if (status === 429 || (status >= 500 && status <= 599)) return "transient";
      if (status >= 400 && status <= 499) return "permanent";
    }
    // web-push destroys inactive sockets with this exact error; never retain
    // arbitrary transport messages, endpoints, headers, or response bodies.
    const code = value && typeof value === "object" ? (value as { code?: unknown }).code : undefined;
    if (!fulfilled && (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT"
      || value instanceof Error && value.message === "Socket timeout")) return "timeout";
  } catch { /* malformed transport objects are not acceptance evidence */ }
  return "unknown";
}

export function buildDeliverer(args: DelivererArgs): Deliverer {
  webpush.setVapidDetails(args.vapid.subject, args.vapid.publicKey, args.vapid.privateKey);
  const send = args.send ?? webpush.sendNotification;
  const now = args.now ?? Date.now;
  const configuredTimeout = args.reminderTimeoutMs;
  const reminderTimeoutMs = typeof configuredTimeout === "number" && Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.max(1, Math.min(MAX_REMINDER_TIMEOUT_MS, Math.floor(configuredTimeout)))
    : DEFAULT_REMINDER_TIMEOUT_MS;

  // Fan a single payload out to every subscription, pruning dead ones.
  async function fanOut(payload: string): Promise<DeliveryResult> {
    const subs = listSubscriptions(args.db);
    let sent = 0, removed = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const e = err as { statusCode?: number };
        if (e.statusCode === 410 || e.statusCode === 404) {
          deleteSubscription(args.db, s.endpoint);
          removed++;
        } else {
          failed++;
        }
      }
    }));
    return { sent, removed, failed };
  }

  return {
    deliverApprovalPush(approval) {
      return fanOut(JSON.stringify({
        title: "Ava needs approval",
        body: approval.summary,
        tag: `approval-${approval.id}`,
        data: { approvalId: approval.id, deepLink: `/?approval=${approval.id}` },
      }));
    },
    deliverDonePush(summary) {
      return fanOut(JSON.stringify({
        title: "Ava — task done",
        body: summary,
        tag: "ava-done",
        data: { deepLink: "/" },
      }));
    },
    async deliverReminderPush(request) {
      const startedAt = now();
      if (!request || typeof request.occurrenceId !== "string" || !/^[A-Za-z0-9:_-]{1,160}$/.test(request.occurrenceId)
        || typeof request.summary !== "string" || !request.summary.trim()
        || !Number.isSafeInteger(request.expiresAt) || !Number.isSafeInteger(startedAt)
        || request.expiresAt <= startedAt) throw new Error("invalid_reminder_request");
      const subs = listSubscriptions(args.db);
      const subscriptions = { total: subs.length, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 };
      if (!subs.length) return { subscriptions, reasonCode: "no_subscriptions" };
      const payload = JSON.stringify({
        title: "Ava — reminder",
        body: request.summary,
        tag: `ava-reminder-${request.occurrenceId}`,
        data: { occurrenceId: request.occurrenceId, deepLink: "/" },
      });
      const deadlineAt = Math.min(request.expiresAt, startedAt + reminderTimeoutMs);
      const outcomes = await Promise.all(subs.map((s) => {
        const dispatchedAt = now();
        const remainingMs = request.expiresAt - dispatchedAt;
        const budgetMs = deadlineAt - dispatchedAt;
        // No new send after expiry, including when dispatch itself took time.
        if (!Number.isFinite(budgetMs) || budgetMs <= 0) return Promise.resolve<ReminderOutcome>("timeout");
        const timeoutMs = Math.max(1, Math.floor(budgetMs));
        return new Promise<ReminderOutcome>((resolve) => {
          let settled = false;
          const finish = (outcome: ReminderOutcome) => {
            if (settled) return; // late responses cannot prune or alter evidence
            settled = true;
            clearTimeout(timer);
            if (now() >= deadlineAt) outcome = "timeout";
            if (outcome === "gone") {
              try { deleteSubscription(args.db, s.endpoint); } catch { /* transport rejection remains known */ }
            }
            resolve(outcome);
          };
          // Socket inactivity alone does not bound a slow, continuously active
          // connection. The independent deadline bounds our awaited result;
          // a late provider settlement remains unknown, never upgraded later.
          const timer = setTimeout(() => finish("timeout"), timeoutMs);
          try {
            Promise.resolve(send(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
              { TTL: Math.min(2_419_200, Math.floor(remainingMs / 1_000)), timeout: timeoutMs },
            )).then(
              (result) => finish(reminderOutcome(result, true)),
              (error) => finish(reminderOutcome(error, false)),
            );
          } catch (error) {
            finish(reminderOutcome(error, false));
          }
        });
      }));
      for (const outcome of outcomes) {
        if (outcome === "accepted") subscriptions.accepted++;
        else if (outcome === "transient") subscriptions.rejectedTransient++;
        else if (outcome === "permanent" || outcome === "gone") subscriptions.rejectedPermanent++;
        else subscriptions.unknown++;
      }
      // Stable severity priority independent of subscriber ordering/settlement.
      const reasonCode = outcomes.includes("timeout") ? "transport_timeout"
        : outcomes.includes("unknown") ? "transport_unknown"
        : outcomes.includes("transient") ? "transient_rejection"
        : outcomes.includes("gone") ? "subscription_gone"
        : outcomes.includes("permanent") ? "permanent_rejection" : null;
      return { subscriptions, reasonCode };
    },
  };
}

// Convenience standalones — call buildDeliverer once and use:
export async function deliverApprovalPush(args: {
  db: Db;
  vapid: Vapid;
  approval: Approval;
  send?: SendFn;
}): Promise<DeliveryResult> {
  return buildDeliverer({ db: args.db, vapid: args.vapid, send: args.send }).deliverApprovalPush(args.approval);
}

export async function deliverDonePush(args: {
  db: Db;
  vapid: Vapid;
  summary: string;
  send?: SendFn;
}): Promise<DeliveryResult> {
  return buildDeliverer({ db: args.db, vapid: args.vapid, send: args.send }).deliverDonePush(args.summary);
}
