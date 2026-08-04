import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, openInMemoryDb, type Db } from "./db.js";
import {
  createNote,
  deleteNote,
  getNote,
  inferNoteTitle,
  listNotes,
  normalizeNoteTags,
  normalizeNoteLinks,
  ensureNoteProject,
  listNoteProjects,
  promoteNote,
  updateNote,
} from "./notes.js";

let db: Db;
const tempDirs: string[] = [];

beforeEach(() => {
  db = openInMemoryDb();
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("structured notes store", () => {
  it("boots and migrates a legacy Notes table before creating project indexes", () => {
    db.close();
    const dir = mkdtempSync(join(tmpdir(), "ava-notes-migration-"));
    tempDirs.push(dir);
    const path = join(dir, "state.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'general', status TEXT NOT NULL DEFAULT 'inbox',
        collection TEXT, tags TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual', source_session_id TEXT,
        version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO notes (id, title, content, kind, status, collection, tags, pinned, source, version, created_at, updated_at)
      VALUES ('legacy-1', 'Old idea', 'Migrate me', 'idea', 'inbox', 'AVA', '[]', 0, 'manual', 1, 1000, 1000);
    `);
    legacy.close();

    db = openDb(path);
    const migrated = getNote(db, "legacy-1");
    expect(migrated).toMatchObject({ status: "ideas", collection: "AVA", section: "capture" });
    expect(migrated?.projectId).toMatch(/^project_/);
    const indexes = db.prepare("PRAGMA index_list(notes)").all() as Array<{ name: string }>;
    expect(indexes.some((entry) => entry.name === "idx_notes_project_section")).toBe(true);
  });

  it("creates a structured note and derives a useful title", () => {
    const note = createNote(db, {
      content: "# Build a daily briefing\nInclude weather and AVA health.",
      kind: "idea",
      collection: "AVA ideas",
      tags: ["Automation", " automation ", "Morning"],
      source: "ava_chat",
      sourceSessionId: "session-1",
    });

    expect(note.title).toBe("Build a daily briefing");
    expect(note.kind).toBe("idea");
    expect(note.status).toBe("ideas");
    expect(note.tags).toEqual(["Automation", "Morning"]);
    expect(note.sourceSessionId).toBe("session-1");
    expect(getNote(db, note.id)).toEqual(note);
  });

  it("lists pinned notes first and supports real filters", () => {
    const reference = createNote(db, { content: "OpenAI model guide", kind: "reference" });
    const idea = createNote(db, {
      content: "Create a voice briefing",
      title: "Voice briefing",
      kind: "idea",
      collection: "AVA ideas",
      tags: ["voice"],
      pinned: true,
    });
    const archived = createNote(db, { content: "Old thought", status: "archived" });

    expect(listNotes(db).map((note) => note.id)).toEqual([idea.id, reference.id]);
    expect(listNotes(db, { q: "voice" }).map((note) => note.id)).toEqual([idea.id]);
    expect(listNotes(db, { kind: "reference" }).map((note) => note.id)).toEqual([reference.id]);
    expect(listNotes(db, { collection: "ava IDEAS" }).map((note) => note.id)).toEqual([idea.id]);
    expect(listNotes(db, { includeArchived: true }).map((note) => note.id)).toContain(archived.id);
  });

  it("uses optimistic versions so stale editors cannot overwrite newer work", () => {
    const note = createNote(db, { content: "Original", kind: "thought" });
    const first = updateNote(db, note.id, note.version, {
      content: "Updated once",
      status: "doing",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected update");
    expect(first.note.version).toBe(2);

    const stale = updateNote(db, note.id, note.version, { content: "Stale overwrite" });
    expect(stale).toMatchObject({ ok: false, reason: "version_conflict" });
    expect(getNote(db, note.id)?.content).toBe("Updated once");
  });

  it("guards deletion with the same version boundary", () => {
    const note = createNote(db, { content: "Delete me" });
    const updated = updateNote(db, note.id, note.version, { pinned: true });
    if (!updated.ok) throw new Error("expected update");
    expect(deleteNote(db, note.id, note.version)).toMatchObject({
      ok: false,
      reason: "version_conflict",
    });
    expect(deleteNote(db, note.id, updated.note.version).ok).toBe(true);
    expect(getNote(db, note.id)).toBeNull();
  });

  it("normalizes titles and tags within bounded fields", () => {
    expect(inferNoteTitle("- A short list item\nmore")).toBe("A short list item");
    expect(inferNoteTitle(" ")).toBe("Untitled note");
    expect(normalizeNoteTags(["#One", "one", "Two", ""])).toEqual(["One", "Two"]);
    expect(normalizeNoteLinks([
      { label: "Docs", url: "https://example.com/guide" },
      { label: "unsafe", url: "javascript:alert(1)" },
      { label: "duplicate", url: "https://example.com/guide" },
    ])).toEqual([{ label: "Docs", url: "https://example.com/guide" }]);
  });

  it("scrubs secrets at the Notes persistence boundary and drops credential-bearing links", () => {
    const secret = `sk-${"A".repeat(32)}`;
    const note = createNote(db, {
      title: `Deployment ${secret}`,
      content: `Use token: ${secret} only in the secret manager.`,
      tags: [`key-${secret}`],
      links: [{ label: "private", url: `https://example.com/?token=${secret}` }],
    });

    expect(note.title).not.toContain(secret);
    expect(note.content).not.toContain(secret);
    expect(note.tags.join(" ")).not.toContain(secret);
    expect(note.links).toEqual([]);
    expect(JSON.stringify(getNote(db, note.id))).not.toContain(secret);
  });

  it("creates first-class project spaces and applies the project template", () => {
    const { project, created } = ensureNoteProject(db, "AVA Explorer", "Capability visibility work");
    expect(created).toBe(true);
    expect(ensureNoteProject(db, "ava explorer").project.id).toBe(project.id);

    const priority = createNote(db, {
      content: "Make failures visible",
      kind: "requirement",
      projectId: project.id,
      section: "priorities",
      pinned: true,
    });
    const decision = createNote(db, {
      content: "Use structured events because prose cannot power reliable replay.",
      kind: "decision",
      projectId: project.id,
    });

    expect(priority).toMatchObject({ projectId: project.id, section: "priorities", pinned: true });
    expect(decision).toMatchObject({ projectId: project.id, section: "decisions" });
    expect(listNoteProjects(db)[0]).toMatchObject({ id: project.id, noteCount: 2 });
    expect(listNotes(db, { projectId: project.id })).toHaveLength(2);
    expect(listNotes(db, { projectId: null })).toHaveLength(0);
  });

  it("records moves, rich-link edits and promotion lineage", () => {
    const note = createNote(db, {
      content: "Turn the daily briefing idea into a real workflow",
      kind: "idea",
      links: [{ label: "Weather API", url: "https://weather.example/docs" }],
    });
    const moved = updateNote(db, note.id, note.version, {
      status: "review",
      links: [...note.links, { label: "Design", url: "https://example.com/design" }],
    });
    if (!moved.ok) throw new Error("expected move");
    expect(moved.note.status).toBe("review");
    expect(moved.note.changeLog.at(-1)?.action).toBe("moved");

    const promoted = promoteNote(db, note.id, moved.note.version, "task", "task_draft_1");
    if (!promoted.ok) throw new Error("expected promotion");
    expect(promoted.note.promotion).toMatchObject({ type: "task", id: "task_draft_1" });
    expect(promoted.note.changeLog.at(-1)?.action).toBe("promoted");
  });
});
