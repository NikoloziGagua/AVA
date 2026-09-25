import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({
  calendar: vi.fn(),
  watches: vi.fn(),
  notes: vi.fn(),
}));

vi.mock("../calendar/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../calendar/api.js")>()),
  fetchCalendarRange: sources.calendar,
}));
vi.mock("../api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.js")>()),
  fetchWatches: sources.watches,
}));
vi.mock("../notes/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notes/api.js")>()),
  fetchNotes: sources.notes,
}));
vi.mock("../design/face/FaceStage.js", () => ({ FaceStage: () => <div data-testid="face" /> }));
vi.mock("../design/face/FaceStill.js", () => ({ FaceStill: () => null }));

import { HomeScreen } from "./HomeScreen.js";

const HOUR = 3_600_000;

function props() {
  return { onStartChat: vi.fn(), onOpenNote: vi.fn(), onOpenCalendar: vi.fn(), onOpenReminders: vi.fn() };
}

beforeEach(() => {
  sources.calendar.mockResolvedValue({ fetchedAt: Date.now(), occurrences: [], complete: true });
  sources.watches.mockResolvedValue([]);
  sources.notes.mockResolvedValue({ projects: [], notes: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("HomeScreen", () => {
  it("is nearly empty: face, greeting, status, one thing and three suggestions", async () => {
    render(<HomeScreen {...props()} />);
    expect(await screen.findByTestId("face")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (night|morning|afternoon|evening), Niko\.$/);
    expect(document.querySelector(".ds-island")?.textContent).toContain("AVA");
    expect(await screen.findByText("Nothing planned for today.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Plan my day|What's due this week\?|Start a study session/ })).toHaveLength(3);
  });

  it("shows the next event today and opens the calendar from it", async () => {
    const soon = Date.now() + 5 * 60_000;
    // Only meaningful while "soon" is still today in Dublin; skip the assertion near midnight.
    const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(soon)
      === new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(Date.now());
    sources.calendar.mockResolvedValue({
      fetchedAt: Date.now(), complete: true,
      occurrences: [{ eventId: "e", occurrenceKey: "e:1", originalLocalDate: "", localStart: "", localEnd: "", startsAt: soon, endsAt: soon + HOUR, timeZone: "Europe/Dublin", title: "Agile Development · Lecture", description: "", location: "", kind: "lecture", attendanceIntent: "attend", attendanceOutcome: "unknown", notesFolderId: null, eventVersion: 1, exceptionVersion: null, cancelled: false, moved: false }],
    });
    const handlers = props();
    render(<HomeScreen {...handlers} />);
    if (!sameDay) return;
    const card = await screen.findByRole("button", { name: /Agile Development · Lecture\. You planned to attend\. Open calendar\./ });
    fireEvent.click(card);
    expect(handlers.onOpenCalendar).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Get me ready for Agile Development · Lecture" })).toBeTruthy();
  });

  it("falls back to a reminder due soon, then opens reminders", async () => {
    sources.watches.mockResolvedValue([{ id: "r1", prompt: "Submit Agile reflection", interval_minutes: 0, once: 1, enabled: 1, session_id: null, created_at: 0, last_run_at: null, last_status: null, last_result: null, run_at: Date.now() + 2 * HOUR, kind: "reminder" }]);
    const handlers = props();
    render(<HomeScreen {...handlers} />);
    fireEvent.click(await screen.findByRole("button", { name: /Submit Agile reflection\. Open reminders\./ }));
    expect(handlers.onOpenReminders).toHaveBeenCalledTimes(1);
  });

  it("starts a chat with the picked suggestion", async () => {
    const handlers = props();
    render(<HomeScreen {...handlers} />);
    await screen.findByText("Nothing planned for today.");
    fireEvent.click(screen.getByRole("button", { name: "Plan my day" }));
    expect(handlers.onStartChat).toHaveBeenCalledWith("Plan my day");
  });

  it("says honestly when it couldn't check the day, and retries", async () => {
    sources.calendar.mockRejectedValue(new Error("down"));
    sources.watches.mockRejectedValue(new Error("down"));
    sources.notes.mockRejectedValue(new Error("down"));
    render(<HomeScreen {...props()} />);
    expect(await screen.findByText("I couldn't check your day just now.")).toBeTruthy();
    sources.notes.mockResolvedValue({ projects: [], notes: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Nothing planned for today.")).toBeTruthy());
  });

  it("still picks from the sources that answered when one fails", async () => {
    sources.calendar.mockRejectedValue(new Error("down"));
    sources.notes.mockResolvedValue({ projects: [], notes: [{ id: "n1", title: "Agile study notes", pinned: true, status: "ideas", updatedAt: 5 }] });
    const handlers = props();
    render(<HomeScreen {...handlers} />);
    fireEvent.click(await screen.findByRole("button", { name: /Agile study notes\. Open note\./ }));
    expect(handlers.onOpenNote).toHaveBeenCalledWith("n1");
  });
});
