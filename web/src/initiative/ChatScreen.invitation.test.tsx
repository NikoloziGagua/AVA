// AVA starts a conversation (contract ava-initiative): Talk shows her idea
// with its sources and three answers; a link whose pair does not match shows
// "no longer available" in place; opening an unanswered idea never moves the
// remembered conversation, and the first reply does.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ fetchSession: vi.fn(), sendMessage: vi.fn() }));
vi.mock("../api.js", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string, public code = `http_${status}`) { super(message); }
  }
  return {
    ApiError,
    fetchSession: (...args: unknown[]) => core.fetchSession(...args),
    fetchSuggestedChips: () => Promise.resolve([{ id: "c1", label: "Plan my week", prompt: "Plan my week" }]),
    approveApproval: () => Promise.resolve(),
    denyApproval: () => Promise.resolve(),
    api: {
      sendMessage: (...args: unknown[]) => core.sendMessage(...args),
      killAll: () => Promise.resolve({ aborted: true }),
    },
  };
});

const ideas = vi.hoisted(() => ({
  fetchInitiative: vi.fn(),
  markInitiativeOpened: vi.fn(),
  fetchInboxSessions: vi.fn(),
  setInitiativeDisposition: vi.fn(),
}));
vi.mock("./api.js", () => ({
  ...ideas,
  isInitiativeUnavailable: (error: unknown) => (error as { code?: string })?.code === "initiative_unavailable",
}));

import { TalkScreen } from "../chat/TalkScreen.test-helper.js";

class FakeEventSource {
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

const INVITATION = "Your landing page ideas and the pricing test answer each other.\n\nWant me to sketch that section into your Acme notes?";
const noNav = { onOpenSessions: () => {}, onOpenRules: () => {}, onOpenMemory: () => {} };

function session(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      id: "s_2", title: "Pricing test as proof", created_at: 1, updated_at: 1, status: "active", pinned: 0,
      origin: "assistant", last_human_activity_at: null, initiativeId: "ini_2", ...overrides,
    },
    messages: [{ id: 1, role: "assistant", content: INVITATION, created_at: 1 }],
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    id: "ini_2", sessionId: "s_2", title: "Pricing test as proof", reasonNow: "You saved new landing page ideas yesterday.",
    scope: { kind: "project", folderId: "f_acme", name: "Acme" }, publishedAt: 1, expiresAt: Date.now() + 86_400_000,
    openedAt: null, disposition: { state: "open", version: 1, updatedAt: 1 }, notification: { state: "accepted" },
    sources: [{ type: "note", id: "n_1", status: "current", title: "Landing page ideas" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  Element.prototype.scrollIntoView = vi.fn();
  (SVGElement.prototype as unknown as { getTotalLength: () => number }).getTotalLength = () => 0;
  localStorage.setItem("ava-motion", "reduced");
  for (const mock of [...Object.values(core), ...Object.values(ideas)]) mock.mockReset();
  ideas.markInitiativeOpened.mockResolvedValue(undefined);
  ideas.fetchInboxSessions.mockResolvedValue([
    { id: "s_1", initiativeId: "ini_1" },
    { id: "s_2", initiativeId: "ini_2" },
    { id: "s_3", initiativeId: "ini_3" },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Talk with one of AVA's ideas", () => {
  it("shows the idea with its sources and answers, without selecting the conversation", async () => {
    core.fetchSession.mockResolvedValue(session());
    ideas.fetchInitiative.mockResolvedValue(view());
    const onSessionChange = vi.fn();
    const onFocusComposer = vi.fn();
    const onOpenNote = vi.fn();
    const onOpenInvitation = vi.fn();
    const onInitiativeChange = vi.fn();
    render(
      <TalkScreen
        sessionId="s_2"
        initiativeId="ini_2"
        verifyInitiative
        {...noNav}
        onSessionChange={onSessionChange}
        onFocusComposer={onFocusComposer}
        onOpenNote={onOpenNote}
        onOpenInvitation={onOpenInvitation}
        onInitiativeChange={onInitiativeChange}
      />,
    );

    await screen.findByText(/answer each other/);
    await screen.findByRole("button", { name: "Let's talk" });
    expect(screen.getByText("You saved new landing page ideas yesterday.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Suggestions" })).toBeNull();
    expect(ideas.markInitiativeOpened).toHaveBeenCalledWith("ini_2");
    await waitFor(() => expect(onInitiativeChange).toHaveBeenCalled());

    await screen.findByText("Idea 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Older idea" }));
    expect(onOpenInvitation).toHaveBeenCalledWith({ sessionId: "s_3", initiativeId: "ini_3" });

    fireEvent.click(screen.getByRole("button", { name: "Open note: Landing page ideas" }));
    expect(onOpenNote).toHaveBeenCalledWith("n_1");
    fireEvent.click(screen.getByRole("button", { name: "Let's talk" }));
    expect(onFocusComposer).toHaveBeenCalledTimes(1);
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("treats the first reply as the answer: the conversation is selected and the panel goes", async () => {
    core.fetchSession.mockResolvedValue(session());
    ideas.fetchInitiative.mockResolvedValue(view({ openedAt: 5 }));
    core.sendMessage.mockResolvedValue({
      sessionId: "s_2", taskId: "t1",
      binding: { version: 1, sessionId: "s_2", origin: "assistant", resolution: "resumed_exact" },
    });
    const onSessionChange = vi.fn();
    const onInitiativeChange = vi.fn();
    render(<TalkScreen sessionId="s_2" initiativeId="ini_2" verifyInitiative {...noNav} onSessionChange={onSessionChange} onInitiativeChange={onInitiativeChange} />);
    await screen.findByRole("button", { name: "Let's talk" });

    const box = screen.getByRole("textbox", { name: "Message AVA" });
    fireEvent.change(box, { target: { value: "Yes, sketch it" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(core.sendMessage).toHaveBeenCalledWith("s_2", "Yes, sketch it", expect.objectContaining({ conversationIntent: "resume" })));
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith("s_2"));
    expect(onInitiativeChange).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Let's talk" })).toBeNull());
    // The matched pair is not re-checked: the conversation never blanks mid-reply.
    expect(screen.queryByText("Opening AVA's idea…")).toBeNull();
    expect(screen.getByText(/answer each other/)).toBeTruthy();
    expect(ideas.fetchInitiative).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop AVA" })).toBeTruthy();
  });

  it("says a link's idea is no longer available in place, and never lends it the bar", async () => {
    core.fetchSession.mockResolvedValue(session({ origin: "human", last_human_activity_at: 5, initiativeId: null }));
    ideas.fetchInitiative.mockResolvedValue(view({ sessionId: "s_other" }));
    const onSessionChange = vi.fn();
    const onNewConversation = vi.fn();
    render(<TalkScreen sessionId="s_2" initiativeId="ini_2" verifyInitiative {...noNav} onSessionChange={onSessionChange} onNewConversation={onNewConversation} />);

    await screen.findByText("This idea is no longer available.");
    expect(screen.queryByText(/answer each other/)).toBeNull();
    expect(onSessionChange).not.toHaveBeenCalled();

    const box = screen.getByRole("textbox", { name: "Message AVA" });
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onNewConversation).toHaveBeenCalledWith("hello");
    expect(core.sendMessage).not.toHaveBeenCalled();
  });

  it("never lends the bar to an idea it could not check", async () => {
    core.fetchSession.mockResolvedValue(session());
    ideas.fetchInitiative.mockRejectedValue({ code: "server_unreachable" });
    const onNewConversation = vi.fn();
    render(<TalkScreen sessionId="s_2" initiativeId="ini_2" verifyInitiative {...noNav} onNewConversation={onNewConversation} />);
    await screen.findByText("Couldn't open this idea.");
    const box = screen.getByRole("textbox", { name: "Message AVA" });
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(core.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects a link whose idea differs from the conversation's own", async () => {
    core.fetchSession.mockResolvedValue(session({ initiativeId: "ini_9" }));
    render(<TalkScreen sessionId="s_2" initiativeId="ini_2" verifyInitiative {...noNav} />);
    await screen.findByText("This idea is no longer available.");
    expect(ideas.fetchInitiative).not.toHaveBeenCalled();
  });

  it("leaves an ordinary conversation exactly as it was", async () => {
    core.fetchSession.mockResolvedValue(session({ origin: "human", last_human_activity_at: 5, initiativeId: null }));
    const onSessionChange = vi.fn();
    render(<TalkScreen sessionId="s_2" {...noNav} onSessionChange={onSessionChange} />);
    await screen.findByText(/answer each other/);
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith("s_2"));
    expect(ideas.fetchInitiative).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Let's talk" })).toBeNull();
    await screen.findByRole("group", { name: "Suggestions" });
  });
});
