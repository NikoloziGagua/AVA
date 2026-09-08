import { beforeEach, describe, expect, it, vi } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { getNote, listNoteProjects, listNotes } from "../state/notes.js";
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
