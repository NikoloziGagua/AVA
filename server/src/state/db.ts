import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  tryAddColumn(db, "sessions", "summary", "TEXT");
  tryAddColumn(db, "sessions", "summary_through_message_id", "INTEGER");
  tryAddColumn(db, "sessions", "deleted_at", "INTEGER");
  tryAddColumn(db, "sessions", "pinned", "INTEGER NOT NULL DEFAULT 0");
  tryAddColumn(db, "messages", "metadata", "TEXT NOT NULL DEFAULT '{}'");
  // Semantic-memory Phase 2 provenance. Existing explicit entries remain
  // explicit; automatic capture is an additive, inspectable origin.
  tryAddColumn(db, "memory_index_entries", "capture_mode", "TEXT NOT NULL DEFAULT 'explicit'");
  tryAddColumn(db, "memory_index_entries", "capture_reason", "TEXT");
  // Semantic-memory Phase 3 immutable checkpoint lineage. Existing entries
  // become one-checkpoint threads; later material refinements append children.
  tryAddColumn(db, "memory_index_entries", "thread_id", "TEXT");
  tryAddColumn(db, "memory_index_entries", "parent_entry_id", "TEXT REFERENCES memory_index_entries(id) ON DELETE SET NULL");
  tryAddColumn(db, "memory_index_entries", "checkpoint_sequence", "INTEGER NOT NULL DEFAULT 1");
  tryAddColumn(db, "memory_index_entries", "checkpoint_kind", "TEXT NOT NULL DEFAULT 'initial'");
  tryAddColumn(db, "memory_index_entries", "checkpoint_reason", "TEXT");
  db.prepare("UPDATE memory_index_entries SET thread_id = id WHERE thread_id IS NULL").run();
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_index_thread_sequence
    ON memory_index_entries(thread_id, checkpoint_sequence) WHERE thread_id IS NOT NULL`);
  // Self worker selector: new intents record the selection visible at intake;
  // approval-gated intents lock the then-current selection when approved.
  tryAddColumn(db, "self_improvements", "worker_provider", "TEXT NOT NULL DEFAULT 'claude'");
  tryAddColumn(db, "self_improvements", "worker_selection_version", "INTEGER NOT NULL DEFAULT 1");
  tryAddColumn(db, "self_improvements", "cancellation_source", "TEXT");
  db.prepare(`
    INSERT OR IGNORE INTO self_worker_settings (scope_id, provider, version, updated_at)
    VALUES ('global', 'claude', 1, ?)
  `).run(Date.now());
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_deleted ON sessions(deleted_at)");
  // Watches v2: one-shot reminders (run_at), daily schedules (daily_at), and
  // the reminder kind (direct push at the due time — no agent run needed).
  tryAddColumn(db, "watches", "run_at", "INTEGER");
  tryAddColumn(db, "watches", "daily_at", "TEXT");
  tryAddColumn(db, "watches", "kind", "TEXT NOT NULL DEFAULT 'check'");
  // Watches v3: a watcher can pin one concrete Codex TUI thread, verify that
  // its instruction arrived, and optionally ask AVA to schedule a successor.
  tryAddColumn(db, "watches", "target_thread_id", "TEXT");
  tryAddColumn(db, "watches", "target_session_file", "TEXT");
  tryAddColumn(db, "watches", "target_cwd", "TEXT");
  tryAddColumn(db, "watches", "continue_cycle", "INTEGER NOT NULL DEFAULT 0");
  tryAddColumn(db, "watches", "parent_watch_id", "TEXT");
  tryAddColumn(db, "watches", "delivery_marker", "TEXT");
  tryAddColumn(db, "watches", "dispatch_offset", "INTEGER");
  tryAddColumn(db, "watches", "dispatch_turn_id", "TEXT");
  tryAddColumn(db, "watches", "dispatch_pid", "INTEGER");
  tryAddColumn(db, "watches", "delivered_at", "INTEGER");
  tryAddColumn(db, "watches", "completed_at", "INTEGER");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_watches_one_child
    ON watches(parent_watch_id) WHERE parent_watch_id IS NOT NULL`);
  // Mission Control v1 initially shipped the 30-day detailed boundary first.
  // Backfill the longer compact-outcome boundary for any database opened by an
  // intermediate build so retention remains deterministic across upgrades.
  tryAddColumn(db, "observability_runs", "compact_expires_at", "INTEGER");
  db.prepare(`
    UPDATE observability_runs
    SET compact_expires_at = started_at + ?
    WHERE compact_expires_at IS NULL
  `).run(365 * 24 * 60 * 60 * 1_000);
  // Strategy Room v2: link an immutable chat snapshot to one room and record
  // the single chat message that receives an approved conclusion. The partial
  // unique index makes repeated handoff requests for the same snapshot
  // idempotent without preventing a later turn from starting a new room.
  tryAddColumn(db, "strategy_rooms", "source_session_id", "TEXT");
  tryAddColumn(db, "strategy_rooms", "source_through_message_id", "INTEGER");
  tryAddColumn(db, "strategy_rooms", "returned_message_id", "INTEGER");
  tryAddColumn(db, "strategy_rooms", "returned_at", "INTEGER");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_rooms_source_snapshot
    ON strategy_rooms(source_session_id, source_through_message_id)
    WHERE source_session_id IS NOT NULL AND source_through_message_id IS NOT NULL`);
  // Notes v2: project spaces, template sections, rich links/change evidence and
  // promotion lineage. Older flat `collection` rows become explicit projects;
  // legacy inbox/active stages become the user-facing Ideas/Doing board.
  tryAddColumn(db, "notes", "project_id", "TEXT");
  tryAddColumn(db, "notes", "section", "TEXT NOT NULL DEFAULT 'capture'");
  tryAddColumn(db, "notes", "links", "TEXT NOT NULL DEFAULT '[]'");
  tryAddColumn(db, "notes", "change_log", "TEXT NOT NULL DEFAULT '[]'");
  tryAddColumn(db, "notes", "promoted_type", "TEXT");
  tryAddColumn(db, "notes", "promoted_id", "TEXT");
  tryAddColumn(db, "notes", "promoted_at", "INTEGER");
  db.exec(`
    INSERT OR IGNORE INTO note_projects (id, name, description, version, created_at, updated_at)
    SELECT 'project_' || lower(hex(randomblob(6))), collection, '', 1,
           MIN(created_at), MAX(updated_at)
    FROM notes
    WHERE collection IS NOT NULL AND trim(collection) != ''
      AND lower(trim(collection)) != 'general'
    GROUP BY collection COLLATE NOCASE;
    UPDATE notes SET project_id = NULL, collection = NULL
      WHERE lower(trim(collection)) = 'general';
    UPDATE notes
    SET project_id = (
      SELECT id FROM note_projects WHERE name = notes.collection COLLATE NOCASE LIMIT 1
    )
    WHERE project_id IS NULL AND collection IS NOT NULL AND trim(collection) != '';
    DELETE FROM note_projects WHERE lower(trim(name)) = 'general';
    UPDATE notes SET status = 'ideas' WHERE status = 'inbox';
    UPDATE notes SET status = 'doing' WHERE status = 'active';
    UPDATE notes SET section = 'priorities' WHERE pinned = 1 AND section = 'capture';
    UPDATE notes SET section = 'decisions' WHERE kind = 'decision' AND section = 'capture';
    UPDATE notes SET section = 'documentation'
      WHERE kind IN ('reference', 'documentation') AND section = 'capture';
    CREATE INDEX IF NOT EXISTS idx_notes_project_section
      ON notes(project_id, section, status, updated_at DESC);
  `);
  return db;
}

/** Open a fresh in-memory database. Intended for tests. */
export function openInMemoryDb(): Db {
  return openDb(":memory:");
}

function tryAddColumn(db: Db, table: string, column: string, ddl: string) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
