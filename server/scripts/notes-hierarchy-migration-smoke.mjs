import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../dist/state/db.js";

const repo = resolve(import.meta.dirname, "../..");
const sourcePath = join(repo, "server", "data", "state.db");
const scratch = mkdtempSync(join(tmpdir(), "ava-notes-hierarchy-"));
const copyPath = join(scratch, "state.db");
const stableColumns = [
  "id", "title", "content", "kind", "status", "collection", "tags", "pinned",
  "source", "source_session_id", "project_id", "section", "links", "change_log",
  "promoted_type", "promoted_id", "promoted_at", "version", "created_at", "updated_at",
];

function snapshot(db) {
  const rows = db.prepare(`SELECT ${stableColumns.join(",")} FROM notes ORDER BY id`).all();
  return {
    count: rows.length,
    hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

let source;
let migrated;
try {
  source = new Database(sourcePath, { readonly: true });
  const before = snapshot(source);
  await source.backup(copyPath);
  source.close();
  source = undefined;

  migrated = openDb(copyPath);
  const after = snapshot(migrated);
  if (before.count !== after.count || before.hash !== after.hash) {
    throw new Error(`authoritative note bytes changed: ${before.count}/${before.hash} -> ${after.count}/${after.hash}`);
  }
  const missingFolders = migrated.prepare(`SELECT COUNT(*) n FROM notes n
    LEFT JOIN note_folders f ON f.id=n.folder_id WHERE f.id IS NULL`).get().n;
  const generalMisassigned = migrated.prepare(`SELECT COUNT(*) n FROM notes
    WHERE project_id IS NULL AND folder_id!='notes_general'`).get().n;
  const projectMisassigned = migrated.prepare(`SELECT COUNT(*) n FROM notes
    WHERE project_id IS NOT NULL AND folder_id!=project_id`).get().n;
  const general = migrated.prepare("SELECT id,name,built_in FROM note_folders WHERE id='notes_general'").get();
  if (missingFolders || generalMisassigned || projectMisassigned ||
      !general || general.name !== "General" || general.built_in !== 1) {
    throw new Error("folder migration relationship verification failed");
  }
  const counts = {
    notes: after.count,
    projects: migrated.prepare("SELECT COUNT(*) n FROM note_projects").get().n,
    folders: migrated.prepare("SELECT COUNT(*) n FROM note_folders").get().n,
    studyDocuments: migrated.prepare("SELECT COUNT(*) n FROM notes WHERE document_type='study'").get().n,
  };
  console.log(JSON.stringify({ ok: true, authoritativeHash: after.hash, ...counts }));
} finally {
  try { source?.close(); } catch {}
  try { migrated?.close(); } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
