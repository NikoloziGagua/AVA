import { describe, it, expect, beforeEach } from "vitest";
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

  it("hides internal (voice-internal) tokens from the user-facing device list", () => {
    const phone = issueToken(db, { label: "iPhone" });
    issueToken(db, { label: "voice-internal" });
    const list = listTokens(db);
    expect(list.map((t) => t.label)).toEqual(["iPhone"]);
    expect(list.map((t) => t.id)).toEqual([phone.id]);
  });
});
