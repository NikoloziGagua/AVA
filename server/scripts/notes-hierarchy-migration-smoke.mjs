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
  const folders = new Map(migrated.prepare("SELECT id,parent_id FROM note_folders").all().map((row) => [row.id, row]));
  const assignments = migrated.prepare("SELECT id,folder_id,project_id,document_position,created_at FROM notes").all();
  let relationshipErrors = 0;
  for (const note of assignments) {
    let folder = folders.get(note.folder_id);
    const seen = new Set();
    while (folder?.parent_id && !seen.has(folder.id)) {
      seen.add(folder.id);
      folder = folders.get(folder.parent_id);
    }
    const expectedProject = folder?.id === "notes_general" ? null : folder?.id;
    if (!folder || note.project_id !== expectedProject) relationshipErrors += 1;
  }
  const orderingErrors = assignments
    .slice()
    .sort((a, b) => a.folder_id.localeCompare(b.folder_id) || a.created_at - b.created_at || a.id.localeCompare(b.id))
    .reduce((state, note) => {
      const expected = note.folder_id === state.folderId ? state.position + 1 : 0;
      return {
        folderId: note.folder_id,
        position: expected,
        errors: state.errors + (note.document_position === expected ? 0 : 1),
      };
    }, { folderId: null, position: -1, errors: 0 }).errors;
  const general = migrated.prepare("SELECT id,name,built_in FROM note_folders WHERE id='notes_general'").get();
  if (relationshipErrors || orderingErrors ||
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
