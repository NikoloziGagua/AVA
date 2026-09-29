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
