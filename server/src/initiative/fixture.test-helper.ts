import { vi } from "vitest";
import { openDb, type Db } from "../state/db.js";
import { createNote, createNoteFolder } from "../state/notes.js";
import { updateInitiativeSettings } from "./settings.js";
import { InitiativeEngine } from "./engine.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import type { InitiativeRow } from "./store.js";
export const NOW = Date.parse("2026-09-28T10:00:00Z");
export const REPLY = JSON.stringify({ decision: "idea", title: "Compare the launch options",
  reason_now: "Your saved launch note includes two approaches.", message: "Niko, your note compares a small pilot with a wider launch.",
  next_step: "Shall we compare the trade-offs?", citations: ["S1"] });
export function initiativeFixture(existing?: Db) {
  const db = existing ?? openDb(":memory:");
  let now = NOW;
  const folder = createNoteFolder(db, { name: "Fixture project" });
  const note = createNote(db, { folderId: folder.id, title: "Launch choices", content: "Compare a small pilot with a wider launch. Costs and time remain open." });
  db.prepare("UPDATE notes SET created_at=?,updated_at=? WHERE id=?").run(now, now, note.id);
  updateInitiativeSettings(db, { version: 1, enabled: true, activeProjectFolderIds: [folder.id] });
  const complete = vi.fn(async (_request: Parameters<LLMProvider["complete"]>[0]) => REPLY);
  const report = vi.fn();
  const deps = { db, provider: { defaultSideModel: "fixture", complete }, now: () => now, report };
  return { db, folder, note, complete, report, deps, engine: new InitiativeEngine(deps), setNow: (n: number) => { now = n; },
    rows: () => db.prepare("SELECT * FROM initiatives ORDER BY created_at,id").all() as InitiativeRow[] };
}
