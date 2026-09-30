import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
    expect(names).toContain("memory_index_thread_state");
    expect(names).toContain("memory_index_governance_events");
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

  it("never infers internal token provenance from existing user-selected labels", () => {
    const legacy = new Database(TEST_DB);
    legacy.exec(`CREATE TABLE device_tokens (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
    );
    INSERT INTO device_tokens VALUES ('old-watch-label', 'old-hash', 'watch-internal', 12, 20, NULL);`);
    legacy.close();
    const migrated = openDb(TEST_DB);
    expect(migrated.prepare("SELECT * FROM device_tokens WHERE id = 'old-watch-label'").get()).toEqual({
      id: "old-watch-label", token_hash: "old-hash", label: "watch-internal",
      created_at: 12, last_seen_at: 20, revoked_at: null, session_actor: "human",
      // Filled in on the token's next successful bcrypt check, never guessed.
      token_lookup: null,
    });
    migrated.close();
  });

  it("migrates real pre-origin sessions without inferring human activity or changing history", () => {
    const legacy = new Database(TEST_DB);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active',
        summary TEXT, summary_through_message_id INTEGER, deleted_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO sessions VALUES ('pinned-old', 'Human sounding title', 10, 500, 'idle', 'summary', 1, NULL, 1);
      INSERT INTO sessions VALUES ('watch-old', 'Watch: scheduled check', 20, 900, 'archived', NULL, NULL, NULL, 0);
      INSERT INTO sessions VALUES ('deleted-old', 'Deleted', 30, 999, 'active', NULL, NULL, 1000, 1);
      INSERT INTO messages (session_id, role, content, created_at) VALUES ('pinned-old', 'user', 'keep this human-looking history', 11);
      INSERT INTO messages (session_id, role, content, created_at) VALUES ('watch-old', 'user', 'keep this automation-looking history', 21);
    `);
    const original = legacy.prepare("SELECT * FROM sessions ORDER BY id").all();
    legacy.close();
    const migrated = openDb(TEST_DB);
    const rows = migrated.prepare("SELECT * FROM sessions ORDER BY id").all() as Array<Record<string, unknown>>;
    expect(rows.map(({ origin, last_human_activity_at, ...oldFields }) => oldFields)).toEqual(original);
    expect(rows.every(row => row.origin === "unknown" && row.last_human_activity_at === null)).toBe(true);
    expect(migrated.prepare("SELECT content FROM messages ORDER BY id").all()).toEqual([
      { content: "keep this human-looking history" }, { content: "keep this automation-looking history" },
    ]);
    migrated.prepare("UPDATE sessions SET origin = 'human', last_human_activity_at = 1234 WHERE id = 'pinned-old'").run();
    migrated.close();
    const reopened = openDb(TEST_DB);
    expect(reopened.prepare("SELECT origin, last_human_activity_at, updated_at, pinned FROM sessions WHERE id = 'pinned-old'").get())
      .toEqual({ origin: "human", last_human_activity_at: 1234, updated_at: 500, pinned: 1 });
    reopened.close();
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

  it("rebuilds the old origin constraint losslessly, preserving rowids, dependants and schema objects", () => {
    const legacy = new Database(TEST_DB);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        origin TEXT NOT NULL DEFAULT 'unknown' CHECK (origin IN ('human', 'automation', 'unknown')),
        last_human_activity_at INTEGER, summary TEXT, summary_through_message_id INTEGER,
        deleted_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0, custom_value TEXT DEFAULT 'retained'
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
      );
      CREATE TABLE extra_child (session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, value TEXT);
      CREATE TABLE title_audit (session_id TEXT, title TEXT);
      CREATE INDEX custom_session_index ON sessions(title) WHERE deleted_at IS NULL;
      CREATE TRIGGER title_change AFTER UPDATE OF title ON sessions
        BEGIN INSERT INTO title_audit VALUES (new.id, new.title); END;
      CREATE VIEW session_view AS SELECT id, title FROM sessions;
      CREATE TRIGGER session_view_title INSTEAD OF UPDATE OF title ON session_view
        BEGIN UPDATE sessions SET title = new.title WHERE id = old.id; END;
      INSERT INTO sessions (rowid, id, title, created_at, updated_at, origin, last_human_activity_at,
        summary, summary_through_message_id, deleted_at, pinned, custom_value)
        VALUES (47, 'old-human', 'Original', 10, 900, 'human', 100, 'Kept summary', 9, NULL, 1, 'owner extension');
      INSERT INTO sessions (rowid, id, title, created_at, updated_at, origin, deleted_at)
        VALUES (92, 'old-audit', 'Unchanged audit', 20, 999, 'automation', 1000);
      INSERT INTO messages (id, session_id, role, content, created_at) VALUES (9, 'old-human', 'user', 'Retain exact text', 100);
      INSERT INTO extra_child VALUES ('old-human', 'keep');
    `);
    const rows = legacy.prepare("SELECT rowid, * FROM sessions ORDER BY rowid").all();
    const objects = legacy.prepare("SELECT name, sql FROM sqlite_schema WHERE name IN ('custom_session_index', 'title_change', 'session_view', 'session_view_title') ORDER BY name").all();
    legacy.close();
    const db = openDb(TEST_DB);
    try {
      expect(db.prepare("SELECT rowid, * FROM sessions ORDER BY rowid").all()).toEqual(rows);
      expect(db.prepare("SELECT name, sql FROM sqlite_schema WHERE name IN ('custom_session_index', 'title_change', 'session_view', 'session_view_title') ORDER BY name").all()).toEqual(objects);
      expect(db.prepare("SELECT id, session_id, content FROM messages").all()).toEqual([{ id: 9, session_id: "old-human", content: "Retain exact text" }]);
      expect(db.prepare("SELECT * FROM extra_child").all()).toEqual([{ session_id: "old-human", value: "keep" }]);
      expect(db.prepare("SELECT * FROM title_audit").all()).toEqual([]);
      db.prepare("UPDATE session_view SET title = 'After migration' WHERE id = 'old-human'").run();
      expect(db.prepare("SELECT * FROM title_audit").all()).toEqual([{ session_id: "old-human", title: "After migration" }]);
      db.prepare("INSERT INTO sessions (id, created_at, updated_at, origin) VALUES ('new-idea', 1, 1, 'assistant')").run();
      expect(() => db.prepare("UPDATE sessions SET origin = 'invented' WHERE id = 'new-idea'").run()).toThrow(/CHECK/);
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(db.pragma("legacy_alter_table", { simple: true })).toBe(0);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
    const reopened = openDb(TEST_DB);
    try {
      expect(reopened.prepare("SELECT origin FROM sessions WHERE id = 'new-idea'").get()).toEqual({ origin: "assistant" });
      expect(reopened.prepare("SELECT rowid FROM sessions WHERE id = 'old-human'").get()).toEqual({ rowid: 47 });
      expect(reopened.prepare("SELECT COUNT(*) n FROM title_audit").get()).toEqual({ n: 1 });
      expect(reopened.pragma("foreign_key_check")).toEqual([]);
    } finally { reopened.close(); }
  });

  it("fails a blocked rebuild clearly without deleting or changing existing session history", () => {
    const legacy = new Database(TEST_DB);
    legacy.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      origin TEXT NOT NULL DEFAULT 'unknown' CHECK (origin IN ('human', 'automation', 'unknown')),
      last_human_activity_at INTEGER, summary TEXT, summary_through_message_id INTEGER,
      deleted_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO sessions (id, title, created_at, updated_at) VALUES ('keep', 'Exact', 1, 2);
    CREATE TABLE sessions_origin_v2 (owner_data TEXT);
    INSERT INTO sessions_origin_v2 VALUES ('do not overwrite');`);
    const original = legacy.prepare("SELECT rowid, * FROM sessions").all();
    legacy.close();
    expect(() => openDb(TEST_DB)).toThrow(/sessions_origin_v2.*already exists/);
    const check = new Database(TEST_DB);
    try {
      expect(check.prepare("SELECT rowid, * FROM sessions").all()).toEqual(original);
      expect(check.prepare("SELECT * FROM sessions_origin_v2").all()).toEqual([{ owner_data: "do not overwrite" }]);
      expect(() => check.prepare("UPDATE sessions SET origin = 'assistant'").run()).toThrow(/CHECK/);
    } finally { check.close(); }
  });

  it("enforces unique publication references and bounded ledger fields without a transcript column", () => {
    const db = openDb(TEST_DB);
    try {
      const insert = db.prepare(`INSERT INTO initiatives
        (id, occurrence_key, scope_kind, state, created_at, disposition_updated_at)
        VALUES (?, ?, 'general', 'claimed', 100, 100)`);
      insert.run('ini_a', 'daily:2026-09-28');
      expect(() => insert.run('ini_b', 'daily:2026-09-28')).toThrow(/UNIQUE/);
      expect(() => db.prepare("UPDATE initiatives SET attempt_count = 3").run()).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE initiatives SET sources = ?").run(JSON.stringify(Array(9).fill({})))).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE initiatives SET title = ?").run('x'.repeat(81))).toThrow(/CHECK/);
      expect(() => db.prepare("UPDATE initiatives SET reason_now = ?").run('x'.repeat(301))).toThrow(/CHECK/);
      const columns = db.pragma("table_info(initiatives)") as Array<{ name: string }>;
      expect(columns.map(row => row.name)).not.toContain('content');
      expect(columns.map(row => row.name)).not.toContain('prompt');
    } finally { db.close(); }
  });

  it("serializes concurrent origin upgrades from independent connections", async () => {
    const legacy = new Database(TEST_DB);
    // AVA's existing databases already use WAL; do not conflate this upgrade
    // with simultaneous first-ever journal-mode changes on a foreign database.
    legacy.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      origin TEXT NOT NULL DEFAULT 'unknown' CHECK (origin IN ('human', 'automation', 'unknown')),
      last_human_activity_at INTEGER, summary TEXT, summary_through_message_id INTEGER,
      deleted_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0
    ); INSERT INTO sessions (rowid, id, title, created_at, updated_at) VALUES (51, 'keep', 'Exact', 1, 2);`);
    legacy.close();
    const workers: Worker[] = [];
    try {
      await Promise.all(Array.from({ length: 3 }, () => new Promise<void>((done, reject) => {
        const worker = new Worker(`
          const { workerData } = require('node:worker_threads');
          require('tsx/cjs');
          const { openDb } = require(workerData.module);
          const db = openDb(workerData.path);
          if (db.prepare("SELECT rowid FROM sessions WHERE id = 'keep'").get().rowid !== 51) throw Error('lost rowid');
          db.close();
        `, { eval: true, workerData: { path: resolve(TEST_DB), module: fileURLToPath(new URL('./db.ts', import.meta.url)) } });
        workers.push(worker);
        worker.once('error', reject);
        worker.once('exit', code => code === 0 ? done() : reject(new Error(`migration worker exited ${code}`)));
      })));
      const check = openDb(TEST_DB);
      try {
        expect(check.prepare("SELECT rowid, id, title, origin FROM sessions").all())
          .toEqual([{ rowid: 51, id: 'keep', title: 'Exact', origin: 'unknown' }]);
        expect(check.pragma('foreign_key_check')).toEqual([]);
      } finally { check.close(); }
    } finally { await Promise.all(workers.map(worker => worker.terminate())); }
  }, 20_000);

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
    const state = migrated.prepare("SELECT * FROM memory_index_thread_state WHERE thread_id = 'legacy-memory'").get() as {
      version: number;
      pinned: number;
      current_entry_id: string;
      conflict_status: string;
      conflict_with: string;
    };
    expect(state).toMatchObject({
      version: 1,
      pinned: 0,
      current_entry_id: "legacy-memory",
      conflict_status: "none",
      conflict_with: "[]",
    });
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
      "successor_status",
      "successor_result",
      "successor_attempted_at",
      "successor_session_id",
    ]));
    const indexes = db.prepare("PRAGMA index_list(watches)").all() as Array<{ name: string }>;
    expect(indexes.some((index) => index.name === "idx_watches_one_child")).toBe(true);
    db.close();
  });
});

describe("db migrations: completed Codex successor planning", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("moves a legacy planner error into successor state without erasing completion", () => {
    const first = openDb(TEST_DB);
    first.prepare(`
      INSERT INTO watches (
        id, prompt, interval_minutes, once, enabled, created_at, kind,
        continue_cycle, delivery_marker, delivered_at, completed_at,
        last_run_at, last_status, last_result
      ) VALUES ('legacy-cycle', 'done task', 1, 1, 1, 1, 'codex', 1,
        '[AVA-WATCH:legacy-cycle]', 2, 3, 4, 'error',
        'AVA could not select the next Codex task: provider quota exhausted')
    `).run();
    first.close();

    const migrated = openDb(TEST_DB);
    expect(migrated.prepare(`
      SELECT last_status, last_result, completed_at, successor_status,
             successor_result, successor_attempted_at
      FROM watches WHERE id = 'legacy-cycle'
    `).get()).toEqual({
      last_status: "completed",
      last_result: "pinned Codex task reached a completed task boundary",
      completed_at: 3,
      successor_status: "blocked",
      successor_result: "AVA could not select the next Codex task: provider quota exhausted",
      successor_attempted_at: 4,
    });
    migrated.close();
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

describe("db migrations: semantic memory governance", () => {
  it("creates the append-only event log and versioned thread projection", () => {
    const db = openDb(":memory:");
    const stateColumns = db.prepare("PRAGMA table_info(memory_index_thread_state)").all() as Array<{ name: string; pk: number }>;
    expect(stateColumns.find((column) => column.name === "thread_id")?.pk).toBe(1);
    expect(stateColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "version",
      "pinned",
      "current_entry_id",
      "superseded_by_thread_id",
      "conflict_status",
      "conflict_with",
      "updated_at",
    ]));
    const eventIndexes = db.prepare("PRAGMA index_list(memory_index_governance_events)").all() as Array<{ name: string; unique: number }>;
    expect(eventIndexes).toContainEqual(expect.objectContaining({ name: "sqlite_autoindex_memory_index_governance_events_2", unique: 1 }));
    expect(eventIndexes).toContainEqual(expect.objectContaining({ name: "idx_memory_index_governance_thread", unique: 0 }));
    db.close();
  });
});

describe("db schema: experimental UFO fixture boundary", () => {
  it("creates durable idempotency and versioned fixture state without host-control fields", () => {
    const db = openDb(":memory:");
    const requestColumns = db.prepare("PRAGMA table_info(ufo_experiment_requests)").all() as Array<{ name: string }>;
    expect(requestColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "request_key", "observability_run_id", "input_fingerprint", "status", "version", "max_steps",
    ]));
    expect(requestColumns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      "shell", "path", "url", "cookie", "screenshot", "provider_payload",
    ]));
    const indexes = db.prepare("PRAGMA index_list(ufo_experiment_requests)").all() as Array<{ name: string; unique: number }>;
    expect(indexes).toContainEqual(expect.objectContaining({ name: "sqlite_autoindex_ufo_experiment_requests_2", unique: 1 }));
    db.close();
  });
});
