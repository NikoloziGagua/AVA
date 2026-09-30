// Moves a reviewed memory archive from the backfill's dry-run copy into the
// live database, so what goes live is exactly what Niko reviewed. Refuses if
// the live archive already has records. Safe while AVA runs with memory v2
// off: the running server never writes these tables then.
//
//   npx tsx scripts/memory-import.ts [--from ../data/scratch/memory-backfill.db] [--to <db>]
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/state/db.js";
import { importReviewedArchive } from "../src/memory-archive/migrate.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

try {
  const from = resolve(arg("from") ?? join(repo, "data/scratch/memory-backfill.db"));
  if (!existsSync(from)) throw new Error(`no reviewed archive at ${from}`);
  // openDb applies the schema, so the target gains the archive tables first.
  const db = openDb(resolve(arg("to") ?? join(repo, "server/data/state.db")));
  db.pragma("busy_timeout = 15000");
  try {
    console.log(importReviewedArchive(db, from));
    console.log("imported; set AVA_MEMORY_V2=on and restart AVA to use it");
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
