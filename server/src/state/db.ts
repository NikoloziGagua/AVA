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
