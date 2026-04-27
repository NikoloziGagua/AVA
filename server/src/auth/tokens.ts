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

export function listTokens(db: Db): DeviceToken[] {
  return db
    .prepare(
      "SELECT id, label, created_at, last_seen_at FROM device_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC"
    )
    .all() as DeviceToken[];
}

export function revokeToken(db: Db, id: string): void {
  db.prepare("UPDATE device_tokens SET revoked_at = ? WHERE id = ?").run(
    Date.now(),
    id
  );
}
