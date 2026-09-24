import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../state/db.js";
import { issueToken, validateToken, listTokens, revokeToken, revokeTokensByLabel } from "./tokens.js";

describe("device tokens", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("issues a token + raw secret; raw secret is 40+ chars urlsafe", () => {
    const { id, secret } = issueToken(db, { label: "iPhone" });
    expect(id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it("validates an issued secret and returns id", () => {
    const { secret, id } = issueToken(db, { label: "phone" });
    expect(validateToken(db, secret)).toBe(id);
  });

  it("rejects an unknown secret", () => {
    issueToken(db, { label: "phone" });
    expect(validateToken(db, "definitely-not-a-real-token-xxxxxxxxxxxxxxxx")).toBeNull();
  });

  it("revoke invalidates the secret", () => {
    const { id, secret } = issueToken(db, { label: "phone" });
    revokeToken(db, id);
    expect(validateToken(db, secret)).toBeNull();
  });

  it("lists active tokens, hides revoked", () => {
    const a = issueToken(db, { label: "a" });
    const b = issueToken(db, { label: "b" });
    revokeToken(db, b.id);
    const list = listTokens(db);
    expect(list.map((t) => t.id)).toEqual([a.id]);
  });

  it("revokeTokensByLabel retires all live tokens of a label and returns the count", () => {
    issueToken(db, { label: "voice-internal" });
    issueToken(db, { label: "voice-internal" });
    const keep = issueToken(db, { label: "iPhone" });
    const n = revokeTokensByLabel(db, "voice-internal");
    expect(n).toBe(2);
    // a second call retires nothing (already revoked)
    expect(revokeTokensByLabel(db, "voice-internal")).toBe(0);
    // unrelated tokens are untouched
    expect(validateToken(db, keep.secret)).toBe(keep.id);
  });

  it("hides all loopback tokens from the user-facing device list", () => {
    const phone = issueToken(db, { label: "iPhone" });
    issueToken(db, { label: "voice-internal" });
    issueToken(db, { label: "watch-internal" });
    const list = listTokens(db);
    expect(list.map((t) => t.label)).toEqual(["iPhone"]);
    expect(list.map((t) => t.id)).toEqual([phone.id]);
  });
});

describe("token validation cost", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });
  afterEach(() => { vi.restoreAllMocks(); });

  /** A token as stored before digests existed: bcrypt hash only. */
  function legacyToken(label: string): { id: string; secret: string } {
    const issued = issueToken(db, { label });
    db.prepare("UPDATE device_tokens SET token_lookup = NULL WHERE id = ?").run(issued.id);
    return issued;
  }

  it("finds a current token by digest without any bcrypt work, however many devices exist", () => {
    for (let i = 0; i < 6; i++) legacyToken(`old-${i}`);
    const phone = issueToken(db, { label: "iPhone" });
    const compare = vi.spyOn(bcrypt, "compareSync");
    expect(validateToken(db, phone.secret)).toBe(phone.id);
    expect(compare).not.toHaveBeenCalled();
    const seen = db.prepare("SELECT last_seen_at FROM device_tokens WHERE id = ?").get(phone.id) as { last_seen_at: number | null };
    expect(seen.last_seen_at).not.toBeNull();
  });

  it("upgrades a legacy token on its first use, then validates it by digest", () => {
    const phone = legacyToken("Phone");
    const compare = vi.spyOn(bcrypt, "compareSync");
    expect(validateToken(db, phone.secret)).toBe(phone.id);
    expect(compare).toHaveBeenCalled();
    compare.mockClear();
    expect(validateToken(db, phone.secret)).toBe(phone.id);
    expect(compare).not.toHaveBeenCalled();
  });

  it("never accepts a revoked token, upgraded or not", () => {
    const upgraded = issueToken(db, { label: "a" });
    const legacy = legacyToken("b");
    revokeToken(db, upgraded.id);
    revokeToken(db, legacy.id);
    expect(validateToken(db, upgraded.secret)).toBeNull();
    expect(validateToken(db, legacy.secret)).toBeNull();
  });

  it("does not repeat the slow legacy scan for the same rejected token", () => {
    legacyToken("old");
    const compare = vi.spyOn(bcrypt, "compareSync");
    const forged = "f".repeat(48);
    expect(validateToken(db, forged)).toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
    expect(validateToken(db, forged)).toBeNull();
    expect(compare).toHaveBeenCalledTimes(1);
    // A token issued afterwards is still accepted immediately.
    const fresh = issueToken(db, { label: "new phone" });
    expect(validateToken(db, fresh.secret)).toBe(fresh.id);
  });

  it("migrates a database created before the digest existed, keeping its tokens valid", () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-token-migration-"));
    const path = join(dir, "state.db");
    const old = new Database(path);
    old.exec(`CREATE TABLE device_tokens (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER)`);
    const secret = "s".repeat(48);
    old.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)")
      .run("old-phone", bcrypt.hashSync(secret, 4), "Phone", 1);
    old.close();

    const migrated = openDb(path);
    const columns = (migrated.prepare("PRAGMA table_info(device_tokens)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).toContain("token_lookup");
    expect(validateToken(migrated, secret)).toBe("old-phone");
    const row = migrated.prepare("SELECT token_lookup FROM device_tokens WHERE id = 'old-phone'").get() as { token_lookup: string | null };
    expect(row.token_lookup).toMatch(/^[0-9a-f]{64}$/);
    migrated.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
