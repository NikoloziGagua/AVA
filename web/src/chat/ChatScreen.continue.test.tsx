// @vitest-environment jsdom
// One conversation (contract one-conversation v1, Phase A). Talk with nothing
// remembered never guesses the conversation: its first send asks the server to
// continue the latest one (I1 `continue`), then shows what came before that
// turn exactly once, never duplicating or dropping the turn or its reply.
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

import { TalkScreen } from "./TalkScreen.test-helper.js";
import { rowsBeforeTurn } from "./ChatScreen.js";
import type { SessionMessage } from "../api.js";

class FakeEventSource {
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

const noNav = { onOpenSessions: () => {}, onOpenRules: () => {}, onOpenMemory: () => {} };
const row = (id: number, role: string, content: string, extra: Partial<SessionMessage> = {}): SessionMessage =>
  ({ id, role, content, created_at: Date.parse("2026-09-28T09:00:00Z") + id, ...extra });
const session = (id: string) => ({ id, title: "t", created_at: 0, updated_at: 0, status: "idle", pinned: 0, origin: "human" });
const continued = (id: string) => ({ sessionId: id, taskId: "run-1", binding: { version: 1, sessionId: id, origin: "human", resolution: "continued" } });

async function typeAndSend(text: string) {
  const ta = await screen.findByRole("textbox", { name: "Message AVA" });
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.keyDown(ta, { key: "Enter" });
}
const bodyText = () => document.body.textContent ?? "";
const occurrences = (needle: string) => bodyText().split(needle).length - 1;

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

describe("rowsBeforeTurn (exact accepted-turn identity)", () => {
  const rows = [row(1, "user", "hi"), row(2, "assistant", "hello"), row(3, "user", "hi"), row(4, "assistant", "again")];
  it("keeps only the rows before the accepted row, even when the same words repeat", () => {
    expect(rowsBeforeTurn(rows, 3)!.map((r) => r.id)).toEqual([1, 2]);
    expect(rowsBeforeTurn(rows, 1)!.map((r) => r.id)).toEqual([]);
  });
  it("prepends nothing when the identity is missing, invalid, duplicated or not a user row", () => {
    expect(rowsBeforeTurn(rows, null)).toBeNull();
    expect(rowsBeforeTurn(rows, undefined)).toBeNull();
    expect(rowsBeforeTurn(rows, 99)).toBeNull();
    expect(rowsBeforeTurn(rows, 2)).toBeNull(); // an assistant row
    expect(rowsBeforeTurn([row(3, "user", "a"), row(3, "user", "b")], 3)).toBeNull(); // duplicate ids
  });
});

describe("Talk with nothing remembered", () => {
  it("says it continues, and sends, fetches or selects nothing until Nika sends", async () => {
    const onSessionChange = vi.fn();
    render(<TalkScreen sessionId={null} continueLatest {...noNav} onSessionChange={onSessionChange} />);
    expect(await screen.findByText("Your next message continues your most recent conversation.")).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fetchSession).not.toHaveBeenCalled();
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it("asks the server to continue, then shows what came before the accepted row once", async () => {
    const onSessionChange = vi.fn();
    sendMessage.mockResolvedValue({ ...continued("latest-4"), userMessageId: 3 });
    fetchSession.mockResolvedValue({
      session: session("latest-4"),
      messages: [
        row(1, "user", "earlier question", { metadata: { inputModality: "voice" } }),
        row(2, "assistant", "earlier answer"),
        row(3, "user", "plan my week"),
        row(4, "assistant", "fast reply already stored"),
      ],
    });
    render(<TalkScreen sessionId={null} continueLatest {...noNav} onSessionChange={onSessionChange} />);
    await typeAndSend("plan my week");

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    const [sid, , opts] = sendMessage.mock.calls[0]!;
    expect(sid).toBeNull();
    expect(opts).toMatchObject({ conversationIntent: "continue" });
    expect(opts.bindingRequestId).toBeUndefined();

    await screen.findByText("earlier answer");
    expect(fetchSession).toHaveBeenCalledWith("latest-4");
    expect(onSessionChange).toHaveBeenCalledWith("latest-4");
    expect(occurrences("earlier question")).toBe(1);
    expect(occurrences("plan my week")).toBe(1);
    expect(bodyText().indexOf("earlier question")).toBeLessThan(bodyText().indexOf("plan my week"));
    expect(bodyText()).not.toContain("fast reply already stored");
    expect(screen.getByText("Said")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSession).toHaveBeenCalledTimes(1);
  });

  it("a delayed history holding a later identical turn never duplicates or reorders the current turn", async () => {
    sendMessage.mockResolvedValue({ ...continued("latest-4"), userMessageId: 3 });
    fetchSession.mockResolvedValue({
      session: session("latest-4"),
      messages: [
        row(1, "user", "plan my week"),
        row(2, "assistant", "earlier answer"),
        row(3, "user", "plan my week"), // the accepted turn
        row(4, "assistant", "reply"),
        row(5, "user", "plan my week"), // a later identical turn from elsewhere
      ],
    });
    render(<TalkScreen sessionId={null} continueLatest {...noNav} />);
    await typeAndSend("plan my week");
    await screen.findByText("earlier answer");
    // One earlier copy (row 1) plus the current turn; row 5 is never shown.
    expect(occurrences("plan my week")).toBe(2);
  });

  it.each([
    ["missing (older server)", undefined],
    ["null", null],
    ["not in the history", 99],
  ])("shows an honest note and no guessed history when the accepted identity is %s", async (_label, id) => {
    sendMessage.mockResolvedValue({ ...continued("latest-4"), ...(id === undefined ? {} : { userMessageId: id }) });
    fetchSession.mockResolvedValue({ session: session("latest-4"), messages: [row(1, "user", "old"), row(2, "user", "plan my week")] });
    render(<TalkScreen sessionId={null} continueLatest {...noNav} />);
    await typeAndSend("plan my week");
    await screen.findByText(/be shown safely/);
    expect(bodyText()).not.toContain("old");
    expect(occurrences("plan my week")).toBe(1);
    expect(screen.getByRole("button", { name: "Reload conversation" })).toBeTruthy();
  });

  it("rejects history that belongs to a different session", async () => {
    sendMessage.mockResolvedValue({ ...continued("latest-4"), userMessageId: 3 });
    fetchSession.mockResolvedValue({ session: session("someone-else"), messages: [row(1, "user", "stranger"), row(3, "user", "plan my week")] });
    render(<TalkScreen sessionId={null} continueLatest {...noNav} />);
    await typeAndSend("plan my week");
    await screen.findByText(/be shown safely/);
    expect(bodyText()).not.toContain("stranger");
  });

  it("fetches nothing when continuing created a conversation", async () => {
    sendMessage.mockResolvedValue({ sessionId: "fresh-1", userMessageId: 1, binding: { version: 1, sessionId: "fresh-1", origin: "human", resolution: "created" } });
    render(<TalkScreen sessionId={null} continueLatest {...noNav} />);
    await typeAndSend("first ever");
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSession).not.toHaveBeenCalled();
    expect(occurrences("first ever")).toBe(1);
  });

  it("drops earlier messages that arrive after the screen moved to another conversation", async () => {
    let finish!: (value: unknown) => void;
    sendMessage.mockResolvedValue({ ...continued("latest-4"), userMessageId: 3 });
    fetchSession.mockImplementation((id: string) => id === "latest-4"
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ session: session(id), messages: [row(9, "user", "other conversation")] }));
    const view = render(<TalkScreen sessionId={null} continueLatest {...noNav} />);
    await typeAndSend("plan my week");
    await waitFor(() => expect(fetchSession).toHaveBeenCalledWith("latest-4"));

    view.rerender(<TalkScreen sessionId="other-9" continueLatest {...noNav} />);
    await screen.findByText("other conversation");
    finish({ session: session("latest-4"), messages: [row(1, "user", "stale earlier"), row(3, "user", "plan my week")] });
    await new Promise((r) => setTimeout(r, 20));
    expect(bodyText()).not.toContain("stale earlier");
  });

  it("keeps the turn when fetching earlier messages fails", async () => {
    sendMessage.mockResolvedValue({ ...continued("latest-4"), userMessageId: 3 });
    fetchSession.mockRejectedValue(new Error("offline"));
    render(<TalkScreen sessionId={null} continueLatest {...noNav} />);
    await typeAndSend("plan my week");
    await screen.findByText(/be shown safely/);
    expect(occurrences("plan my week")).toBe(1);
  });
});

describe("Talk header", () => {
  it("offers New topic and History, and a fresh topic says nothing about continuing", async () => {
    const onNewChat = vi.fn();
    const onOpenList = vi.fn();
    render(<TalkScreen sessionId={null} {...noNav} onNewChat={onNewChat} onOpenList={onOpenList} />);
    expect(await screen.findByText("What's on your mind?")).toBeTruthy();
    expect(screen.queryByText(/continues your most recent conversation/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New topic" }));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onNewChat).toHaveBeenCalledOnce();
    expect(onOpenList).toHaveBeenCalledOnce();
  });
});
