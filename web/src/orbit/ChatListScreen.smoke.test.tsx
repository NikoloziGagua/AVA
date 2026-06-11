// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { SessionRow } from "../api.js";

// Mock the api module so the screen mounts without real network in jsdom.
const fetchSessions = vi.fn();
const setSessionPinned = vi.fn();
const deleteSession = vi.fn();
vi.mock("../api.js", () => ({
  fetchSessions: () => fetchSessions(),
  api: {
    setSessionPinned: (...a: unknown[]) => setSessionPinned(...a),
    deleteSession: (...a: unknown[]) => deleteSession(...a),
  },
}));

import { ChatListScreen } from "./ChatListScreen.js";

function row(over: Partial<SessionRow>): SessionRow {
  return {
    id: "x",
    title: "Untitled",
    created_at: 0,
    updated_at: 0,
    status: "idle",
    pinned: 0,
    ...over,
  };
}

beforeEach(() => {
  fetchSessions.mockReset();
  setSessionPinned.mockReset().mockResolvedValue(undefined);
  deleteSession.mockReset().mockResolvedValue(undefined);
});

// No vitest globals → RTL can't auto-register its cleanup; unmount explicitly
// so one test's DOM (e.g. the empty state) can't leak into the next.
afterEach(() => cleanup());

describe("ChatListScreen", () => {
  it("exports a function component", () => {
    expect(typeof ChatListScreen).toBe("function");
  });

  it("renders the empty state when there are no chats", async () => {
    fetchSessions.mockResolvedValue([]);
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    expect(await screen.findByText("NO CHATS YET")).toBeTruthy();
  });

  it("renders a distinct error state when the fetch fails (failure ≠ empty)", async () => {
    fetchSessions.mockRejectedValue(new Error("boom"));
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    expect(await screen.findByText(/error: .*boom/)).toBeTruthy();
    expect(screen.queryByText("NO CHATS YET")).toBeNull();
  });

  it("shows pinned chats in the strip and unpinned in the table, and toggles a pin", async () => {
    fetchSessions.mockResolvedValue([
      row({ id: "p", title: "Pinned chat", pinned: 1 }),
      row({ id: "r", title: "Regular chat", pinned: 0 }),
    ]);
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);

    // Both sections render their chats.
    expect(await screen.findByText("Important chats")).toBeTruthy();
    expect(screen.getByText("Pinned chat")).toBeTruthy();
    expect(screen.getByText("Regular chat")).toBeTruthy();

    // The unpinned row has a "pin" control; clicking it persists pinned=true.
    fireEvent.click(screen.getByRole("button", { name: "pin" }));
    await waitFor(() => expect(setSessionPinned).toHaveBeenCalledWith("r", true));
  });
});
