import "dotenv/config";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { appendDevLog, type DevLogEntry } from "../src/self/dev-log.js";

// Claude's note-writer for the Claude→Ava update log. Claude drops ONE entry as
// JSON into <tmp>/claude-note-entry.json, then runs this script to append it to
// <dataDir>/claude-updates.jsonl — which Ava reads back via read_claude_updates.
//
//   reads  <tmp>/claude-note-entry.json   { phase, title, detail?, commits? }
//   writes one stamped line to the dev log
//   prints the stamped entry

const cfg = loadConfig();
const ENTRY = join(tmpdir(), "claude-note-entry.json");

function main(): void {
  const entry = JSON.parse(readFileSync(ENTRY, "utf8")) as Omit<DevLogEntry, "ts">;
  const stamped = appendDevLog(cfg.dataDir, entry);
  console.log(JSON.stringify(stamped));
}

main();
