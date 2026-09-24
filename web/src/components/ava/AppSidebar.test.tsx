// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Brain, MessageSquareText, Radar, Sun } from "lucide-react";

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
      { name: "Today", label: "Today", icon: Sun, group: "primary", onSelect: vi.fn() },
      { name: "Talk", label: "Talk", icon: MessageSquareText, group: "primary", onSelect: vi.fn() },
      { name: "Explore", label: "Explore AVA", icon: Radar, group: "system", onSelect: vi.fn() },
      { name: "Memory", label: "Memory", icon: Brain, group: "system", onSelect: vi.fn() },
    ],
    activeName: "Talk",
    visible: true,
    expanded: true,
    activeChatSessionId: "current",
    onExpandedChange: vi.fn(),
    onNewChat: vi.fn(),
    onOpenChat: vi.fn(),
    onOpenAllChats: vi.fn(),
    ...overrides,
  };
}

function setNarrow(narrow: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: narrow && query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("AppSidebar", () => {
  beforeEach(() => {
    fetchSessionPage.mockReset().mockResolvedValue({ sessions, nextCursor: null });
    setNarrow(false);
  });
  afterEach(cleanup);

  it("shows everyday destinations and keeps the current conversation first", async () => {
    const input = props();
    render(<AppSidebar {...input} />);
    expect(screen.getByRole("button", { name: "Talk" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(screen.getByText("Current design discussion")).toBeTruthy());
    const chatButtons = screen.getAllByRole("button").filter((node) => node.classList.contains("ava-sidebar-chat"));
    expect(chatButtons[0]?.textContent).toContain("Current design discussion");
    fireEvent.click(screen.getByText("Newest other chat"));
    expect(input.onOpenChat).toHaveBeenCalledWith("newest");
  });

  it("asks only for Nika's own bounded conversations", async () => {
    render(<AppSidebar {...props()} />);
    await waitFor(() => expect(fetchSessionPage).toHaveBeenCalledWith({ scope: "human", limit: 8 }));
  });

  it("keeps AVA's own tools under a System group that opens on demand", () => {
    const input = props();
    render(<AppSidebar {...input} />);
    expect(screen.queryByRole("button", { name: "Explore AVA" })).toBeNull();
    const system = screen.getByRole("button", { name: "System" });
    expect(system.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(system);
    expect(system.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Explore AVA" }));
    expect(input.items[2]!.onSelect).toHaveBeenCalledOnce();
  });

  it("opens the System group when a system destination is the current one", () => {
    render(<AppSidebar {...props({ activeName: "Memory" })} />);
    expect(screen.getByRole("button", { name: "Memory" }).getAttribute("aria-current")).toBe("page");
  });

  it("expands the compact rail onto the System group", () => {
    const input = props({ expanded: false });
    render(<AppSidebar {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(input.onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("closes the expanded drawer after a choice on a narrow screen", () => {
    setNarrow(true);
    const input = props();
    render(<AppSidebar {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(input.items[0]!.onSelect).toHaveBeenCalledOnce();
    expect(input.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("closes the drawer after opening a conversation on a narrow screen", async () => {
    setNarrow(true);
    const input = props();
    render(<AppSidebar {...input} />);
    fireEvent.click(await screen.findByText("Newest other chat"));
    expect(input.onOpenChat).toHaveBeenCalledWith("newest");
    expect(input.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("keeps the drawer open after a choice on a wide screen", () => {
    const input = props();
    render(<AppSidebar {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(input.onExpandedChange).not.toHaveBeenCalled();
  });

  it("keeps the collapsed rail keyboard-accessible without rendering recent content", () => {
    const input = props({ expanded: false });
    render(<AppSidebar {...input} />);
    expect(screen.queryByText("Conversations")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(input.onExpandedChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(input.onNewChat).toHaveBeenCalledOnce();
  });

  it("removes hidden navigation from interaction without unmounting its state", () => {
    render(<AppSidebar {...props({ visible: false, expanded: true })} />);
    expect(screen.getByRole("complementary", { hidden: true }).hasAttribute("inert")).toBe(true);
  });

  it("closes an expanded overlay with Escape", () => {
    const input = props();
    render(<AppSidebar {...input} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(input.onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("degrades a history failure to an honest all-chats route", async () => {
    fetchSessionPage.mockRejectedValue(new Error("offline"));
    const input = props();
    render(<AppSidebar {...input} />);
    fireEvent.click(await screen.findByRole("button", { name: /Chats unavailable/i }));
    expect(input.onOpenAllChats).toHaveBeenCalledOnce();
  });
});
