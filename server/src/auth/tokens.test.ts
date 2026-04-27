import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../state/db.js";
import { issueToken, validateToken, listTokens, revokeToken } from "./tokens.js";

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
});
