// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Note } from "../notes/api.js";

const fetchNotes = vi.fn();
const createNote = vi.fn();
vi.mock("../notes/api.js", () => ({
  fetchNotes: () => fetchNotes(),
  createNote: (input: unknown) => createNote(input),
}));
vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  PanelSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import { IdeasScreen, ideasFrom } from "./IdeasScreen.js";

function note(over: Partial<Note>): Note {
  return {
    id: "n", title: "A note", content: "", kind: "idea", status: "ideas", collection: null, projectId: null,
    section: "capture", tags: [], links: [], changeLog: [], pinned: false, source: "manual", sourceSessionId: null,
    promotion: null, version: 1, createdAt: 1, updatedAt: 1, ...over,
  };
}

beforeEach(() => {
  fetchNotes.mockReset().mockResolvedValue({
    projects: [],
    notes: [
      note({ id: "i1", title: "Split-the-bills app", content: "For the flat.", updatedAt: 3 }),
      note({ id: "t1", title: "Buy printer ink", kind: "task", updatedAt: 9 }),
    ],
  });
  createNote.mockReset().mockResolvedValue(note({ id: "new" }));
});
afterEach(cleanup);

describe("Ideas", () => {
  it("lists only ideas and opens the exact note", async () => {
    const onOpenNote = vi.fn();
    render(<IdeasScreen onOpenNote={onOpenNote} />);
    fireEvent.click(await screen.findByText("Split-the-bills app"));
    expect(onOpenNote).toHaveBeenCalledWith("i1");
    expect(screen.queryByText("Buy printer ink")).toBeNull();
  });

  it("creates a new idea as kind idea and refreshes the list", async () => {
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    await screen.findByText("Split-the-bills app");
    fireEvent.change(screen.getByLabelText("What's the idea?"), { target: { value: "  Hike in October  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save idea" }));
    await waitFor(() => expect(createNote).toHaveBeenCalledWith({ content: "Hike in October", kind: "idea", section: "capture", projectId: null }));
    await waitFor(() => expect(fetchNotes).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("What's the idea?") as HTMLTextAreaElement).value).toBe("");
  });

  it("holds the draft still while a save is pending, then clears it", async () => {
    let finish!: () => void;
    createNote.mockReturnValue(new Promise((resolve) => { finish = () => resolve(note({ id: "new" })); }));
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    await screen.findByText("Split-the-bills app");
    const box = screen.getByLabelText("What's the idea?") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Slow save" } });
    fireEvent.click(screen.getByRole("button", { name: "Save idea" }));
    await waitFor(() => expect(box.readOnly).toBe(true));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
    finish();
    await waitFor(() => expect(box.value).toBe(""));
    expect(box.readOnly).toBe(false);
  });

  it("never clears words that changed while the save was pending", async () => {
    let finish!: () => void;
    createNote.mockReturnValue(new Promise((resolve) => { finish = () => resolve(note({ id: "new" })); }));
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    await screen.findByText("Split-the-bills app");
    const box = screen.getByLabelText("What's the idea?") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "First thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Save idea" }));
    await waitFor(() => expect(box.readOnly).toBe(true));
    // A programmatic change (read-only blocks typing) must still survive success.
    fireEvent.change(box, { target: { value: "First thought, and a second one" } });
    finish();
    await waitFor(() => expect(box.readOnly).toBe(false));
    expect(box.value).toBe("First thought, and a second one");
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(createNote).toHaveBeenCalledWith(expect.objectContaining({ content: "First thought" }));
  });

  it("cannot save an empty idea", async () => {
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    await screen.findByText("Split-the-bills app");
    fireEvent.change(screen.getByLabelText("What's the idea?"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Save idea" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole("button", { name: "Save idea" }).closest("form")!);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("keeps the words and explains when saving fails", async () => {
    createNote.mockRejectedValue(new Error("note content is required"));
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    await screen.findByText("Split-the-bills app");
    fireEvent.change(screen.getByLabelText("What's the idea?"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Save idea" }));
    expect((await screen.findByRole("alert")).textContent).toContain("note content is required");
    expect((screen.getByLabelText("What's the idea?") as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it("shows an honest empty state", async () => {
    fetchNotes.mockResolvedValue({ projects: [], notes: [] });
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    expect(await screen.findByText(/No ideas yet/)).toBeTruthy();
  });

  it("shows a load error with retry", async () => {
    fetchNotes.mockRejectedValueOnce(new Error("Notes are unreachable."));
    render(<IdeasScreen onOpenNote={vi.fn()} />);
    expect(await screen.findByText("Notes are unreachable.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Split-the-bills app")).toBeTruthy();
  });
});

describe("ideasFrom", () => {
  it("keeps only live ideas, newest first", () => {
    expect(ideasFrom([
      note({ id: "a", updatedAt: 1 }),
      note({ id: "b", updatedAt: 2 }),
      note({ id: "c", status: "archived", updatedAt: 3 }),
      note({ id: "d", kind: "task", updatedAt: 4 }),
    ]).map((n) => n.id)).toEqual(["b", "a"]);
  });
});
