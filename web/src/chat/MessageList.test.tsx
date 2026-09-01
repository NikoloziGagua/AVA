// @vitest-environment jsdom
// Rendering rules for the conversation: Retry only on the LAST assistant
// bubble, safe rich Markdown for AVA only, and an honest event-gap notice.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MessageList, type ChatMessage } from "./MessageList.js";
import type { TaskReceipt } from "./task-receipt.js";
import type { StreamEvent } from "./useChatStream.js";
import type { MemoryContext } from "./memory-context.js";

beforeEach(() => {
  // jsdom has no scrollIntoView; the list autoscrolls on every append.
  Element.prototype.scrollIntoView = vi.fn();
  // Static rendering: reduced motion avoids unrelated bubble transitions.
  localStorage.setItem("ava-motion", "reduced");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => cleanup());

const history: ChatMessage[] = [
  { id: "u1", role: "user", text: "q1" },
  { id: "a1", role: "assistant", text: "first reply" },
  { id: "u2", role: "user", text: "q2" },
  { id: "a2", role: "assistant", text: "Average: **0ms**, Sir." },
];

const usedMemory: MemoryContext = {
  schemaVersion: 1,
  status: "used",
  reason: "A source-verified project checkpoint matched this turn.",
  project: "Aurora",
  mode: "hybrid",
  semanticAvailable: true,
  notice: null,
  selected: [{
    entryId: "memory_checkpoint_01",
    title: "Aurora observation plan",
    kind: "idea",
    project: "Aurora",
    sourceStatus: "verified",
    matchMode: "hybrid",
    matchReason: "Matched the project and observation-plan terms.",
    sourceTruncated: false,
  }],
};

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

  it("renders assistant Markdown semantically while user text stays literal", () => {
    render(<MessageList history={history} liveEvents={[]} />);
    expect(screen.getByText("0ms").tagName).toBe("STRONG");
    expect(screen.queryByText("Average: **0ms**, Sir.")).toBeNull();

    cleanup();
    render(<MessageList history={[{ id: "u-md", role: "user", text: "Keep **these markers** literal" }]} liveEvents={[]} />);
    expect(screen.getByText("Keep **these markers** literal")).toBeTruthy();
    expect(screen.queryByText("these markers")).toBeNull();
  });

  it("keeps exact text entered in voice visibly distinguishable after reload", () => {
    render(<MessageList history={[
      { id: "u-exact", role: "user", text: "@Exact_Name", inputSource: "voice_exact_text" },
    ]} liveEvents={[]} />);
    expect(screen.getByText("@Exact_Name")).toBeTruthy();
    expect(screen.getByText("Exact text · entered in voice")).toBeTruthy();
  });

  it("copies the original Markdown source rather than flattened display text", () => {
    render(<MessageList history={history} liveEvents={[]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[1]!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Average: **0ms**, Sir.");
  });

  it("renders rich Markdown in the live final and a stopped partial stream", () => {
    const finalEvents: StreamEvent[] = [
      { id: 1, runEpoch: 1, kind: "final", payload: { text: "## Result\n\n- **Passed**\n- Inspectable" } },
    ];
    const { rerender } = render(<MessageList history={[]} liveEvents={finalEvents} />);
    expect(screen.getByRole("heading", { level: 3, name: "Result" })).toBeTruthy();
    expect(screen.getByText("Passed").tagName).toBe("STRONG");

    const stoppedEvents: StreamEvent[] = [
      { id: 2, runEpoch: 2, kind: "delta", payload: { text: "### Partial\n\n- one" } },
      { id: 3, runEpoch: 2, kind: "killed", payload: {} },
    ];
    rerender(<MessageList history={[]} liveEvents={stoppedEvents} />);
    expect(screen.getByTestId("stopped-partial").querySelector('[data-partial="true"]')).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Partial" })).toBeTruthy();
  });

  it("renders an honest event-gap notice (the Sessions screen is unreachable)", () => {
    const liveEvents: StreamEvent[] = [
      { id: 7, runEpoch: 1, kind: "gap", payload: { from: 2, to: 4 } },
    ];
    render(<MessageList history={[]} liveEvents={liveEvents} />);
    expect(screen.getByText(/missed 3 live events — reopen this chat to refresh/)).toBeTruthy();
    expect(screen.queryByText(/Sessions/)).toBeNull();
  });

  it("renders the newest task receipt once inside the conversation", () => {
    const receipt: TaskReceipt = {
      schemaVersion: 1,
      taskId: "task-chat-1",
      expected: "Answer the question",
      actual: "AVA delivered the requested conversational response; no external action was claimed.",
      lifecycle: "finished",
      outcome: "verified",
      verificationScope: "response_delivery",
      lastVerifiedStage: "The final response reached this conversation.",
      observationPoint: null,
      rootCause: "not_applicable",
      recoveryAction: null,
      evidence: [],
      toolCalls: 0,
      successfulToolResults: 0,
      uncertainToolResults: 0,
      failedToolResults: 0,
      startedAt: 1_000,
      updatedAt: 2_000,
      durationMs: 1_000,
    };
    const liveEvents: StreamEvent[] = [
      { id: 8, runEpoch: 1, kind: "receipt", payload: receipt },
      { id: 9, runEpoch: 1, kind: "receipt", payload: { ...receipt, updatedAt: 2_100 } },
    ];

    render(<MessageList history={history} liveEvents={liveEvents} />);
    expect(screen.getAllByTestId("task-receipt")).toHaveLength(1);
    expect(screen.getByText("Verified")).toBeTruthy();
  });

  it("renders a collapsed source-aware memory receipt for persisted and live replies", () => {
    const { rerender } = render(<MessageList history={[
      { id: "a-memory", role: "assistant", text: "Use the inland fallback.", memoryContext: usedMemory },
    ]} liveEvents={[]} />);
    const persisted = screen.getByTestId("memory-context");
    expect(persisted.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Memory used · 1 source")).toBeTruthy();
    expect(screen.getByText("Aurora observation plan")).toBeTruthy();
    expect(screen.getByText(/never the private source text/i)).toBeTruthy();

    rerender(<MessageList history={[]} liveEvents={[
      { id: 1, runEpoch: 2, kind: "memory_context", payload: { ...usedMemory, status: "no_match", selected: [], reason: "No relevant source-verified memory matched." } },
      { id: 2, runEpoch: 2, kind: "final", payload: { text: "A clean answer." } },
    ]} />);
    expect(screen.getByText("No relevant memory used")).toBeTruthy();
    expect(screen.getAllByTestId("memory-context")).toHaveLength(1);
  });
});
