import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
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
    expect(names).toContain("task_receipts");
    expect(names).toContain("tool_calls");
    expect(names).toContain("explorer_tasks");
    expect(names).toContain("explorer_events");
    expect(names).toContain("memory_index_entries");
    expect(names).toContain("memory_index_auto_events");
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

  it("migrates a pre-handoff Strategy Room table before creating its snapshot index", () => {
    const legacy = new Database(TEST_DB);
    legacy.exec(`
      CREATE TABLE strategy_rooms (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL,
        status TEXT NOT NULL, phase TEXT NOT NULL, active_actor TEXT,
        round INTEGER NOT NULL, version INTEGER NOT NULL, living_brief TEXT,
        conclusion TEXT, codex_thread_id TEXT, error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        approved_at INTEGER, stopped_at INTEGER
      );
    `);
    legacy.close();

    const migrated = openDb(TEST_DB);
    const columns = migrated.prepare("PRAGMA table_info(strategy_rooms)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "source_session_id",
      "source_through_message_id",
      "returned_message_id",
      "returned_at",
    ]));
    const indexes = migrated.prepare("PRAGMA index_list(strategy_rooms)").all() as Array<{ name: string }>;
    expect(indexes.some((index) => index.name === "idx_strategy_rooms_source_snapshot")).toBe(true);
    migrated.close();
  });

  it("migrates a Phase 2 memory index before creating the checkpoint-sequence index", () => {
    const legacy = new Database(TEST_DB);
    legacy.exec(`
      CREATE TABLE memory_index_entries (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
        kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        conclusions TEXT NOT NULL DEFAULT '[]', open_questions TEXT NOT NULL DEFAULT '[]',
        next_steps TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]',
        project TEXT, project_key TEXT, privacy_level TEXT NOT NULL DEFAULT 'personal',
        capture_mode TEXT NOT NULL DEFAULT 'explicit', capture_reason TEXT,
        status TEXT NOT NULL DEFAULT 'active', embedding_status TEXT NOT NULL DEFAULT 'pending',
        source_fingerprint TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, forgotten_at INTEGER
      );
      INSERT INTO memory_index_entries (
        id, kind, title, summary, status, embedding_status, source_fingerprint,
        created_at, updated_at
      ) VALUES ('legacy-memory', 'idea', 'Legacy', 'Legacy Phase 2 entry',
        'active', 'unavailable', 'legacy-fingerprint', 1, 1);
    `);
    legacy.close();

    const migrated = openDb(TEST_DB);
    const entry = migrated.prepare(`
      SELECT thread_id, parent_entry_id, checkpoint_sequence, checkpoint_kind
      FROM memory_index_entries WHERE id = 'legacy-memory'
    `).get();
    expect(entry).toEqual({
      thread_id: "legacy-memory",
      parent_entry_id: null,
      checkpoint_sequence: 1,
      checkpoint_kind: "initial",
    });
    const indexes = migrated.prepare("PRAGMA index_list(memory_index_entries)").all() as Array<{ name: string }>;
    expect(indexes.some((index) => index.name === "idx_memory_index_thread_sequence")).toBe(true);
    migrated.close();
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

describe("db migrations: targeted watches", () => {
  it("adds pinned-target, delivery evidence, and cycle columns", () => {
    const db = openDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(watches)").all() as Array<{ name: string }>;
    const names = cols.map((column) => column.name);
    expect(names).toEqual(expect.arrayContaining([
      "target_thread_id",
      "target_session_file",
      "target_cwd",
      "continue_cycle",
      "parent_watch_id",
      "delivery_marker",
      "dispatch_offset",
      "dispatch_turn_id",
      "dispatch_pid",
      "delivered_at",
      "completed_at",
    ]));
    const indexes = db.prepare("PRAGMA index_list(watches)").all() as Array<{ name: string }>;
    expect(indexes.some((index) => index.name === "idx_watches_one_child")).toBe(true);
    db.close();
  });
});

describe("db migrations: automatic semantic memory provenance", () => {
  it("adds capture provenance and the idempotent event claim table", () => {
    const db = openDb(":memory:");
    const columns = db.prepare("PRAGMA table_info(memory_index_entries)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "capture_mode",
      "capture_reason",
      "thread_id",
      "parent_entry_id",
      "checkpoint_sequence",
      "checkpoint_kind",
      "checkpoint_reason",
    ]));
    const autoColumns = db.prepare("PRAGMA table_info(memory_index_auto_events)").all() as Array<{ name: string; pk: number }>;
    expect(autoColumns.find((column) => column.name === "assistant_message_id")?.pk).toBe(1);
    const indexes = db.prepare("PRAGMA index_list(memory_index_entries)").all() as Array<{ name: string; unique: number }>;
    expect(indexes).toContainEqual(expect.objectContaining({ name: "idx_memory_index_thread_sequence", unique: 1 }));
    db.close();
  });
});
