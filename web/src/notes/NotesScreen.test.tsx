import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note, NotesSnapshot } from "./api.js";
import { NotesScreen } from "./NotesScreen.js";
import * as notesApi from "./api.js";

vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("../components/ava/BorderGlow.js", () => ({
  BorderGlow: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
}));
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

beforeEach(() => {
  vi.mocked(notesApi.fetchNotes).mockResolvedValue(snapshot);
  vi.mocked(notesApi.createNote).mockResolvedValue({ ...note, id: "note-new", projectId: null, collection: null });
  vi.mocked(notesApi.updateNote).mockResolvedValue({ ...note, version: 2 });
  vi.mocked(notesApi.promoteNote).mockResolvedValue({
    note: { ...note, version: 2, promotion: { type: "task", id: "task-1", at: Date.now() } },
    promotionId: "task-1",
    prompt: "Turn this AVA Note into a completed task.",
  });
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
});
