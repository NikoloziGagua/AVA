import type { Db } from "./db.js";

export type Subscription = {
  id: number;
  device_token_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  created_at: number;
  updated_at: number;
};

export type UpsertArgs = {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string | null;
  deviceTokenId: string | null;
};

export function upsertSubscription(db: Db, args: UpsertArgs): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO push_subscriptions (device_token_id, endpoint, p256dh, auth, device_label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device_label = excluded.device_label, updated_at = excluded.updated_at`,
  ).run(args.deviceTokenId, args.endpoint, args.p256dh, args.auth, args.deviceLabel, now, now);
}

export function listSubscriptions(db: Db): Subscription[] {
  return db.prepare("SELECT * FROM push_subscriptions ORDER BY created_at ASC").all() as Subscription[];
}

export function deleteSubscription(db: Db, endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}
