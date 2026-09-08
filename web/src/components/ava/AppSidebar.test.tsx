// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Home, Radar } from "lucide-react";

const fetchSessions = vi.fn();
vi.mock("../../api.js", () => ({ fetchSessions: () => fetchSessions() }));

import { AppSidebar, type AppSidebarProps } from "./AppSidebar.js";

const sessions = [
  { id: "older", title: "Older work", created_at: 1, updated_at: 100, status: "interrupted", pinned: 0 },
  { id: "current", title: "Current design discussion", created_at: 2, updated_at: 90, status: "interrupted", pinned: 1 },
  { id: "newest", title: "Newest other chat", created_at: 3, updated_at: 120, status: "interrupted", pinned: 0 },
];

function props(overrides: Partial<AppSidebarProps> = {}): AppSidebarProps {
  return {
    items: [
      { name: "Home", label: "Home", icon: Home, group: "main", onSelect: vi.fn() },
      { name: "Explore", label: "Explore AVA", icon: Radar, group: "work", onSelect: vi.fn() },
    ],
    activeName: "Chats",
    visible: true,
    expanded: true,
    activeChatSessionId: "current",
    onExpandedChange: vi.fn(),
    onNewChat: vi.fn(),
    onOpenCurrentChat: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenAllChats: vi.fn(),
    onCurrentChatUnavailable: vi.fn(),
    ...overrides,
  };
}

describe("AppSidebar", () => {
  beforeEach(() => { fetchSessions.mockReset().mockResolvedValue(sessions); });
  afterEach(cleanup);

  it("keeps the current conversation first and opens it directly", async () => {
    const input = props();
    render(<AppSidebar {...input} />);
    expect(screen.getByRole("button", { name: "Return to current chat" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Return to current chat" }));
    expect(input.onOpenCurrentChat).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("Current design discussion")).toBeTruthy());
    const chatButtons = screen.getAllByRole("button").filter((node) => node.classList.contains("ava-sidebar-chat"));
    expect(chatButtons[0]?.textContent).toContain("Current design discussion");
    fireEvent.click(screen.getByText("Newest other chat"));
    expect(input.onOpenChat).toHaveBeenCalledWith("newest");
  });

  it("keeps the collapsed rail keyboard-accessible without rendering recent content", () => {
    const input = props({ expanded: false });
    render(<AppSidebar {...input} />);
    expect(screen.queryByRole("region", { name: "Recent chats" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(input.onExpandedChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(input.onNewChat).toHaveBeenCalledOnce();
  });

  it("closes an expanded narrow-screen overlay with Escape", () => {
    const input = props();
    render(<AppSidebar {...input} />);
    expect(screen.getByRole("button", { name: "Close navigation" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("clears a stale current-chat shortcut when the server no longer lists it", async () => {
    fetchSessions.mockResolvedValue([sessions[0]]);
    const input = props();
    render(<AppSidebar {...input} />);
    await waitFor(() => expect(input.onCurrentChatUnavailable).toHaveBeenCalledOnce());
  });

  it("degrades a history failure to an honest all-chats route", async () => {
    fetchSessions.mockRejectedValue(new Error("offline"));
    const input = props();
    render(<AppSidebar {...input} />);
    const fallback = await screen.findByRole("button", { name: /Chats unavailable/i });
    fireEvent.click(fallback);
    expect(input.onOpenAllChats).toHaveBeenCalledOnce();
  });
});
