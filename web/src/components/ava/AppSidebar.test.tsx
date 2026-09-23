// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Home, Radar } from "lucide-react";

const fetchSessionPage = vi.fn();
vi.mock("../../api.js", () => ({
  fetchSessionPage: (input: unknown) => fetchSessionPage(input),
  lastHumanActivity: (session: { last_human_activity_at?: number | null; created_at: number }) =>
    session.last_human_activity_at ?? session.created_at,
}));

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
    ...overrides,
  };
}

describe("AppSidebar", () => {
  beforeEach(() => { fetchSessionPage.mockReset().mockResolvedValue({ sessions, nextCursor: null }); });
  afterEach(cleanup);

  it("keeps the current conversation first and opens it directly", async () => {
    const input = props();
    render(<AppSidebar {...input} />);
    expect(screen.getByText("Navigation")).toBeTruthy();
    expect(screen.queryByText(/^AVA$/)).toBeNull();
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

  it("removes hidden navigation from interaction without unmounting its state", () => {
    const input = props({ visible: false, expanded: true });
    render(<AppSidebar {...input} />);
    expect(screen.getByRole("complementary", { hidden: true }).hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("region", { name: "Recent chats" })).toBeNull();
  });

  it("closes an expanded narrow-screen overlay with Escape", () => {
    const input = props();
    render(<AppSidebar {...input} />);
    expect(screen.getByRole("button", { name: "Close navigation" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("asks only for Nika's own bounded conversations", async () => {
    render(<AppSidebar {...props()} />);
    await waitFor(() => expect(fetchSessionPage).toHaveBeenCalledWith({ scope: "human", limit: 8 }));
  });

  it("keeps the remembered chat when it is absent from the bounded page", async () => {
    fetchSessionPage.mockResolvedValue({ sessions: [sessions[0]], nextCursor: "more" });
    const input = props();
    render(<AppSidebar {...input} />);
    await screen.findByText("Older work");
    // Absence from a page is not proof the conversation is gone; exact lookup
    // decides when it is opened. The shortcut stays.
    expect(screen.getByRole("button", { name: "Return to current chat" })).toBeTruthy();
  });

  it("degrades a history failure to an honest all-chats route", async () => {
    fetchSessionPage.mockRejectedValue(new Error("offline"));
    const input = props();
    render(<AppSidebar {...input} />);
    const fallback = await screen.findByRole("button", { name: /Chats unavailable/i });
    fireEvent.click(fallback);
    expect(input.onOpenAllChats).toHaveBeenCalledOnce();
  });
});
