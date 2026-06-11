// @vitest-environment jsdom
// Rendering rules for the conversation: Retry only on the LAST assistant
// bubble, markdown markers stripped for display, and an honest event-gap notice.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageList, type ChatMessage } from "./MessageList.js";
import type { StreamEvent } from "./useChatStream.js";

beforeEach(() => {
  // jsdom has no scrollIntoView; the list autoscrolls on every append.
  Element.prototype.scrollIntoView = vi.fn();
  // Static rendering: WordReveal emits plain text, no ScrollTriggers.
  localStorage.setItem("ava-motion", "reduced");
});

afterEach(() => cleanup());

const history: ChatMessage[] = [
  { id: "u1", role: "user", text: "q1" },
  { id: "a1", role: "assistant", text: "first reply" },
  { id: "u2", role: "user", text: "q2" },
  { id: "a2", role: "assistant", text: "Average: **0ms**, Sir." },
];

describe("MessageList", () => {
  it("renders Retry only on the LAST assistant bubble", () => {
    render(<MessageList history={history} liveEvents={[]} onRetry={() => {}} />);
    // One Retry (it re-runs the LAST turn), but Copy on every assistant bubble.
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(2);
  });

  it("moves Retry to the live final when one is streaming", () => {
    const liveEvents: StreamEvent[] = [
      { id: 1, runEpoch: 1, kind: "final", payload: { text: "fresh reply" } },
    ];
    render(<MessageList history={history} liveEvents={liveEvents} onRetry={() => {}} />);
    const retries = screen.getAllByRole("button", { name: "Retry" });
    expect(retries).toHaveLength(1);
    expect(screen.getByTestId("final-message").contains(retries[0]!)).toBe(true);
  });

  it("strips markdown markers from displayed assistant text", () => {
    render(<MessageList history={history} liveEvents={[]} />);
    expect(screen.getByText("Average: 0ms, Sir.")).toBeTruthy();
    expect(screen.queryByText("Average: **0ms**, Sir.")).toBeNull();
  });

  it("renders an honest event-gap notice (the Sessions screen is unreachable)", () => {
    const liveEvents: StreamEvent[] = [
      { id: 7, runEpoch: 1, kind: "gap", payload: { from: 2, to: 4 } },
    ];
    render(<MessageList history={[]} liveEvents={liveEvents} />);
    expect(screen.getByText(/missed 3 live events — reopen this chat to refresh/)).toBeTruthy();
    expect(screen.queryByText(/Sessions/)).toBeNull();
  });
});
