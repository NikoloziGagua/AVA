import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { getAgentroomPreference, setAgentroomPreference } from "./agentroom-pref.js";

describe("agentroom preference", () => {
  let db: Db;
  beforeEach(() => { db = openDb(":memory:"); });

  it("is durably off by default and advances its optimistic version", () => {
    expect(getAgentroomPreference(db)).toMatchObject({ enabled: false, version: 1 });
    expect(setAgentroomPreference(db, true, 1, 100)).toEqual({
      ok: true,
      preference: { enabled: true, version: 2, updatedAt: 100 },
    });
    expect(getAgentroomPreference(db)).toEqual({ enabled: true, version: 2, updatedAt: 100 });
  });

  it("rejects stale writes without changing the newer value", () => {
    expect(setAgentroomPreference(db, true, 1, 100).ok).toBe(true);
    expect(setAgentroomPreference(db, false, 1, 200)).toEqual({
      ok: false,
      reason: "stale_version",
      preference: { enabled: true, version: 2, updatedAt: 100 },
    });
  });
});
