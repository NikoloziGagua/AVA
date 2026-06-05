import webpush from "web-push";
import type { Db } from "../state/db.js";
import type { Approval } from "../state/approvals.js";
import { listSubscriptions, deleteSubscription } from "../state/push.js";

export type Vapid = { publicKey: string; privateKey: string; subject: string };

export type DeliveryResult = { sent: number; removed: number; failed: number };

export type Deliverer = {
  deliverApprovalPush: (approval: Approval) => Promise<DeliveryResult>;
  /** Proactive "task done" ping with a short summary. */
  deliverDonePush: (summary: string) => Promise<DeliveryResult>;
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
};

export function buildDeliverer(args: DelivererArgs): Deliverer {
  webpush.setVapidDetails(args.vapid.subject, args.vapid.publicKey, args.vapid.privateKey);
  const send = args.send ?? webpush.sendNotification;

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
