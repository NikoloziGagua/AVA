import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { openDb } from "./db.js";

const TEST_DB = "./test-state.db";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const p = TEST_DB + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

describe("openDb", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("creates the file and applies the schema", () => {
    const db = openDb(TEST_DB);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name).sort();
    expect(names).toContain("sessions");
    expect(names).toContain("messages");
    expect(names).toContain("tool_calls");
    expect(names).toContain("device_tokens");
    expect(names).toContain("pairing_codes");
    db.close();
  });

  it("is idempotent (re-opening doesn't error)", () => {
    const db1 = openDb(TEST_DB);
    db1.close();
    const db2 = openDb(TEST_DB);
    db2.close();
  });
});

describe("db migrations: sessions.deleted_at", () => {
  it("creates deleted_at column", () => {
    const db = openDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "deleted_at")).toBe(true);
  });
  it("creates idx_sessions_deleted index", () => {
    const db = openDb(":memory:");
    const idx = db.prepare("PRAGMA index_list(sessions)").all() as Array<{ name: string }>;
    expect(idx.some((i) => i.name === "idx_sessions_deleted")).toBe(true);
  });
});
