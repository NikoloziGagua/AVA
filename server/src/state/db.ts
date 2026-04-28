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
  return db;
}

/** Open a fresh in-memory database pre-seeded with an allow-all policy rule.
 *  Intended for use in tests only. Foreign-key enforcement is disabled so
 *  tests can pass arbitrary sessionIds without seeding the sessions table. */
export function openInMemoryDb(): Db {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = OFF");
  // Seed an allow-all rule so policy doesn't block or ask for approval in tests.
  const now = Date.now();
  db.prepare(
    "INSERT INTO rules (id, source, parsed, enabled, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "test-allow-all",
    "allow all tools",
    JSON.stringify({ match: {}, action: "allow" }),
    1,
    "active",
    now,
    now,
  );
  return db;
}

function tryAddColumn(db: Db, table: string, column: string, ddl: string) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
