import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryIndexResult, MemoryIndexSearchResponse } from "../api.js";
import * as appApi from "../api.js";
import type { Note, NoteFolder, NotesSnapshot, NotesTree } from "./api.js";
import { NotesScreen } from "./NotesScreen.js";
import * as notesApi from "./api.js";
import { STUDY_TEMPLATE } from "./folders.js";

vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("../components/ava/BorderGlow.js", () => ({
  BorderGlow: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));
vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return { ...actual, fetchMemoryIndex: vi.fn() };
});
vi.mock("./api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api.js")>();
  return {
    ...actual,
    fetchNotes: vi.fn(),
    fetchNotesTree: vi.fn(),
    createNote: vi.fn(),
    createNoteFolder: vi.fn(),
    updateNoteFolder: vi.fn(),
    deleteNoteFolder: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    promoteNote: vi.fn(),
  };
});

const T0 = 1_785_800_000_000;

function folder(overrides: Partial<NoteFolder> & { id: string; name: string }): NoteFolder {
  return {
    parentId: null,
    description: "",
    position: 0,
    builtIn: false,
    version: 1,
    documentCount: 0,
    breadcrumb: [{ id: overrides.id, name: overrides.name }],
    path: overrides.name,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const general = folder({ id: "notes_general", name: "General", builtIn: true, documentCount: 2 });
const explorer = folder({ id: "project-1", name: "AVA Explorer", description: "Capability and workflow visibility", position: 1, documentCount: 1 });
const university = folder({ id: "folder-uni", name: "University", position: 2 });
const agile = folder({
  id: "folder-agile", name: "Agile Development", parentId: "folder-uni",
  breadcrumb: [{ id: "folder-uni", name: "University" }, { id: "folder-agile", name: "Agile Development" }],
  path: "University/Agile Development",
});

const note: Note = {
  id: "note-1",
  title: "Explain watcher failures",
  content: "Show the last verified stage and exact observation boundary.",
  kind: "requirement",
  status: "ideas",
  collection: "AVA Explorer",
  projectId: "project-1",
  folderId: "project-1",
  folderPath: [{ id: "project-1", name: "AVA Explorer" }],
  documentType: "general",
  documentPosition: 0,
  section: "priorities",
  tags: ["visibility"],
  links: [{ label: "Contract", url: "https://example.com/contract" }],
  changeLog: [{ id: "change-1", at: T0, action: "created", detail: "Captured in AVA Explorer" }],
  pinned: true,
  source: "ava_chat",
  sourceSessionId: "session-1",
  promotion: null,
  version: 1,
  createdAt: T0,
  updatedAt: T0,
};

function generalPage(id: string, title: string, position: number, content = `Body of ${title}`): Note {
  return {
    ...note, id, title, content, projectId: null, collection: null, folderId: "notes_general",
    folderPath: [{ id: "notes_general", name: "General" }], documentPosition: position, pinned: false, section: "capture",
  };
}

// Stored position decides file order. Page boundaries are derived only from
// the selected file's Markdown and never from neighboring Note records.
const fileTwo = generalPage("file-2", "Alpha second file", 1);
const fileOne = generalPage(
  "file-1",
  "Zulu first file",
  0,
  `## Heading one\n\n${"This is a detailed explanation inside the same file. ".repeat(20)}\n\n## Heading two\n\nA concluding section in the same file.`,
);

const snapshot: NotesSnapshot = {
  projects: [{
    id: "project-1",
    name: "AVA Explorer",
    description: "Capability and workflow visibility",
    version: 1,
    noteCount: 1,
    createdAt: T0,
    updatedAt: T0,
  }],
  notes: [fileTwo, note, fileOne],
};

const tree: NotesTree = {
  folders: [agile, explorer, general, university],
  snapshot: { fetchedAt: T0, version: "v", complete: true, totalDocuments: 3 },
  migration: { legacyProjectCount: 1, legacyRootFolderIds: ["project-1"] },
};

function indexedMemory(overrides: Partial<MemoryIndexResult> = {}): MemoryIndexResult {
  const entry: MemoryIndexResult["entry"] = {
      id: "memory-1",
      version: 1,
      kind: "idea",
      title: "Evidence-first Explorer",
      summary: "Explorer should make the last verified stage visible without overwhelming newcomers.",
      conclusions: ["Use progressive disclosure."],
      openQuestions: ["Which workflows need the deepest evidence?"],
      nextSteps: ["Test the entrance with a newcomer."],
      tags: ["explorer", "visibility"],
      project: "AVA Explorer",
      privacyLevel: "project",
      captureMode: "explicit",
      captureReason: null,
      threadId: "thread-1",
      parentEntryId: null,
      checkpointSequence: 1,
      checkpointKind: "initial",
      checkpointReason: null,
      embeddingStatus: "ready",
      createdAt: T0,
      updatedAt: T0,
  };
  const result: MemoryIndexResult = {
    entry,
    originalEntry: entry,
    source: {
      type: "conversation_range",
      label: "AVA conversation messages 10-14",
      sessionId: "source-session",
      fromMessageId: 10,
      throughMessageId: 14,
      messageCount: 5,
      reference: null,
      commitSha: null,
      status: "verified",
      verifiedAt: T0,
      reason: "Source messages still match.",
    },
    match: { mode: "recent", reason: "Recently captured.", semanticScore: null, lexicalScore: 0, sharedTerms: [] },
    lineage: { threadId: "thread-1", parentEntryId: null, sequence: 1, kind: "initial", reason: null, totalCheckpoints: 1, isLatest: true },
    governance: { threadVersion: 1, pinned: false, state: "current", retrievalEligible: true, corrected: false, correctionEventId: null, correctionReason: null, supersededByThreadId: null, conflictWithThreadIds: [], updatedAt: T0, events: [] },
    usable: true,
    ...overrides,
  };
  if (overrides.entry && !overrides.originalEntry) result.originalEntry = overrides.entry;
  return result;
}

const memory = indexedMemory();

const memoryResponse: MemoryIndexSearchResponse = {
  query: "",
  project: "AVA Explorer",
  mode: "recent",
  semanticAvailable: true,
  notice: null,
  suppressedByGovernance: 0,
  results: [memory],
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(notesApi.fetchNotes).mockResolvedValue(snapshot);
  vi.mocked(notesApi.fetchNotesTree).mockResolvedValue(tree);
  vi.mocked(notesApi.createNote).mockResolvedValue(generalPage("note-new", "New file", 2));
  vi.mocked(notesApi.createNoteFolder).mockResolvedValue(folder({ id: "folder-new", name: "Lectures", parentId: "notes_general" }));
  vi.mocked(notesApi.updateNote).mockResolvedValue({ ...note, version: 2 });
  vi.mocked(notesApi.promoteNote).mockResolvedValue({
    note: { ...note, version: 2, promotion: { type: "task", id: "task-1", at: Date.now() } },
    promotionId: "task-1",
    prompt: "Turn this AVA Note into a completed task.",
  });
  vi.mocked(appApi.fetchMemoryIndex).mockResolvedValue(memoryResponse);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const counter = () => screen.getByTestId("page-counter").textContent;
const fileHeading = () => within(screen.getByRole("region", { name: "Note document" })).getByRole("heading", { level: 2 }).textContent;

// jsdom has no PointerEvent; a MouseEvent carries the coordinates React reads.
const swipe = (target: Element, type: string, clientX: number, clientY: number) =>
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX, clientY }));

async function openFolder(name: RegExp) {
  const nav = await screen.findByRole("navigation", { name: "Folders" });
  fireEvent.click(within(nav).getByRole("button", { name }));
}

describe("Notes files and derived pages", () => {
  it("shows multiple files and turns pages only inside the selected file", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    expect(await screen.findByText("PAGE 1 / 2")).not.toBeNull();
    expect(fileHeading()).toBe("Zulu first file");
    const files = screen.getByRole("navigation", { name: "Files in General" });
    expect(within(files).getByRole("button", { name: "Zulu first file" }).getAttribute("aria-current")).toBe("page");
    expect(within(files).getByRole("button", { name: "Alpha second file" })).not.toBeNull();
    expect(within(files).getByText(/Heading one This is a detailed explanation/).textContent?.length).toBeLessThanOrEqual(143);
    expect(screen.getByRole("heading", { name: "Heading one" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(counter()).toBe("PAGE 2 / 2");
    expect(fileHeading()).toBe("Zulu first file");
    expect(screen.getByRole("heading", { name: "Heading two" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(files).getByRole("button", { name: /Alpha second file/ }));
    expect(counter()).toBe("PAGE 1 / 1");
    expect(fileHeading()).toBe("Alpha second file");
  });

  it("turns pages with the arrow keys, but not while typing", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("PAGE 2 / 2");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("PAGE 1 / 2");
    const capture = screen.getByPlaceholderText(/Drop the thought here/i);
    fireEvent.keyDown(capture, { key: "ArrowRight" });
    expect(counter()).toBe("PAGE 1 / 2");
  });

  it("turns pages with a horizontal swipe and ignores a vertical scroll", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    const article = screen.getByRole("article", { name: "Zulu first file, page 1" });
    swipe(article, "pointerdown", 300, 100);
    swipe(article, "pointerup", 290, 400);
    expect(counter()).toBe("PAGE 1 / 2");
    swipe(article, "pointerdown", 300, 100);
    swipe(article, "pointerup", 120, 110);
    expect(counter()).toBe("PAGE 2 / 2");
  });

  it("jumps with the page dots and the numbered contents list", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Page 2: Heading two" }));
    expect(counter()).toBe("PAGE 2 / 2");
    fireEvent.click(screen.getByRole("button", { name: /Contents/ }));
    const contents = screen.getByRole("navigation", { name: "Document contents" });
    fireEvent.click(within(contents).getByRole("button", { name: /Heading one/ }));
    expect(counter()).toBe("PAGE 1 / 2");
  });

  it("offers a continuous accessible document without changing the saved file", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Show as one page" }));
    expect(counter()).toBe("FULL DOCUMENT");
    expect(screen.getByRole("heading", { name: "Heading one" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Heading two" })).not.toBeNull();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show pages" }));
    expect(counter()).toBe("PAGE 1 / 2");
  });

  it("restores the selected file's reading position after reload", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(counter()).toBe("PAGE 2 / 2");
    expect(window.localStorage.getItem("ava:notes-reading-position:file-1")).toBe("block-2-0");
    cleanup();

    render(<NotesScreen onStartTask={vi.fn()} />);
    expect(await screen.findByText("PAGE 2 / 2")).not.toBeNull();
    expect(fileHeading()).toBe("Zulu first file");
  });

  it("nests folders and shows a folder's own files", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    const nav = await screen.findByRole("navigation", { name: "Folders" });
    expect(within(nav).getByRole("button", { name: /Agile Development/ })).not.toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Collapse University" }));
    expect(within(nav).queryByRole("button", { name: /Agile Development/ })).toBeNull();
    await openFolder(/AVA Explorer/);
    expect(counter()).toBe("PAGE 1 / 1");
    expect(fileHeading()).toBe("Explain watcher failures");
    await openFolder(/^University/);
    expect(screen.getByText("No files in University yet.")).not.toBeNull();
  });

  it("offers the same folders as one menu on a phone", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.change(screen.getByRole("combobox", { name: "Folder" }), { target: { value: "project-1" } });
    expect(fileHeading()).toBe("Explain watcher failures");
  });

  it("captures a quick thought into the selected folder", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    const input = await screen.findByPlaceholderText(/Drop the thought here/i);
    fireEvent.change(input, { target: { value: "Make AVA status easier to scan" } });
    fireEvent.click(screen.getByRole("button", { name: /^Capture$/i }));
    await waitFor(() => expect(notesApi.createNote).toHaveBeenCalledWith(expect.objectContaining({
      content: "Make AVA status easier to scan",
      folderId: "notes_general",
      section: "capture",
      kind: "idea",
    })));
  });

  it("starts a study file from the template headings", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /Study file/ }));
    expect(await screen.findByText("New study file")).not.toBeNull();
    const body = screen.getByPlaceholderText(/Write the file/) as HTMLTextAreaElement;
    expect(body.value).toBe(STUDY_TEMPLATE);
    for (const heading of ["Key concepts", "Explanations", "Questions and weak areas", "Examples", "Conclusions", "Sources"]) {
      expect(body.value).toContain(`## ${heading}`);
    }
    fireEvent.change(screen.getByPlaceholderText(/Lecture 4/), { target: { value: "Lecture 1" } });
    fireEvent.click(screen.getByRole("button", { name: /Save file/ }));
    await waitFor(() => expect(notesApi.createNote).toHaveBeenCalledWith(expect.objectContaining({
      title: "Lecture 1",
      documentType: "study",
      folderId: "notes_general",
    })));
  });

  it("moves a file to another folder with a versioned update", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /^Move file$/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Destination folder" }), { target: { value: "folder-agile" } });
    await waitFor(() => expect(notesApi.updateNote).toHaveBeenCalledWith("file-1", 1, { folderId: "folder-agile" }));
    expect(await screen.findByText(/Moved “Zulu first file” to University\/Agile Development/)).not.toBeNull();
  });

  it("edits a file without sending an unchanged folder or type", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /^Edit file$/ }));
    fireEvent.change(await screen.findByDisplayValue("Zulu first file"), { target: { value: "Renamed file" } });
    fireEvent.click(screen.getByRole("button", { name: /Save file/ }));
    await waitFor(() => expect(notesApi.updateNote).toHaveBeenCalled());
    const patch = vi.mocked(notesApi.updateNote).mock.calls[0]![2];
    expect(patch).toMatchObject({ title: "Renamed file" });
    expect(patch).not.toHaveProperty("folderId");
    expect(patch).not.toHaveProperty("documentType");
  });

  it("repaginates an edited file once and falls back to the nearest valid anchor", async () => {
    const shortened = { ...fileOne, content: "## Short version\n\nDone.", version: 2 };
    vi.mocked(notesApi.fetchNotes)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValue({ ...snapshot, notes: [fileTwo, note, shortened] });
    vi.mocked(notesApi.updateNote).mockResolvedValue(shortened);

    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: /^Edit file$/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Write the file/), { target: { value: shortened.content } });
    fireEvent.click(screen.getByRole("button", { name: /Save file/ }));

    expect(await screen.findByText("PAGE 1 / 1")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Short version" })).not.toBeNull();
    expect(notesApi.updateNote).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("ava:notes-reading-position:file-1")).toBe("block-0-0");
  });

  it("asks AVA about the open file in a new chat", async () => {
    const onStartTask = vi.fn();
    render(<NotesScreen onStartTask={onStartTask} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.click(screen.getByRole("button", { name: /Ask AVA about this file/ }));
    expect(onStartTask).toHaveBeenCalledWith(expect.stringContaining("“Zulu first file” (stable ID: file-1; folder: General)"));
  });

  it("searches every folder and opens the chosen file", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    fireEvent.change(screen.getByPlaceholderText("Search all files"), { target: { value: "watcher" } });
    const results = screen.getByRole("region", { name: "Search results" });
    fireEvent.click(within(results).getByRole("button", { name: /Explain watcher failures/ }));
    expect(fileHeading()).toBe("Explain watcher failures");
  });
});

describe("Notes folders", () => {
  it("creates a folder inside the selected one", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    const nav = await screen.findByRole("navigation", { name: "Folders" });
    fireEvent.click(within(nav).getByRole("button", { name: "New folder" }));
    expect(await screen.findByText("It will sit inside General.")).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText("e.g. Agile Development"), { target: { value: "Lectures" } });
    fireEvent.click(screen.getByRole("button", { name: /Create folder/ }));
    await waitFor(() => expect(notesApi.createNoteFolder).toHaveBeenCalledWith({ parentId: "notes_general", name: "Lectures" }));
  });

  it("rejects a slash in a folder name before sending it", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    const nav = await screen.findByRole("navigation", { name: "Folders" });
    fireEvent.click(within(nav).getByRole("button", { name: "New folder" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Agile Development"), { target: { value: "Uni/Agile" } });
    expect((screen.getByRole("button", { name: /Create folder/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("only lets an empty, non-built-in folder be deleted, with its version", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<NotesScreen onStartTask={vi.fn()} />);
    const nav = await screen.findByRole("navigation", { name: "Folders" });
    const remove = () => within(nav).getByRole("button", { name: "Delete empty folder" }) as HTMLButtonElement;
    expect(remove().disabled).toBe(true); // General is built in
    await openFolder(/^University/);
    expect(remove().disabled).toBe(true); // it holds Agile Development
    await openFolder(/Agile Development/);
    expect(remove().disabled).toBe(false);
    fireEvent.click(remove());
    await waitFor(() => expect(notesApi.deleteNoteFolder).toHaveBeenCalledWith("folder-agile", 1));
  });

  it("shows a plain message for a typed folder conflict", async () => {
    vi.mocked(notesApi.createNoteFolder).mockRejectedValue(new appApi.ApiError(409, "That name is already used here.", "name_conflict", null, "/api/notes/folders"));
    render(<NotesScreen onStartTask={vi.fn()} />);
    const nav = await screen.findByRole("navigation", { name: "Folders" });
    fireEvent.click(within(nav).getByRole("button", { name: "New folder" }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. Agile Development"), { target: { value: "University" } });
    fireEvent.click(screen.getByRole("button", { name: /Create folder/ }));
    expect(await screen.findByText("That name is already used here.")).not.toBeNull();
  });

  it("explains the move to folders and files once, without claiming any merge", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    const notice = await screen.findByRole("region", { name: "Notes now use folders" });
    expect(within(notice).getByText(/All 3 of your notes are here unchanged/)).not.toBeNull();
    expect(within(notice).getByText(/Nothing was merged or renamed/)).not.toBeNull();
    expect(within(notice).getByText("AVA Explorer · 1")).not.toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "GOT IT" }));
    expect(screen.queryByRole("region", { name: "Notes now use folders" })).toBeNull();
    cleanup();
    render(<NotesScreen onStartTask={vi.fn()} />);
    await screen.findByText("PAGE 1 / 2");
    expect(screen.queryByRole("region", { name: "Notes now use folders" })).toBeNull();
  });
});

describe("Notes board view", () => {
  async function openBoard(folderName: RegExp = /AVA Explorer/) {
    await openFolder(folderName);
    fireEvent.click(screen.getByRole("button", { name: /^Board$/ }));
  }

  it("keeps the four-stage board as an optional per-folder view", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await openBoard();
    for (const stage of ["Ideas", "Doing", "Review", "Done"]) expect(screen.getAllByText(stage).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Explain watcher failures").length).toBeGreaterThan(0);
    expect(screen.queryByText("Zulu first file")).toBeNull();
  });

  it("promotes a saved note into a prefilled AVA task", async () => {
    const onStartTask = vi.fn();
    render(<NotesScreen onStartTask={onStartTask} />);
    await openBoard();
    const cardTitle = screen.getAllByText("Explain watcher failures").find((element) => element.tagName === "H3");
    if (!cardTitle?.closest("button")) throw new Error("note card button not found");
    fireEvent.click(cardTitle.closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: /Start task/i }));
    await waitFor(() => expect(notesApi.promoteNote).toHaveBeenCalledWith("note-1", 1, "task"));
    await waitFor(() => expect(onStartTask).toHaveBeenCalledWith("Turn this AVA Note into a completed task."));
  });

  it("connects a project brief to scoped source-verified memory and its source chat", async () => {
    const onOpenChat = vi.fn();
    const personalMemory = indexedMemory({
      entry: { ...memory.entry, id: "memory-personal", title: "Private unrelated memory", project: null, privacyLevel: "personal" },
    });
    vi.mocked(appApi.fetchMemoryIndex).mockResolvedValue({ ...memoryResponse, results: [personalMemory, memory] });

    render(<NotesScreen onStartTask={vi.fn()} onOpenChat={onOpenChat} />);
    await openBoard();

    await waitFor(() => expect(appApi.fetchMemoryIndex).toHaveBeenCalledWith("AVA Explorer"));
    expect(await screen.findByRole("heading", { name: "Project brief" })).not.toBeNull();
    expect(screen.getByText("Evidence-first Explorer")).not.toBeNull();
    expect(screen.getByText("Source verified")).not.toBeNull();
    expect(screen.queryByText("Private unrelated memory")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open source chat/i }));
    expect(onOpenChat).toHaveBeenCalledWith("source-session");
    fireEvent.change(screen.getByPlaceholderText("Search this folder"), { target: { value: "no matching note" } });
    expect(screen.getByText("Explain watcher failures")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^COLLAPSE/ }));
    expect(screen.queryByText("Evidence-first Explorer")).toBeNull();
    expect(screen.getByRole("button", { name: /^EXPAND/ }).getAttribute("aria-expanded")).toBe("false");
  });

  it("does not load the project brief while reading files", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    await openFolder(/AVA Explorer/);
    await screen.findByText("PAGE 1 / 1");
    expect(appApi.fetchMemoryIndex).not.toHaveBeenCalled();
  });

  it("shows changed evidence as a warning instead of trusted project knowledge", async () => {
    const changed = indexedMemory({
      source: { ...memory.source, status: "changed", reason: "The source range changed after capture." },
      usable: false,
    });
    vi.mocked(appApi.fetchMemoryIndex).mockResolvedValue({ ...memoryResponse, results: [changed] });

    render(<NotesScreen onStartTask={vi.fn()} />);
    await openBoard();
    expect(await screen.findByText("Source changed")).not.toBeNull();
    expect(screen.getByText("1 source warning")).not.toBeNull();
  });

  it("degrades to an actionable memory error without hiding project Notes", async () => {
    vi.mocked(appApi.fetchMemoryIndex).mockRejectedValue(new Error("Memory index is temporarily unavailable."));
    render(<NotesScreen onStartTask={vi.fn()} />);
    await openBoard();
    expect(await screen.findByText("Memory index is temporarily unavailable.")).not.toBeNull();
    expect(screen.getAllByText("Explain watcher failures").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "RETRY" })).not.toBeNull();
  });

  it("suppresses a stale project response after the user switches folders", async () => {
    const secondProject = { ...snapshot.projects[0]!, id: "project-2", name: "Voice", description: "Voice continuity", noteCount: 0 };
    vi.mocked(notesApi.fetchNotes).mockResolvedValue({ ...snapshot, projects: [...snapshot.projects, secondProject] });
    vi.mocked(notesApi.fetchNotesTree).mockResolvedValue({ ...tree, folders: [...tree.folders, folder({ id: "project-2", name: "Voice", position: 3 })] });
    let resolveExplorer!: (value: MemoryIndexSearchResponse) => void;
    let resolveVoice!: (value: MemoryIndexSearchResponse) => void;
    vi.mocked(appApi.fetchMemoryIndex).mockImplementation((project) => new Promise((resolve) => {
      if (project === "AVA Explorer") resolveExplorer = resolve;
      else resolveVoice = resolve;
    }));
    const voiceMemory = indexedMemory({ entry: { ...memory.entry, id: "memory-voice", title: "Voice project memory", project: "Voice" } });

    render(<NotesScreen onStartTask={vi.fn()} />);
    await openBoard();
    expect(await screen.findByText(/Checking indexed project knowledge/i)).not.toBeNull();
    await openFolder(/^Voice/);
    resolveVoice({ ...memoryResponse, project: "Voice", results: [voiceMemory] });
    expect(await screen.findByText("Voice project memory")).not.toBeNull();
    resolveExplorer(memoryResponse);
    await waitFor(() => expect(screen.queryByText("Evidence-first Explorer")).toBeNull());
  });
});

describe("Notes exact-note handoff", () => {
  it("opens exactly the requested note as the file in its own folder", async () => {
    render(<NotesScreen onStartTask={vi.fn()} initialNoteId="note-1" />);
    expect(await screen.findByText("PAGE 1 / 1")).not.toBeNull();
    expect(fileHeading()).toBe("Explain watcher failures");
    const nav = screen.getByRole("navigation", { name: "Folders" });
    expect(within(nav).getByRole("button", { name: /AVA Explorer/ }).getAttribute("aria-current")).toBe("true");
  });

  it("opens a later file directly, not the folder's first file", async () => {
    render(<NotesScreen onStartTask={vi.fn()} initialNoteId="file-2" />);
    expect(await screen.findByText("PAGE 1 / 1")).not.toBeNull();
    expect(fileHeading()).toBe("Alpha second file");
    expect(within(screen.getByRole("navigation", { name: "Files in General" })).getByRole("button", { name: /Alpha second file/ }).getAttribute("aria-current")).toBe("page");
  });

  it("applies the handoff once and never re-selects it on refresh", async () => {
    render(<NotesScreen onStartTask={vi.fn()} initialNoteId="file-2" />);
    await screen.findByText("PAGE 1 / 1");
    const files = screen.getByRole("navigation", { name: "Files in General" });
    fireEvent.click(within(files).getByRole("button", { name: /Zulu first file/ }));
    expect(fileHeading()).toBe("Zulu first file");
    const loadsBefore = vi.mocked(notesApi.fetchNotes).mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(vi.mocked(notesApi.fetchNotes).mock.calls.length).toBeGreaterThan(loadsBefore));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fileHeading()).toBe("Zulu first file");
  });

  it("says a missing note is unavailable without revealing why", async () => {
    render(<NotesScreen onStartTask={vi.fn()} initialNoteId="gone-note" />);
    expect(await screen.findByText("That note is no longer available.")).not.toBeNull();
    expect(counter()).toBe("PAGE 1 / 2");
  });

  it("treats an archived note exactly like a missing one", async () => {
    vi.mocked(notesApi.fetchNotes).mockResolvedValue({ ...snapshot, notes: [{ ...note, status: "archived" }] });
    render(<NotesScreen onStartTask={vi.fn()} initialNoteId="note-1" />);
    expect(await screen.findByText("That note is no longer available.")).not.toBeNull();
    expect(screen.queryByText("Explain watcher failures")).toBeNull();
  });

  it("shows the load error, not a missing-note notice, when Notes cannot load", async () => {
    vi.mocked(notesApi.fetchNotes).mockRejectedValue(new Error("Notes could not be loaded right now."));
    render(<NotesScreen onStartTask={vi.fn()} initialNoteId="note-1" />);
    expect(await screen.findByText(/Notes could not be loaded right now/)).not.toBeNull();
    expect(screen.queryByText("That note is no longer available.")).toBeNull();
  });
});
