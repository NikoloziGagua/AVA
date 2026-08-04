import { beforeEach, describe, expect, it } from "vitest";
import { openInMemoryDb, type Db } from "./db.js";
import {
  createNote,
  deleteNote,
  getNote,
  inferNoteTitle,
  listNotes,
  normalizeNoteTags,
  updateNote,
} from "./notes.js";

let db: Db;

beforeEach(() => {
  db = openInMemoryDb();
});

describe("structured notes store", () => {
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
    expect(note.status).toBe("inbox");
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
      status: "active",
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
  });
});
