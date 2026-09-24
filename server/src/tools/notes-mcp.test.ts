import { beforeEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { getNote, listNoteFolders, listNoteProjects, listNotes } from "../state/notes.js";
import { buildNotesTools } from "./notes-mcp.js";

let db: Db;
beforeEach(() => { db = openInMemoryDb(); });

function tool(name: string, queueSelfImprove?: (goal: string) => string) {
  return buildNotesTools({ db, sessionId: "session-1", source: "ava_chat", queueSelfImprove })
    .find((entry) => entry.tool.name === name)!;
}

describe("Notes tools", () => {
  it("captures structured project notes when Sir asks AVA", async () => {
    const result = await tool("notes_capture").run({
      title: "Voice interruptions",
      content: "Stopping speech must invalidate every pending audio chunk.",
      project: "AVA Voice",
      kind: "requirement",
      section: "priorities",
      pinned: true,
      links: [{ label: "Design", url: "https://example.com/voice" }],
    }, { runId: "run-1" });
    expect(result.ok).toBe(true);
    expect(listNoteProjects(db)[0]).toMatchObject({ name: "AVA Voice", noteCount: 1 });
    expect(listNotes(db)[0]).toMatchObject({
      source: "ava_chat",
      sourceSessionId: "session-1",
      section: "priorities",
      pinned: true,
    });
  });

  it("reports what it saved so the reply can show a Saved card", async () => {
    const idea = await tool("notes_capture").run({ title: "Solar kiln", content: "Dry timber with sunlight.", kind: "idea" }, { runId: "run-1" });
    const ideaNote = listNotes(db).find((note) => note.kind === "idea")!;
    expect(idea.saved).toEqual({ kind: "idea", id: ideaNote.id, title: "Solar kiln" });

    const note = await tool("notes_capture").run({ title: "Groceries", content: "Milk and eggs." }, { runId: "run-2" });
    expect(note.saved).toMatchObject({ kind: "note", title: "Groceries" });

    const failed = await tool("notes_capture").run({ content: "  " }, { runId: "run-3" });
    expect(failed.ok).toBe(false);
    expect(failed.saved).toBeUndefined();

    const updated = await tool("notes_update").run({ id: ideaNote.id, expected_version: 1, stage: "doing" }, { runId: "run-4" });
    expect(updated.ok).toBe(true);
    expect(updated.saved).toBeUndefined();
  });

  it("searches, moves and protects versions", async () => {
    await tool("notes_capture").run({ content: "Build a weather briefing", kind: "idea" }, { runId: "run-1" });
    const note = listNotes(db)[0]!;
    const search = await tool("notes_search").run({ query: "weather" }, { runId: "run-2" });
    expect(search.text).toContain(note.id);
    const moved = await tool("notes_update").run({ id: note.id, expected_version: 1, stage: "doing" }, { runId: "run-3" });
    expect(moved.ok).toBe(true);
    expect(getNote(db, note.id)?.status).toBe("doing");
    const stale = await tool("notes_update").run({ id: note.id, expected_version: 1, content: "overwrite" }, { runId: "run-4" });
    expect(stale).toMatchObject({ ok: false });
    expect(stale.text).toContain("version 2");
  });

  it("creates nested folders, captures a study document and searches the subtree by path", async () => {
    const captured = await tool("notes_capture").run({
      folder_path: "University/Agile Development",
      title: "Lecture 1 — Scrum",
      document_type: "study",
      content: "## Key concepts\n\nScrum roles\n\n## Questions and weak areas\n\nVelocity",
    }, { runId: "run-study" });
    expect(captured.ok).toBe(true);
    const note = listNotes(db)[0]!;
    expect(note).toMatchObject({ documentType: "study" });
    expect(note.folderPath.map((part) => part.name)).toEqual(["University", "Agile Development"]);

    const search = await tool("notes_search").run({
      folder_path: "University",
      include_subfolders: true,
      query: "Velocity",
    }, { runId: "run-search" });
    expect(search.ok).toBe(true);
    expect(search.text).toContain(note.id);
    expect(search.text).toContain("University/Agile Development");
  });

  it("captures and reorders stable document pages through versioned tools", async () => {
    await tool("notes_capture").run({
      folder_path: "Ideas/Book",
      title: "Page two",
      content: "Second",
      document_position: 4,
    }, { runId: "page-capture" });
    const note = listNotes(db)[0]!;
    expect(note.documentPosition).toBe(4);

    const updated = await tool("notes_update").run({
      id: note.id,
      expected_version: note.version,
      document_position: 1,
    }, { runId: "page-reorder" });
    expect(updated.ok).toBe(true);
    expect(getNote(db, note.id)).toMatchObject({ documentPosition: 1, version: 2 });
  });

  it("organises folders with versions and refuses destructive or stale operations", async () => {
    const created = await tool("notes_folders").run({ action: "create", folder_path: "University/Systems" }, { runId: "folder-1" });
    expect(created.ok).toBe(true);
    const systems = listNoteFolders(db).find((folder) => folder.path === "University/Systems")!;

    const renamed = await tool("notes_folders").run({
      action: "rename",
      folder_id: systems.id,
      expected_version: systems.version,
      name: "Distributed Systems",
    }, { runId: "folder-2" });
    expect(renamed.ok).toBe(true);

    const stale = await tool("notes_folders").run({
      action: "rename",
      folder_id: systems.id,
      expected_version: systems.version,
      name: "Lost rename",
    }, { runId: "folder-3" });
    expect(stale).toMatchObject({ ok: false });
    expect(stale.text).toContain("version 2");

    const general = listNoteFolders(db).find((folder) => folder.id === "notes_general")!;
    const refused = await tool("notes_folders").run({
      action: "delete",
      folder_id: general.id,
      expected_version: general.version,
    }, { runId: "folder-4" });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.text).toContain("cannot be deleted");
  });

  it("promotes self-improvement only through the supplied approval-gated queue", async () => {
    const queue = vi.fn(() => "intent-22");
    await tool("notes_capture", queue).run({ title: "Improve retries", content: "Retry browser navigation safely." }, { runId: "run-1" });
    const note = listNotes(db)[0]!;
    const result = await tool("notes_promote", queue).run({
      id: note.id,
      expected_version: note.version,
      target: "self_improvement",
    }, { runId: "run-2" });
    expect(result).toMatchObject({ ok: true });
    expect(queue).toHaveBeenCalledWith(expect.stringContaining("Improve retries"));
    expect(getNote(db, note.id)?.promotion).toMatchObject({ id: "intent-22", type: "self_improvement" });
  });
});
