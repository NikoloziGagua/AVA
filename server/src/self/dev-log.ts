import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// Claude→Ava update log. Claude (Sir's coding agent) appends one note per change
// to his own work on Ava; Ava reads them back via the read_claude_updates tool so
// she can tell Sir what's happening — with honest attribution (Claude's actions
// are Claude's, her requests are her own). Stored as JSON-lines so each note is an
// independent, append-only record that survives malformed neighbours.

export type DevLogPhase = "started" | "shipped" | "note";
export type DevLogEntry = {
  ts: string;
  phase: DevLogPhase;
  title: string;
  detail?: string;
  commits?: string[];
};

const file = (dataDir: string) => join(dataDir, "claude-updates.jsonl");

/** Stamp `ts`, append the JSON line (creating the file if absent), return it. */
export function appendDevLog(dataDir: string, entry: Omit<DevLogEntry, "ts">): DevLogEntry {
  const stamped: DevLogEntry = { ts: new Date().toISOString(), ...entry };
  appendFileSync(file(dataDir), JSON.stringify(stamped) + "\n", "utf8");
  return stamped;
}

/** The last `limit` entries, oldest→newest. Blank/malformed lines are skipped;
 *  a missing file yields []. */
export function readDevLog(dataDir: string, limit = 10): DevLogEntry[] {
  const p = file(dataDir);
  if (!existsSync(p)) return [];
  const entries: DevLogEntry[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as DevLogEntry);
    } catch {
      // Tolerate a partially-written or hand-edited line — skip it.
    }
  }
  return entries.slice(-limit);
}

/** The most recent "started" entry with no later "shipped" ⇒ an update is in
 *  flight; else null. "note" entries are ignored. */
export function currentInProgress(dataDir: string): DevLogEntry | null {
  // Read all entries (large limit) so we never miss an early "started".
  const entries = readDevLog(dataDir, Number.MAX_SAFE_INTEGER);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.phase === "shipped") return null;
    if (e.phase === "started") return e;
  }
  return null;
}
