import type { Db } from "../state/db.js";
import type { MemoryArchive } from "./archive.js";

/**
 * Carries forgets made in the older memory index into the archive before any
 * backfill reads those conversations again: every message behind a forgotten
 * index entry is tombstoned (ids only, no content). Safe to run repeatedly.
 */
export function seedIndexTombstones(db: Db, archive: MemoryArchive): { entries: number; messages: number } {
  const ranges = db.prepare(`
    SELECT s.session_id, s.from_message_id, s.through_message_id
    FROM memory_index_entries e JOIN memory_index_sources s ON s.entry_id = e.id
    WHERE e.status = 'forgotten' AND s.session_id IS NOT NULL
      AND COALESCE(s.source_type, 'conversation_range') = 'conversation_range'
  `).all() as Array<{ session_id: string; from_message_id: number; through_message_id: number }>;
  let messages = 0;
  for (const range of ranges) {
    const ids = (db.prepare("SELECT id FROM messages WHERE session_id = ? AND id BETWEEN ? AND ? ORDER BY id")
      .all(range.session_id, range.from_message_id, range.through_message_id) as Array<{ id: number }>).map((row) => row.id);
    messages += archive.tombstoneMessages(ids, "forgotten_index_entry");
  }
  return { entries: ranges.length, messages };
}

const ARCHIVE_TABLES = [
  "memory_records",
  "memory_tombstones",
  "memory_tombstone_messages",
  "memory_record_events",
  "memory_extraction_state",
  "memory_extraction_runs",
] as const;

/**
 * Copies a reviewed archive (the backfill's dry-run copy) into `db`, so what
 * goes live is exactly what Niko reviewed. Refuses when `db` already holds
 * records or tombstones. Verifies row counts and the full-text index.
 */
export function importReviewedArchive(db: Db, fromPath: string): Record<(typeof ARCHIVE_TABLES)[number], number> {
  const count = (table: string, schema = "main") =>
    (db.prepare(`SELECT count(*) AS n FROM ${schema}.${table}`).get() as { n: number }).n;
  if (count("memory_records") || count("memory_tombstones")) {
    throw new Error("the archive here is not empty; refusing to overwrite it");
  }
  db.prepare("ATTACH DATABASE ? AS reviewed").run(fromPath);
  try {
    db.transaction(() => {
      for (const table of ARCHIVE_TABLES) {
        // Named columns keep this right even if the two schemas order them differently.
        const columns = (db.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{ name: string }>)
          .map((column) => column.name).join(", ");
        db.prepare(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM reviewed.${table}`).run();
      }
    })();
    const counts = {} as Record<(typeof ARCHIVE_TABLES)[number], number>;
    for (const table of ARCHIVE_TABLES) {
      counts[table] = count(table);
      if (counts[table] !== count(table, "reviewed")) throw new Error(`${table}: copied ${counts[table]} of ${count(table, "reviewed")} rows`);
    }
    // Throws if the search index disagrees with the records it was built from.
    db.prepare("INSERT INTO memory_records_fts(memory_records_fts) VALUES ('integrity-check')").run();
    return counts;
  } finally {
    db.prepare("DETACH DATABASE reviewed").run();
  }
}
