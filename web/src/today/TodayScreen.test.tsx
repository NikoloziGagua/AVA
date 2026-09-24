// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Note } from "../notes/api.js";

const fetchSessionPage = vi.fn();
const fetchNotes = vi.fn();
const fetchWatches = vi.fn();
vi.mock("../api.js", () => ({
  fetchSessionPage: (input: unknown) => fetchSessionPage(input),
  fetchWatches: () => fetchWatches(),
  lastHumanActivity: (s: { last_human_activity_at?: number | null; created_at: number }) => s.last_human_activity_at ?? s.created_at,
}));
vi.mock("../notes/api.js", () => ({ fetchNotes: () => fetchNotes() }));
vi.mock("../components/ava/Orb.js", () => ({ Orb: () => <span data-testid="orb" /> }));
vi.mock("../chat/CommandBar.js", () => ({
  CommandBar: ({ onSubmit, placeholder }: { onSubmit: (text: string) => void; placeholder?: string }) => (
    <button type="button" onClick={() => onSubmit("typed capture")}>{placeholder}</button>
  ),
}));

import { STARTERS, TodayScreen, splitNotes, type TodayScreenProps } from "./TodayScreen.js";

function note(over: Partial<Note>): Note {
  return {
    id: "n", title: "A note", content: "", kind: "requirement", status: "ideas", collection: null, projectId: null,
    section: "capture", tags: [], links: [], changeLog: [], pinned: false, source: "manual", sourceSessionId: null,
    promotion: null, version: 1, createdAt: 1, updatedAt: 1, ...over,
  };
}

function props(): TodayScreenProps {
  return {
    onOpenChat: vi.fn(), onStartChat: vi.fn(), onEnterVoice: vi.fn(), onOpenTalk: vi.fn(),
    onOpenNote: vi.fn(), onOpenIdeas: vi.fn(), onOpenNotes: vi.fn(),
  };
}

const conversations = [
  { id: "c1", title: "Planning this week", created_at: 1, updated_at: 5, status: "idle", pinned: 0, origin: "human", last_human_activity_at: 50 },
];

const HOUR = 3_600_000;
function reminder(id: string, prompt: string, dueIn: number, state = "scheduled", kind = "reminder") {
  const dueAt = Date.now() + dueIn;
  return {
    id, prompt, interval_minutes: 0, once: 1, enabled: 1, session_id: null, created_at: 1, last_run_at: null,
    last_status: null, last_result: null, kind, run_at: dueAt,
    reminder_status: {
      version: 1, occurrenceId: `reminder:${id}:${dueAt}`, revision: 1, state, dueAt, timeZone: "Europe/London",
      expiresAt: dueAt + 900_000, attempts: 0, attemptedAt: null, nextAttemptAt: null, acceptedAt: null,
      subscriptions: { total: 0, accepted: 0, rejectedTransient: 0, rejectedPermanent: 0, unknown: 0 },
      reasonCode: state === "scheduled" ? null : "missed_window", phoneReceipt: "unconfirmed",
    },
  };
}

beforeEach(() => {
  fetchWatches.mockReset().mockResolvedValue([
    reminder("later", "Pay rent", 48 * HOUR),
    reminder("soon", "Submit coursework", 2 * HOUR),
    reminder("past", "Old one", -48 * HOUR, "expired"),
    reminder("check", "Check the status page", HOUR, "scheduled", "check"),
  ]);
  fetchSessionPage.mockReset().mockResolvedValue({ sessions: conversations, nextCursor: null });
  fetchNotes.mockReset().mockResolvedValue({
    projects: [],
    notes: [
      note({ id: "i1", title: "Split-the-bills app", kind: "idea", updatedAt: 30 }),
      note({ id: "n1", title: "Algorithms reading list", kind: "documentation", updatedAt: 20 }),
      note({ id: "old", title: "Archived thought", kind: "idea", status: "archived", updatedAt: 99 }),
    ],
  });
});
afterEach(cleanup);

describe("Today", () => {
  it("asks only for Nika's three latest conversations", async () => {
    render(<TodayScreen {...props()} />);
    await screen.findByText("Planning this week");
    expect(fetchSessionPage).toHaveBeenCalledWith({ scope: "human", limit: 3 });
  });

  it("shows conversations, ideas and notes and opens each exactly", async () => {
    const input = props();
    render(<TodayScreen {...input} />);
    fireEvent.click(await screen.findByText("Planning this week"));
    expect(input.onOpenChat).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByText("Split-the-bills app"));
    expect(input.onOpenNote).toHaveBeenCalledWith("i1");
    fireEvent.click(screen.getByText("Algorithms reading list"));
    expect(input.onOpenNote).toHaveBeenCalledWith("n1");
    expect(screen.queryByText("Archived thought")).toBeNull();
  });

  it("shows upcoming reminders soonest first with their honest status, and no controls", async () => {
    render(<TodayScreen {...props()} />);
    const card = await screen.findByRole("region", { name: "Schedule" });
    await within(card).findByText("Submit coursework");
    const text = card.textContent!;
    expect(text.indexOf("Submit coursework")).toBeLessThan(text.indexOf("Pay rent"));
    expect(within(card).getAllByText("Scheduled")).toHaveLength(2);
    expect(text).not.toContain("Old one");
    expect(text).not.toContain("Check the status page");
    expect(card.querySelectorAll("button, input, select, textarea")).toHaveLength(0);
  });

  it("has honest empty and error states for reminders", async () => {
    fetchWatches.mockResolvedValue([reminder("past", "Old one", -48 * HOUR, "expired")]);
    const view = render(<TodayScreen {...props()} />);
    expect(await screen.findByText("No reminders coming up.")).toBeTruthy();
    view.unmount();
    fetchWatches.mockRejectedValue(new Error("offline"));
    render(<TodayScreen {...props()} />);
    expect(await screen.findByText("Your reminders could not be loaded.")).toBeTruthy();
    expect(await screen.findByText("Planning this week")).toBeTruthy();
  });

  it("starts talking by voice and sends a capture to a new chat", async () => {
    const input = props();
    render(<TodayScreen {...input} />);
    fireEvent.click(await screen.findByRole("button", { name: /Talk to AVA/ }));
    expect(input.onEnterVoice).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Add a task, note or idea/ }));
    expect(input.onStartChat).toHaveBeenCalledWith("typed capture");
  });

  it("shows loading first, then each section on its own", async () => {
    let resolveNotes!: (value: unknown) => void;
    fetchNotes.mockReturnValue(new Promise((resolve) => { resolveNotes = resolve; }));
    render(<TodayScreen {...props()} />);
    expect(screen.getByText("Loading ideas…")).toBeTruthy();
    expect(await screen.findByText("Planning this week")).toBeTruthy();
    resolveNotes({ projects: [], notes: [] });
    expect(await screen.findByText("No ideas yet.")).toBeTruthy();
  });

  it("keeps the page when one section fails, and never shows first run on errors", async () => {
    fetchSessionPage.mockRejectedValue(new Error("offline"));
    fetchNotes.mockResolvedValue({ projects: [], notes: [] });
    render(<TodayScreen {...props()} />);
    expect(await screen.findByText("Your conversations could not be loaded.")).toBeTruthy();
    expect(screen.getByText("No ideas yet.")).toBeTruthy();
    expect(screen.queryByText("Let's set AVA up to run your week.")).toBeNull();
  });

  it("does not show first run when notes fail even if there are no conversations", async () => {
    fetchSessionPage.mockResolvedValue({ sessions: [], nextCursor: null });
    fetchNotes.mockRejectedValue(new Error("offline"));
    render(<TodayScreen {...props()} />);
    expect(await screen.findByText("Your ideas could not be loaded.")).toBeTruthy();
    expect(screen.queryByText("Let's set AVA up to run your week.")).toBeNull();
  });

  it("is not a first run when only reminders exist, or when reminders fail to load", async () => {
    fetchSessionPage.mockResolvedValue({ sessions: [], nextCursor: null });
    fetchNotes.mockResolvedValue({ projects: [], notes: [] });
    fetchWatches.mockResolvedValue([reminder("past", "Old one", -48 * HOUR, "expired")]);
    const view = render(<TodayScreen {...props()} />);
    expect(await screen.findByText("No reminders coming up.")).toBeTruthy();
    expect(screen.queryByText("Let's set AVA up to run your week.")).toBeNull();
    view.unmount();
    fetchWatches.mockRejectedValue(new Error("offline"));
    render(<TodayScreen {...props()} />);
    expect(await screen.findByText("Your reminders could not be loaded.")).toBeTruthy();
    expect(screen.queryByText("Let's set AVA up to run your week.")).toBeNull();
  });

  it("welcomes a first run only after every load succeeded empty", async () => {
    fetchWatches.mockResolvedValue([]);
    fetchSessionPage.mockResolvedValue({ sessions: [], nextCursor: null });
    fetchNotes.mockResolvedValue({ projects: [], notes: [note({ id: "a", status: "archived" })] });
    const input = props();
    render(<TodayScreen {...input} />);
    expect(await screen.findByText("Let's set AVA up to run your week.")).toBeTruthy();
    // It describes this screen only: memories may exist even when Today is empty.
    expect(screen.getByText(/Nothing is on Today yet/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/doesn't know|does not know/i);
    fireEvent.click(screen.getByText(STARTERS[1].title));
    expect(input.onStartChat).toHaveBeenCalledWith(STARTERS[1].prompt);
    expect(screen.getByText("Not available yet")).toBeTruthy();
  });
});

describe("splitNotes", () => {
  it("separates ideas from other notes, newest first, without archived ones", () => {
    const result = splitNotes([
      note({ id: "a", kind: "idea", updatedAt: 1 }),
      note({ id: "b", kind: "idea", updatedAt: 3 }),
      note({ id: "c", kind: "task", updatedAt: 2 }),
      note({ id: "d", kind: "idea", status: "archived", updatedAt: 9 }),
    ]);
    expect(result.ideas.map((n) => n.id)).toEqual(["b", "a"]);
    expect(result.notes.map((n) => n.id)).toEqual(["c"]);
  });
});

describe("Today reminder card stays current (#390)", () => {
  it("picks up a new status when the page regains focus", async () => {
    render(<TodayScreen {...props()} />);
    const card = await screen.findByRole("region", { name: "Schedule" });
    await within(card).findByText("Submit coursework");
    fetchWatches.mockResolvedValue([reminder("soon", "Submit coursework", 2 * HOUR, "paused")]);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await within(card).findByText("Paused")).toBeTruthy();
    expect(within(card).queryByText("Pay rent")).toBeNull();
  });

  it("keeps the last reminders but marks them stale when a refresh fails, with no controls", async () => {
    render(<TodayScreen {...props()} />);
    const card = await screen.findByRole("region", { name: "Schedule" });
    await within(card).findByText("Submit coursework");
    fetchWatches.mockRejectedValue(new Error("offline"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await within(card).findByText(/Couldn't refresh\. Showing reminders as of/)).toBeTruthy();
    expect(within(card).getByText("Submit coursework")).toBeTruthy();
    expect(card.querySelectorAll("button, input, select, textarea")).toHaveLength(0);
  });
});
