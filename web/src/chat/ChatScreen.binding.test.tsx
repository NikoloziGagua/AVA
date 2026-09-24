// @vitest-environment jsdom
// Conversation binding (contract i1-conversation-binding): a chat is either a
// deliberate new conversation (idempotent by a one-time key), an exact resume,
// or an automated run shown for reference. A missing conversation is never
// silently replaced, and the words Nika typed are never lost.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const fetchSession = vi.fn();
const sendMessage = vi.fn();
vi.mock("../api.js", () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, message: string, code = `http_${status}`) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    fetchSession: (...a: unknown[]) => fetchSession(...a),
    fetchSuggestedChips: () => Promise.resolve([]),
    approveApproval: () => Promise.resolve(),
    denyApproval: () => Promise.resolve(),
    api: {
      sendMessage: (...a: unknown[]) => sendMessage(...a),
      killAll: () => Promise.resolve({ aborted: true }),
    },
  };
});

import { ChatScreen } from "./ChatScreen.js";
import { ApiError } from "../api.js";

class FakeEventSource {
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

const noNav = { onOpenSessions: () => {}, onOpenRules: () => {}, onOpenMemory: () => {} };
const unavailableError = () => new (ApiError as unknown as new (s: number, m: string, c: string) => Error)(
  404,
  "This conversation is unavailable.",
  "session_unavailable",
);

async function typeAndSend(text: string) {
  const ta = await screen.findByPlaceholderText("Message Ava…");
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.keyDown(ta, { key: "Enter" });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  Element.prototype.scrollIntoView = vi.fn();
  (SVGElement.prototype as unknown as { getTotalLength: () => number }).getTotalLength = () => 0;
  localStorage.setItem("ava-motion", "reduced");
  fetchSession.mockReset();
  sendMessage.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatScreen conversation binding", () => {
  it("creates one new conversation, reusing its key when the first send is retried", async () => {
    const onSessionChange = vi.fn();
    sendMessage
      .mockRejectedValueOnce(new ApiError(0, "offline"))
      .mockResolvedValueOnce({
        sessionId: "created-1",
        binding: { version: 1, sessionId: "created-1", origin: "human", resolution: "created" },
      });
    render(<ChatScreen sessionId={null} {...noNav} onSessionChange={onSessionChange} />);

    await typeAndSend("plan my week");
    await screen.findByText(/didn't send/i);
    await typeAndSend("plan my week");
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));

    const [firstSid, , firstOpts] = sendMessage.mock.calls[0]!;
    const [, , secondOpts] = sendMessage.mock.calls[1]!;
    expect(firstSid).toBeNull();
    expect(firstOpts).toMatchObject({ conversationIntent: "new" });
    expect(firstOpts.bindingRequestId).toMatch(/^[0-9a-f]{32}$/);
    expect(secondOpts.bindingRequestId).toBe(firstOpts.bindingRequestId);
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith("created-1"));
  });

  it("resumes the exact requested conversation, even before it finishes loading", async () => {
    fetchSession.mockReturnValue(new Promise(() => {})); // still hydrating
    sendMessage.mockResolvedValue({ sessionId: "exact-7" });
    render(<ChatScreen sessionId="exact-7" {...noNav} />);

    await typeAndSend("one more thing");
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const [sid, , opts] = sendMessage.mock.calls[0]!;
    expect(sid).toBe("exact-7");
    expect(opts).toMatchObject({ conversationIntent: "resume" });
    expect(opts.bindingRequestId).toBeUndefined();
  });

  it("selects an opened conversation Nika can talk in, older unclassified ones included", async () => {
    const onSessionChange = vi.fn();
    fetchSession.mockResolvedValue({
      session: { id: "legacy-1", title: "t", created_at: 0, updated_at: 0, status: "idle", pinned: 0, origin: "unknown" },
      messages: [],
    });
    render(<ChatScreen sessionId="legacy-1" {...noNav} onSessionChange={onSessionChange} />);
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith("legacy-1"));
  });

  it("shows an automated run read-only and never selects it", async () => {
    const onSessionChange = vi.fn();
    fetchSession.mockResolvedValue({
      session: { id: "auto-1", title: "Watch run", created_at: 0, updated_at: 0, status: "idle", pinned: 0, origin: "automation" },
      messages: [{ id: 1, role: "user", content: "[SCHEDULED WATCH CHECK]", created_at: 0 }],
    });
    render(<ChatScreen sessionId="auto-1" {...noNav} onSessionChange={onSessionChange} onNewChat={() => {}} />);

    expect(await screen.findByRole("note")).toBeTruthy();
    expect(screen.getByText(/automated run AVA did on its own/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Message Ava…")).toBeNull();
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("opens anything for reference without selecting it when asked to audit", async () => {
    const onSessionChange = vi.fn();
    fetchSession.mockResolvedValue({
      session: { id: "legacy-watch", title: "t", created_at: 0, updated_at: 0, status: "idle", pinned: 0, origin: "unknown" },
      messages: [],
    });
    render(<ChatScreen sessionId="legacy-watch" audit {...noNav} onSessionChange={onSessionChange} />);
    expect(await screen.findByRole("note")).toBeTruthy();
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("explains an unavailable conversation and offers choices instead of switching", async () => {
    const onSessionUnavailable = vi.fn();
    const onNewChat = vi.fn();
    fetchSession.mockRejectedValue(unavailableError());
    render(
      <ChatScreen
        sessionId="deleted-3"
        {...noNav}
        onSessionUnavailable={onSessionUnavailable}
        onNewChat={onNewChat}
        onOpenList={() => {}}
      />,
    );

    expect(await screen.findByText("This conversation is unavailable.")).toBeTruthy();
    expect(onSessionUnavailable).toHaveBeenCalledWith("deleted-3");
    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Your conversations" })).toBeTruthy();
  });

  it("ignores a send answered after Nika left the conversation", async () => {
    const onSessionChange = vi.fn();
    const onSessionUnavailable = vi.fn();
    let answer!: (value: unknown) => void;
    sendMessage.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const view = render(
      <ChatScreen
        sessionId={null}
        {...noNav}
        onSessionChange={onSessionChange}
        onSessionUnavailable={onSessionUnavailable}
      />,
    );
    await typeAndSend("draft for A");
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));

    // Navigation to another conversation unmounts this screen before A answers.
    view.unmount();
    answer({ sessionId: "late-A", binding: { version: 1, sessionId: "late-A", origin: "human", resolution: "created" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSessionChange).not.toHaveBeenCalled();
    expect(onSessionUnavailable).not.toHaveBeenCalled();
  });

  it("keeps the typed words when a send finds the conversation gone", async () => {
    const onSessionUnavailable = vi.fn();
    fetchSession.mockResolvedValue({
      session: { id: "s9", title: "t", created_at: 0, updated_at: 0, status: "idle", pinned: 0, origin: "human" },
      messages: [],
    });
    sendMessage.mockRejectedValue(unavailableError());
    render(<ChatScreen sessionId="s9" {...noNav} onSessionUnavailable={onSessionUnavailable} onNewChat={() => {}} />);

    await typeAndSend("remember the exam on Monday");
    expect(await screen.findByText("This conversation is unavailable.")).toBeTruthy();
    expect(onSessionUnavailable).toHaveBeenCalledWith("s9");
    const box = screen.getByPlaceholderText("Message Ava…") as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("remember the exam on Monday"));
  });
});
