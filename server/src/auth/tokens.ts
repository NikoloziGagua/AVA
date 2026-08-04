import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";

export type DeviceToken = {
  id: string;
  label: string;
  created_at: number;
  last_seen_at: number | null;
};

export function issueToken(
  db: Db,
  opts: { label: string }
): { id: string; secret: string } {
  const id = nanoid(12);
  const secret = nanoid(48);
  const hash = bcrypt.hashSync(secret, 10);
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)"
  ).run(id, hash, opts.label, Date.now());
  return { id, secret };
}

export function validateToken(db: Db, secret: string): string | null {
  const rows = db
    .prepare("SELECT id, token_hash FROM device_tokens WHERE revoked_at IS NULL")
    .all() as { id: string; token_hash: string }[];
  for (const row of rows) {
    if (bcrypt.compareSync(secret, row.token_hash)) {
      db.prepare("UPDATE device_tokens SET last_seen_at = ? WHERE id = ?").run(
        Date.now(),
        row.id
      );
      return row.id;
    }
  }
  return null;
}

// Internal (loopback) token labels are hidden from the user-facing device list:
// they are not real devices Sir manages, and listing them invited an accidental
// revoke that would break loopback auth (e.g. hybrid-voice actions) until restart.
const INTERNAL_LABELS = new Set(["voice-internal", "watch-internal"]);

export function listTokens(db: Db): DeviceToken[] {
  const rows = db
    .prepare(
      "SELECT id, label, created_at, last_seen_at FROM device_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC"
    )
    .all() as DeviceToken[];
  return rows.filter((r) => !INTERNAL_LABELS.has(r.label));
}

export function revokeToken(db: Db, id: string): void {
  db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ?").run(
    Date.now(),
    id
  );
}

/** Revoke every still-live token with the given label. Used at boot to retire the
 *  previous run's internal tokens before minting a fresh one, so the table can't
 *  accumulate an unbounded set of standing full-privilege credentials (one per
 *  restart) — each of which also slows the bcrypt-over-all-rows validate scan.
 *  Returns the number revoked. */
export function revokeTokensByLabel(db: Db, label: string): number {
  const info = db
    .prepare("UPDATE device_tokens SET revoked_at = ? WHERE label = ? AND revoked_at IS NULL")
    .run(Date.now(), label);
  return info.changes ?? 0;
}
