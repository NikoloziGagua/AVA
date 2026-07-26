// @vitest-environment jsdom
// Reopening a chat must restore the full transcript AND the live run state —
// the C1 regression rendered an empty conversation mid-run and only the last
// exchange (duplicated) on finished chats.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

// Mock the api module (everything the ChatScreen tree touches) so the screen
// mounts without real network in jsdom.
const fetchSession = vi.fn();
const sendMessage = vi.fn();
const kill = vi.fn();
vi.mock("../api.js", () => {
  // Mirror the real ApiError so ChatScreen's `e instanceof ApiError` 401
  // special-case works against the mocked module.
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
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
      kill: (...a: unknown[]) => kill(...a),
    },
  };
});

import { ChatScreen } from "./ChatScreen.js";
import { ApiError } from "../api.js";

// Controllable EventSource stand-in: tests push the server's replayed/live SSE
// events through emit(), exactly the shape useChatStream listens for.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(kind: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(kind) ?? [];
    arr.push(fn);
    this.listeners.set(kind, arr);
  }
  close() {
    this.closed = true;
  }
  emit(kind: string, payload: unknown, id: number) {
    for (const fn of this.listeners.get(kind) ?? []) {
      fn({ data: JSON.stringify(payload), lastEventId: String(id) } as MessageEvent);
    }
  }
}

function lastES(): FakeEventSource {
  const es = FakeEventSource.instances.at(-1);
  if (!es) throw new Error("no EventSource opened");
  return es;
}

const msg = (id: number, role: string, content: string) => ({ id, role, content, created_at: 0 });
const session = { id: "s1", title: "t", created_at: 0, updated_at: 0, status: "idle", pinned: 0 };
const noNav = { onOpenSessions: () => {}, onOpenRules: () => {}, onOpenMemory: () => {} };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  // jsdom has no scrollIntoView; MessageList autoscrolls on every append.
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom's SVG paths have no geometry; FlowingLines measures them on mount.
  (SVGElement.prototype as unknown as { getTotalLength: () => number }).getTotalLength = () => 0;
  // Force static rendering: WordReveal emits plain text (full-string matchable)
  // and MessageList skips its ScrollTriggers.
  localStorage.setItem("ava-motion", "reduced");
  fetchSession.mockReset();
  sendMessage.mockReset();
  kill.mockReset().mockResolvedValue({ aborted: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChatScreen reopen", () => {
  it("shows ALL persisted messages, with no duplicate final, on a finished chat", async () => {
    fetchSession.mockResolvedValue({
      session,
      messages: [
        msg(1, "user", "first question"),
        msg(2, "assistant", "first answer"),
        msg(3, "user", "second question"),
        msg(4, "assistant", "final answer, Sir."),
      ],
    });
    render(<ChatScreen sessionId="s1" {...noNav} />);

    // The full transcript renders — not just the last exchange.
    expect(await screen.findByText("first question")).toBeTruthy();
    expect(screen.getByText("first answer")).toBeTruthy();
    expect(screen.getByText("second question")).toBeTruthy();
    expect(screen.getByText("final answer, Sir.")).toBeTruthy();

    // The server replays a finished run as final (same text as the last
    // persisted assistant message) + done — no duplicate bubble may appear.
    act(() => {
      lastES().emit("final", { text: "final answer, Sir." }, 1);
      lastES().emit("done", {}, 2);
    });
    expect(screen.getAllByText("final answer, Sir.")).toHaveLength(1);
    expect(screen.queryByTestId("final-message")).toBeNull();
    // Finished run → not busy → the composer offers send, not stop.
    expect(screen.queryByRole("button", { name: "stop" })).toBeNull();
  });

  it("shows history + replayed live state + a working Stop when reopened MID-RUN", async () => {
    fetchSession.mockResolvedValue({
      session,
      messages: [msg(1, "user", "open notepad please")],
    });
    render(<ChatScreen sessionId="s1" {...noNav} />);
    expect(await screen.findByText("open notepad please")).toBeTruthy();

    // The server replays the in-flight run's events on stream connect.
    act(() => {
      lastES().emit("tool_call", { tool: "shell", args: { command: "notepad" } }, 1);
    });

    // Live state restored: the tool surfaces (chip / activity / caption)…
    expect(screen.getAllByText(/Running notepad/).length).toBeGreaterThan(0);
    // …and busy is stream-derived, so Stop renders and actually kills the run.
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    await waitFor(() => expect(kill).toHaveBeenCalledWith("s1"));

    // The run finishing flips busy off and promotes the new final exactly once.
    act(() => {
      lastES().emit("final", { text: "Notepad is open, Sir." }, 2);
      lastES().emit("done", {}, 3);
    });
    expect(screen.getAllByText("Notepad is open, Sir.")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "stop" })).toBeNull());
  });

  it("does NOT duplicate the final when a trailing `system` recovery row is present", async () => {
    // The known bug: recovery.ts appends a `system` "Server restarted…" row to a
    // mid-run session. The old dedupe took the last MAPPED-assistant bubble (that
    // system row), which never matched the server's strict latest-assistant replay
    // → the real final ("a2") got appended a second time.
    fetchSession.mockResolvedValue({
      session,
      messages: [
        msg(1, "user", "q1"),
        msg(2, "assistant", "a1 earlier reply"),
        msg(3, "user", "q2"),
        msg(4, "assistant", "a2 the real final"),
        msg(5, "system", "Server restarted; this task may have been interrupted. Send a new message to continue."),
      ],
    });
    render(<ChatScreen sessionId="s1" {...noNav} />);

    // Full transcript renders, including the real final and the system notice.
    expect(await screen.findByText("a2 the real final")).toBeTruthy();
    // The system row is a distinct notice, NOT attributed to Ava.
    expect(screen.getByText(/Server restarted/)).toBeTruthy();

    // The server replays the strict latest-assistant-after-last-user as `final`.
    act(() => {
      lastES().emit("final", { text: "a2 the real final" }, 1);
      lastES().emit("done", {}, 2);
    });

    // Deduped against the RAW-rule seed → the final is NOT re-rendered.
    expect(screen.getAllByText("a2 the real final")).toHaveLength(1);
    expect(screen.queryByTestId("final-message")).toBeNull();
  });
});

describe("ChatScreen send failure", () => {
  async function typeAndSend(text: string) {
    const ta = await screen.findByPlaceholderText("Message Ava…");
    fireEvent.change(ta, { target: { value: text } });
    fireEvent.keyDown(ta, { key: "Enter" });
  }

  it("recovers from a failed send instead of stranding an infinite spinner", async () => {
    sendMessage.mockRejectedValue(new ApiError(500, "boom"));
    render(<ChatScreen sessionId={null} {...noNav} />);

    await typeAndSend("hello there");
    // Optimistic user bubble appears immediately…
    expect(await screen.findByText("hello there")).toBeTruthy();
    // …then a visible assistant error bubble replaces the stuck spinner.
    expect(await screen.findByText(/didn't send/i)).toBeTruthy();
    // Pending cleared → composer offers send again, not an inert Stop.
    await waitFor(() => expect(screen.queryByRole("button", { name: "stop" })).toBeNull());
  });

  it("special-cases a 401 with a re-pair message", async () => {
    sendMessage.mockRejectedValue(new ApiError(401, "unauthorized"));
    render(<ChatScreen sessionId={null} {...noNav} />);

    await typeAndSend("are you there");
    expect(await screen.findByText(/re-pair this device/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "stop" })).toBeNull());
  });

  it("explains when the server has no LLM provider configured", async () => {
    sendMessage.mockRejectedValue(new ApiError(503, "no_llm_provider"));
    render(<ChatScreen sessionId={null} {...noNav} />);

    await typeAndSend("are you there");
    expect(await screen.findByText(/no AI provider is configured/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "stop" })).toBeNull());
  });
});
