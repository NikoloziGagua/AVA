// @vitest-environment jsdom
// Talk on the new design (contract ui-remodel v2 §7): the island says what AVA
// is doing, her steps open in a sheet instead of crowding the conversation, and
// the conversation shows only what Niko needs to read.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup, waitFor, within } from "@testing-library/react";

const fetchSession = vi.fn();

vi.mock("../api.js", () => {
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
    api: { sendMessage: vi.fn(), killAll: vi.fn(async () => ({ aborted: true })) },
  };
});
vi.mock("../design/face/FaceStill.js", () => ({ FaceStill: () => <span data-testid="face-still" /> }));

import { TalkScreen } from "./TalkScreen.test-helper.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  addEventListener(kind: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), fn]);
  }
  close() {}
  emit(kind: string, payload: unknown, id: number) {
    for (const fn of this.listeners.get(kind) ?? []) fn({ data: JSON.stringify(payload), lastEventId: String(id) } as MessageEvent);
  }
}
function stream(): FakeEventSource {
  const es = FakeEventSource.instances.at(-1);
  if (!es) throw new Error("no EventSource opened");
  return es;
}
const noNav = { onOpenSessions: () => {}, onOpenRules: () => {}, onOpenMemory: () => {} };
const island = () => document.querySelector<HTMLElement>(".ds-island")!;

function reopen(messages: Array<{ id: number; role: string; content: string }>) {
  fetchSession.mockResolvedValue({
    session: { id: "s1", title: "t", created_at: 0, updated_at: 0, status: "idle", pinned: 0, origin: "human" },
    messages: messages.map((m) => ({ ...m, created_at: 0 })),
  });
  render(<TalkScreen sessionId="s1" {...noNav} />);
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  Element.prototype.scrollIntoView = vi.fn();
  fetchSession.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Talk", () => {
  it("greets a new conversation with AVA's face instead of an empty page", () => {
    render(<TalkScreen sessionId={null} {...noNav} />);
    expect(screen.getByTestId("face-still")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "What's on your mind?" })).toBeTruthy();
    expect(island().textContent).toContain("AVA");
  });

  it("shows Niko's words in a bubble with their line breaks, and AVA's reply as plain text", async () => {
    reopen([{ id: 1, role: "user", content: "line one\nline two" }, { id: 2, role: "assistant", content: "Here you go." }]);
    const mine = await screen.findByText(/line one/);
    expect(mine.textContent).toBe("line one\nline two");
    expect(mine.className).toMatch(/whitespace-pre-wrap/);
    const reply = screen.getByText("Here you go.").closest("article");
    expect(reply).toBeTruthy();
    expect(reply!.className).not.toMatch(/bg-/);
  });

  it("names the running step in the island and keeps successful steps out of the conversation", async () => {
    reopen([{ id: 1, role: "user", content: "check the repo" }]);
    await screen.findByText("check the repo");
    await waitFor(() => stream());
    act(() => { stream().emit("tool_call", { tool: "bash", args: { command: "git status" } }, 1); });
    expect(island().getAttribute("data-mode")).toBe("working");
    expect(island().textContent).toMatch(/Working/);
    await waitFor(() => stream());
    act(() => { stream().emit("tool_result", { tool: "bash", ok: true, result: "clean" }, 2); });
    expect(screen.queryByText(/failed/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show what AVA did: 1 step/ }));
    const sheet = screen.getByRole("dialog", { name: "What AVA did" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(1);
    expect(within(sheet).getByText("done")).toBeTruthy();
  });

  it("shows a failed step in the conversation, with its output one tap away", async () => {
    reopen([{ id: 1, role: "user", content: "read it" }]);
    await screen.findByText("read it");
    await waitFor(() => stream());
    act(() => {
      stream().emit("tool_call", { tool: "read_file", args: { path: "missing.md" } }, 1);
      stream().emit("tool_result", { tool: "read_file", ok: false, result: "ENOENT: missing.md" }, 2);
    });
    const failure = screen.getByRole("button", { name: /failed/ });
    expect(failure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(failure);
    expect(screen.getByText(/ENOENT: missing.md/)).toBeTruthy();
  });

  it("asks for Niko's attention while an approval is waiting", async () => {
    reopen([{ id: 1, role: "user", content: "send the email" }]);
    await screen.findByText("send the email");
    await waitFor(() => stream());
    act(() => {
      stream().emit("approval_required", {
        id: "ap1", tool: "send_email", args: {}, summary: "Send the email to the tutor",
        riskTier: "high", timeoutBehavior: "deny", requestedAt: Date.now(), deadlineAt: Date.now() + 60_000, timeoutMs: 60_000,
      }, 1);
    });
    expect(island().getAttribute("data-mode")).toBe("attention");
    await waitFor(() => stream());
    act(() => { stream().emit("approval_resolved", { id: "ap1", status: "denied" }, 2); });
    expect(island().getAttribute("data-mode")).not.toBe("attention");
  });
});
