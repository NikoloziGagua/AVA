import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";

/**
 * Exact-match lookup key for a token. Secrets are 48 random nanoid characters
 * (~288 bits), so a SHA-256 digest is safe to store and index, as API-key
 * systems do. bcrypt stays the stored credential for tokens issued before the
 * digest existed: each is verified the slow way once, then gains its digest.
 *
 * Measured 2026-09-24: validating against bcrypt over every live token cost
 * ~105 ms per token (bcryptjs is synchronous), so ~2.4 s per request with 22
 * tokens, with the event loop (and the voice audio relay) blocked meanwhile.
 */
function tokenLookup(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

// Recently rejected digests, per database, so a stale or forged token cannot
// force the slow legacy scan on every request. A rejected secret cannot become
// valid later: new tokens are found by digest before this cache is consulted.
const REJECTED_TTL_MS = 60_000;
const MAX_REJECTED = 256;
const rejectedByDb = new WeakMap<Db, Map<string, number>>();

function rejectedFor(db: Db): Map<string, number> {
  let rejected = rejectedByDb.get(db);
  if (!rejected) { rejected = new Map(); rejectedByDb.set(db, rejected); }
  return rejected;
}

export type DeviceToken = {
  id: string;
  label: string;
  created_at: number;
  last_seen_at: number | null;
};

export function issueToken(
  db: Db,
  opts: { label: string; sessionActor?: "human" | "automation" | "voice_action" }
): { id: string; secret: string } {
  const id = nanoid(12);
  const secret = nanoid(48);
  const hash = bcrypt.hashSync(secret, 10);
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, token_lookup, label, created_at, session_actor) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, hash, tokenLookup(secret), opts.label, Date.now(), opts.sessionActor ?? "human");
  return { id, secret };
}

export function validateToken(db: Db, secret: string): string | null {
  const lookup = tokenLookup(secret);
  const hit = db
    .prepare("SELECT id FROM device_tokens WHERE token_lookup = ? AND revoked_at IS NULL")
    .get(lookup) as { id: string } | undefined;
  if (hit) {
    db.prepare("UPDATE device_tokens SET last_seen_at = ? WHERE id = ?").run(Date.now(), hit.id);
    return hit.id;
  }
  const rejected = rejectedFor(db);
  const rejectedAt = rejected.get(lookup);
  if (rejectedAt !== undefined && Date.now() - rejectedAt < REJECTED_TTL_MS) return null;
  // Only tokens issued before the digest existed still need bcrypt.
  const legacy = db
    .prepare("SELECT id, token_hash FROM device_tokens WHERE revoked_at IS NULL AND token_lookup IS NULL")
    .all() as { id: string; token_hash: string }[];
  for (const row of legacy) {
    if (bcrypt.compareSync(secret, row.token_hash)) {
      db.prepare("UPDATE device_tokens SET token_lookup = ?, last_seen_at = ? WHERE id = ?")
        .run(lookup, Date.now(), row.id);
      rejected.delete(lookup);
      return row.id;
    }
  }
  if (rejected.size >= MAX_REJECTED) {
    const oldest = rejected.keys().next().value;
    if (oldest !== undefined) rejected.delete(oldest);
  }
  rejected.set(lookup, Date.now());
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
