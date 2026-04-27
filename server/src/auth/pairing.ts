import type { Db } from "../state/db.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I, L, O, 0, 1
const LEN = 6;

function generate(): string {
  let s = "";
  for (let i = 0; i < LEN; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export function issuePairingCode(db: Db, ttlMs: number): string {
  let code = generate();
  while (db.prepare("SELECT 1 FROM pairing_codes WHERE code = ?").get(code)) {
    code = generate();
  }
  const now = Date.now();
  db.prepare(
    "INSERT INTO pairing_codes (code, created_at, expires_at) VALUES (?, ?, ?)"
  ).run(code, now, now + ttlMs);
  return code;
}

export function consumePairingCode(db: Db, code: string): boolean {
  const now = Date.now();
  const row = db
    .prepare("SELECT used_at, expires_at FROM pairing_codes WHERE code = ?")
    .get(code) as { used_at: number | null; expires_at: number } | undefined;
  if (!row) return false;
  if (row.used_at !== null) return false;
  if (row.expires_at < now) return false;
  db.prepare("UPDATE pairing_codes SET used_at = ? WHERE code = ?").run(now, code);
  return true;
}
