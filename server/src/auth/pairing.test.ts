import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../state/db.js";
import { issuePairingCode, consumePairingCode } from "./pairing.js";

const TTL = 5 * 60 * 1000;

describe("pairing codes", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("issues a 6-character code", () => {
    const code = issuePairingCode(db, TTL);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("consumes a valid code exactly once", () => {
    const code = issuePairingCode(db, TTL);
    expect(consumePairingCode(db, code)).toBe(true);
    expect(consumePairingCode(db, code)).toBe(false);
  });

  it("rejects unknown codes", () => {
    expect(consumePairingCode(db, "ZZZZZZ")).toBe(false);
  });

  it("rejects expired codes", () => {
    const code = issuePairingCode(db, -1000);
    expect(consumePairingCode(db, code)).toBe(false);
  });
});
