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
