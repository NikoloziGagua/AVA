// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { SessionRow } from "../api.js";

// Mock the api module so the screen mounts without real network in jsdom.
const fetchSessionPage = vi.fn();
const setSessionPinned = vi.fn();
const deleteSession = vi.fn();
vi.mock("../api.js", () => ({
  fetchSessionPage: (input: unknown) => fetchSessionPage(input),
  lastHumanActivity: (s: { last_human_activity_at?: number | null; created_at: number }) => s.last_human_activity_at ?? s.created_at,
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
  fetchSessionPage.mockReset();
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
    fetchSessionPage.mockResolvedValue({ sessions: [], nextCursor: null });
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    expect(await screen.findByText("NO CHATS YET")).toBeTruthy();
  });

  it("renders a distinct error state when the fetch fails (failure ≠ empty)", async () => {
    fetchSessionPage.mockRejectedValue(new Error("boom"));
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    expect(await screen.findByText(/error: .*boom/)).toBeTruthy();
    expect(screen.queryByText("NO CHATS YET")).toBeNull();
  });

  it("shows pinned chats in the strip and unpinned in the table, and toggles a pin", async () => {
    fetchSessionPage.mockResolvedValue({ sessions: [
      row({ id: "p", title: "Pinned chat", pinned: 1 }),
      row({ id: "r", title: "Regular chat", pinned: 0 }),
    ], nextCursor: null });
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);

    // Both sections render their chats.
    expect(await screen.findByText("Important chats")).toBeTruthy();
    expect(screen.getByText("Pinned chat")).toBeTruthy();
    expect(screen.getByText("Regular chat")).toBeTruthy();

    // The unpinned row has a "pin" control; clicking it persists pinned=true.
    fireEvent.click(screen.getByRole("button", { name: "pin" }));
    await waitFor(() => expect(setSessionPinned).toHaveBeenCalledWith("r", true));
  });

  it("opens a conversation from a keyboard-focusable title button exactly once", async () => {
    fetchSessionPage.mockResolvedValue({ sessions: [row({ id: "r", title: "Regular chat" })], nextCursor: null });
    const onOpenChat = vi.fn();
    render(<ChatListScreen onClose={() => {}} onOpenChat={onOpenChat} />);
    const title = await screen.findByRole("button", { name: "Regular chat" });
    // A native button: reachable with Tab, activated by Enter and Space.
    expect(title.tagName).toBe("BUTTON");
    title.focus();
    expect(document.activeElement).toBe(title);
    fireEvent.click(title);
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onOpenChat).toHaveBeenCalledWith("r", undefined);
  });

  it("lists only Nika's conversations first, bounded, with a cursor to show more", async () => {
    fetchSessionPage.mockImplementation(async (input: { scope: string; cursor?: string | null }) => (
      input.cursor
        ? { sessions: [row({ id: "h2", title: "Second page chat" })], nextCursor: null }
        : { sessions: [row({ id: "h1", title: "First page chat" })], nextCursor: "c1" }
    ));
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    expect(await screen.findByText("First page chat")).toBeTruthy();
    expect(fetchSessionPage).toHaveBeenCalledWith({ scope: "human", limit: 30, cursor: null });
    // History and automation are not fetched until asked for.
    expect(fetchSessionPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Second page chat")).toBeTruthy();
    expect(fetchSessionPage).toHaveBeenLastCalledWith({ scope: "human", limit: 30, cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("opens automated runs for reference only, never as the current chat", async () => {
    fetchSessionPage.mockImplementation(async (input: { scope: string }) => (
      input.scope === "automation"
        ? { sessions: [row({ id: "auto", title: "Nightly watch run", origin: "automation" })], nextCursor: null }
        : { sessions: [], nextCursor: null }
    ));
    const onOpenChat = vi.fn();
    render(<ChatListScreen onClose={() => {}} onOpenChat={onOpenChat} />);
    await screen.findByText("NO CHATS YET");

    const automation = screen.getByRole("button", { name: "Show automated runs" });
    fireEvent.click(automation);
    expect(automation.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(await screen.findByText("Nightly watch run"));
    expect(onOpenChat).toHaveBeenCalledWith("auto", { audit: true });
    // Automated runs cannot be pinned into Nika's own list.
    expect(screen.queryByRole("button", { name: "pin" })).toBeNull();
  });

  it("shows older history on demand and does not repeat a pinned older chat", async () => {
    fetchSessionPage.mockImplementation(async (input: { scope: string }) => (
      input.scope === "legacy"
        ? {
            sessions: [
              row({ id: "old-pinned", title: "Pinned older chat", pinned: 1, origin: "unknown" }),
              row({ id: "old", title: "Plain older chat", origin: "unknown" }),
            ],
            nextCursor: null,
          }
        : {
            sessions: [row({ id: "old-pinned", title: "Pinned older chat", pinned: 1, origin: "unknown" })],
            nextCursor: null,
          }
    ));
    const onOpenChat = vi.fn();
    render(<ChatListScreen onClose={() => {}} onOpenChat={onOpenChat} />);
    expect(await screen.findByText("Pinned older chat")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show older history" }));
    fireEvent.click(await screen.findByText("Plain older chat"));
    expect(onOpenChat).toHaveBeenCalledWith("old", undefined);
    expect(screen.getAllByText("Pinned older chat")).toHaveLength(1);
  });
});
