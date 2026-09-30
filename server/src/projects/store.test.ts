import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createNote, listNoteFolders } from "../state/notes.js";
import {
  addProjectItem, createProject, ensureProjectSession, findProject, listProjects, projectBrief, projectDetail, projectForSession,
  removeProject, removedProjects, restoreProject, updateProject, updateProjectItem, ProjectError,
} from "./store.js";

const T = Date.parse("2030-09-30T10:00:00Z");

describe("projects", () => {
  it("creates a project with its own Notes folder and a first log line, and refuses a duplicate name", () => {
    const db = openInMemoryDb();
    const tyre = createProject(db, { name: "Mobile tyre fitting", kind: "business", source: "voice" }, T);
    expect(tyre).toMatchObject({ name: "Mobile tyre fitting", kind: "business", status: "active", version: 1 });
    expect(listNoteFolders(db).find((folder) => folder.id === tyre.folderId)?.name).toBe("Mobile tyre fitting");
    expect(projectDetail(db, tyre.id)!.log.map((line) => line.text)).toEqual(["Project started."]);
    expect(() => createProject(db, { name: "mobile TYRE fitting", kind: "business", source: "app" })).toThrow(ProjectError);
    expect(() => createProject(db, { name: "  ", kind: "business", source: "app" })).toThrow(/needs a name/);
  });

  it("finds a project the way Niko says it", () => {
    const db = openInMemoryDb();
    createProject(db, { name: "Mobile tyre fitting", kind: "business", source: "app" }, T);
    createProject(db, { name: "Agile Development", kind: "uni", source: "app" }, T);
    expect(findProject(db, "the tire business")?.name).toBe("Mobile tyre fitting");
    expect(findProject(db, "agile")?.name).toBe("Agile Development");
    expect(findProject(db, "cooking")).toBeNull();
  });

  it("logs meaningful changes, refuses a stale edit, and ignores a no-op", () => {
    const db = openInMemoryDb();
    const tyre = createProject(db, { name: "Mobile tyre fitting", kind: "business", source: "app" }, T);
    const paused = updateProject(db, tyre.id, { status: "paused", stage: "Finding a van" }, { expectedVersion: 1, source: "voice" }, T + 1);
    expect(paused).toMatchObject({ status: "paused", stage: "Finding a van", version: 2 });
    expect(() => updateProject(db, tyre.id, { status: "done" }, { expectedVersion: 1, source: "app" })).toThrow(/changed since/);
    expect(updateProject(db, tyre.id, { status: "paused" }, { source: "app" }).version).toBe(2);
    expect(projectDetail(db, tyre.id)!.log.map((line) => line.text)).toEqual(["Stage: Finding a van.", "Paused.", "Project started."]);
  });

  it("removes a project at once, tidies its empty folder, keeps a folder with notes, and brings it back", () => {
    const db = openInMemoryDb();
    const empty = createProject(db, { name: "Scrap idea", kind: "business", source: "app" }, T);
    const full = createProject(db, { name: "Agile Development", kind: "uni", source: "app" }, T);
    createNote(db, { title: "Lecture 4", content: "Scrum roles", folderId: full.folderId! });
    removeProject(db, empty.id, T + 1);
    removeProject(db, full.id, T + 2);
    expect(listProjects(db)).toEqual([]);
    expect(removedProjects(db).map((project) => project.name)).toEqual(["Agile Development", "Scrap idea"]);
    expect(listNoteFolders(db).some((folder) => folder.name === "Scrap idea")).toBe(false);
    expect(listNoteFolders(db).some((folder) => folder.name === "Agile Development")).toBe(true);
    expect(() => removeProject(db, full.id)).toThrow(/already removed/);
    const back = restoreProject(db, findProject(db, "scrap", { removed: true })!.id, T + 3);
    expect(back.removedAt).toBeNull();
    expect(listNoteFolders(db).some((folder) => folder.id === back.folderId)).toBe(true);
    expect(() => updateProject(db, full.id, { stage: "x" }, { source: "app" })).toThrow(/removed/);
  });

  it("ticks steps off into the log, and gives AVA a short brief and a conversation of its own", () => {
    const db = openInMemoryDb();
    const tyre = createProject(db, { name: "Mobile tyre fitting", kind: "business", summary: "Choosing a van.", nextStep: "Shortlist 3 vans", source: "app" }, T);
    const step = addProjectItem(db, tyre.id, { kind: "step", text: "Get two supplier quotes", source: "chat" }, T + 1);
    addProjectItem(db, tyre.id, { kind: "question", text: "Generator or run off the van?", source: "chat" }, T + 2);
    updateProjectItem(db, step.id, { done: true }, { source: "voice" }, T + 3);
    const detail = projectDetail(db, tyre.id)!;
    expect(detail.steps[0]).toMatchObject({ text: "Get two supplier quotes", doneAt: T + 3 });
    expect(detail.log[0]!.text).toBe("Done: Get two supplier quotes");
    const brief = projectBrief(db, tyre);
    expect(brief).toContain("Where it stands: Choosing a van.");
    expect(brief).toContain("Open questions:\n- Generator or run off the van?");
    expect(brief).not.toContain("Open steps");
    const session = ensureProjectSession(db, tyre.id);
    expect(ensureProjectSession(db, tyre.id)).toBe(session);
    expect(projectForSession(db, session)?.id).toBe(tyre.id);
  });
});
