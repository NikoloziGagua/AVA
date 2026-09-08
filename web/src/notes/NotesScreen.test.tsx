import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryIndexResult, MemoryIndexSearchResponse } from "../api.js";
import * as appApi from "../api.js";
import type { Note, NotesSnapshot } from "./api.js";
import { NotesScreen } from "./NotesScreen.js";
import * as notesApi from "./api.js";

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
    createNote: vi.fn(),
    createNoteProject: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    promoteNote: vi.fn(),
  };
});

const note: Note = {
  id: "note-1",
  title: "Explain watcher failures",
  content: "Show the last verified stage and exact observation boundary.",
  kind: "requirement",
  status: "ideas",
  collection: "AVA Explorer",
  projectId: "project-1",
  section: "priorities",
  tags: ["visibility"],
  links: [{ label: "Contract", url: "https://example.com/contract" }],
  changeLog: [{ id: "change-1", at: 1_785_800_000_000, action: "created", detail: "Captured in AVA Explorer" }],
  pinned: true,
  source: "ava_chat",
  sourceSessionId: "session-1",
  promotion: null,
  version: 1,
  createdAt: 1_785_800_000_000,
  updatedAt: 1_785_800_000_000,
};

const snapshot: NotesSnapshot = {
  projects: [{
    id: "project-1",
    name: "AVA Explorer",
    description: "Capability and workflow visibility",
    version: 1,
    noteCount: 1,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }],
  notes: [note],
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
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
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
      verifiedAt: note.updatedAt,
      reason: "Source messages still match.",
    },
    match: { mode: "recent", reason: "Recently captured.", semanticScore: null, lexicalScore: 0, sharedTerms: [] },
    lineage: { threadId: "thread-1", parentEntryId: null, sequence: 1, kind: "initial", reason: null, totalCheckpoints: 1, isLatest: true },
    governance: { threadVersion: 1, pinned: false, state: "current", retrievalEligible: true, corrected: false, correctionEventId: null, correctionReason: null, supersededByThreadId: null, conflictWithThreadIds: [], updatedAt: note.updatedAt, events: [] },
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
  vi.mocked(notesApi.fetchNotes).mockResolvedValue(snapshot);
  vi.mocked(notesApi.createNote).mockResolvedValue({ ...note, id: "note-new", projectId: null, collection: null });
  vi.mocked(notesApi.updateNote).mockResolvedValue({ ...note, version: 2 });
  vi.mocked(notesApi.promoteNote).mockResolvedValue({
    note: { ...note, version: 2, promotion: { type: "task", id: "task-1", at: Date.now() } },
    promotionId: "task-1",
    prompt: "Turn this AVA Note into a completed task.",
  });
  vi.mocked(appApi.fetchMemoryIndex).mockResolvedValue(memoryResponse);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Notes workspace", () => {
  it("shows General plus project templates and the four-stage board", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /AVA Explorer/i })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /AVA Explorer/i }));
    expect(screen.getByText("Capability and workflow visibility")).not.toBeNull();
    expect(screen.getAllByText("Quick capture").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pinned priorities").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Decisions").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Documentation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ideas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Doing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Explain watcher failures").length).toBeGreaterThan(0);
  });

  it("captures a general note without forcing the rich editor", async () => {
    render(<NotesScreen onStartTask={vi.fn()} />);
    const input = await screen.findByPlaceholderText(/Drop the thought here/i);
    fireEvent.change(input, { target: { value: "Make AVA status easier to scan" } });
    fireEvent.click(screen.getByRole("button", { name: /^Capture$/i }));
    await waitFor(() => expect(notesApi.createNote).toHaveBeenCalledWith(expect.objectContaining({
      content: "Make AVA status easier to scan",
      projectId: null,
      section: "capture",
      kind: "idea",
    })));
  });

  it("promotes a saved note into a prefilled AVA task", async () => {
    const onStartTask = vi.fn();
    render(<NotesScreen onStartTask={onStartTask} />);
    fireEvent.click(await screen.findByRole("button", { name: /AVA Explorer/i }));
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
    fireEvent.click(await screen.findByRole("button", { name: /AVA Explorer/i }));

    await waitFor(() => expect(appApi.fetchMemoryIndex).toHaveBeenCalledWith("AVA Explorer"));
    expect(await screen.findByRole("heading", { name: "Project brief" })).not.toBeNull();
    expect(screen.getByText("Evidence-first Explorer")).not.toBeNull();
    expect(screen.getByText("Source verified")).not.toBeNull();
    expect(screen.queryByText("Private unrelated memory")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open source chat/i }));
    expect(onOpenChat).toHaveBeenCalledWith("source-session");
    fireEvent.change(screen.getByPlaceholderText("Search this space"), { target: { value: "no matching note" } });
    expect(screen.getByText("Explain watcher failures")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /COLLAPSE/i }));
    expect(screen.queryByText("Evidence-first Explorer")).toBeNull();
    expect(screen.getByRole("button", { name: /EXPAND/i }).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows changed evidence as a warning instead of trusted project knowledge", async () => {
    const changed = indexedMemory({
      source: { ...memory.source, status: "changed", reason: "The source range changed after capture." },
      usable: false,
    });
    vi.mocked(appApi.fetchMemoryIndex).mockResolvedValue({ ...memoryResponse, results: [changed] });

    render(<NotesScreen onStartTask={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /AVA Explorer/i }));
    expect(await screen.findByText("Source changed")).not.toBeNull();
    expect(screen.getByText("1 source warning")).not.toBeNull();
  });

  it("degrades to an actionable memory error without hiding project Notes", async () => {
    vi.mocked(appApi.fetchMemoryIndex).mockRejectedValue(new Error("Memory index is temporarily unavailable."));
    render(<NotesScreen onStartTask={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /AVA Explorer/i }));
    expect(await screen.findByText("Memory index is temporarily unavailable.")).not.toBeNull();
    expect(screen.getAllByText("Explain watcher failures").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "RETRY" })).not.toBeNull();
  });

  it("suppresses a stale project response after the user switches spaces", async () => {
    const secondProject = { ...snapshot.projects[0]!, id: "project-2", name: "Voice", description: "Voice continuity", noteCount: 0 };
    vi.mocked(notesApi.fetchNotes).mockResolvedValue({ ...snapshot, projects: [...snapshot.projects, secondProject] });
    let resolveExplorer!: (value: MemoryIndexSearchResponse) => void;
    let resolveVoice!: (value: MemoryIndexSearchResponse) => void;
    vi.mocked(appApi.fetchMemoryIndex).mockImplementation((project) => new Promise((resolve) => {
      if (project === "AVA Explorer") resolveExplorer = resolve;
      else resolveVoice = resolve;
    }));
    const voiceMemory = indexedMemory({ entry: { ...memory.entry, id: "memory-voice", title: "Voice project memory", project: "Voice" } });

    render(<NotesScreen onStartTask={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /AVA Explorer/i }));
    expect(await screen.findByText(/Checking indexed project knowledge/i)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Voice/i }));
    resolveVoice({ ...memoryResponse, project: "Voice", results: [voiceMemory] });
    expect(await screen.findByText("Voice project memory")).not.toBeNull();
    resolveExplorer(memoryResponse);
    await waitFor(() => expect(screen.queryByText("Evidence-first Explorer")).toBeNull());
  });
});
