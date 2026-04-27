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
