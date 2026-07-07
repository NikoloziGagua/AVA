// @vitest-environment jsdom
// Delete/undo queue: a second delete must NOT silently flush the first's undo
// window (each pending delete keeps its own 5s timer), and undo is LIFO.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { SessionRow } from "../api.js";

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
  return { id: "x", title: "Untitled", created_at: 0, updated_at: 0, status: "idle", pinned: 0, ...over };
}

// Flush pending microtasks/effects without waitFor (which deadlocks under fake
// timers because its poller is itself faked).
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  // Reduced motion so snapshotForFlip skips Flip.getState/Flip.from in jsdom.
  localStorage.setItem("ava-motion", "reduced");
  vi.useFakeTimers();
  fetchSessions.mockReset().mockResolvedValue([
    row({ id: "a", title: "Alpha chat" }),
    row({ id: "b", title: "Beta chat" }),
  ]);
  setSessionPinned.mockReset().mockResolvedValue(undefined);
  deleteSession.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChatListScreen delete queue", () => {
  it("keeps a prior delete undoable when a second delete starts, and undoes LIFO", async () => {
    render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    await flush();
    expect(screen.getByText("Alpha chat")).toBeTruthy();

    const del = () => screen.getAllByRole("button", { name: "delete" });
    // Delete Alpha (first row), then Beta (now first row).
    act(() => { fireEvent.click(del()[0]!); });
    act(() => { fireEvent.click(del()[0]!); });

    // Toast reflects the latest with a "+1 more" for the still-pending first.
    expect(screen.getByText(/Beta chat/)).toBeTruthy();
    expect(document.body.textContent).toContain("+1 more");
    // Crucially: neither delete has been silently committed yet.
    expect(deleteSession).not.toHaveBeenCalled();

    // Undo → restores the most recent (Beta), leaving Alpha still pending.
    act(() => { fireEvent.click(screen.getByRole("button", { name: "undo" })); });
    expect(screen.getByText("Beta chat")).toBeTruthy();

    // Let the windows elapse: only Alpha commits (Beta was undone).
    act(() => { vi.advanceTimersByTime(6000); });
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith("a");
  });

  it("commits an outstanding pending delete on unmount (no lost delete)", async () => {
    const { unmount } = render(<ChatListScreen onClose={() => {}} onOpenChat={() => {}} />);
    await flush();

    act(() => { fireEvent.click(screen.getAllByRole("button", { name: "delete" })[0]!); });
    expect(deleteSession).not.toHaveBeenCalled();

    // Navigating away mid-undo honors the delete instead of dropping it.
    unmount();
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledWith("a");
  });
});
