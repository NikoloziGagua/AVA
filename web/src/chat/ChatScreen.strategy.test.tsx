// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  sendMessage: vi.fn(),
  kill: vi.fn(),
  events: [] as Array<Record<string, any>>,
}));

vi.mock("../api.js", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  api: { sendMessage: mocks.sendMessage, kill: mocks.kill },
  fetchSession: mocks.fetchSession,
}));
vi.mock("./useChatStream.js", () => ({ useChatStream: () => ({ events: mocks.events }) }));
vi.mock("./MessageList.js", () => ({
  MessageList: ({ history }: { history: Array<{ text: string }> }) => <div>{history.map((message) => message.text).join(" | ")}</div>,
}));
vi.mock("./Composer.js", () => ({ Composer: () => <div>composer</div> }));
vi.mock("../components/ava/FlowingLines.js", () => ({ FlowingLines: () => null }));
vi.mock("../components/ava/EdgeFade.js", () => ({ EdgeFade: () => null }));
vi.mock("./ActivityPanel.js", () => ({ ActivityPanel: () => null }));
vi.mock("./activity-steps.js", () => ({
  deriveSteps: () => [],
  isExecuting: () => false,
  currentTool: () => null,
}));
vi.mock("../lib/media.js", () => ({ isSmallScreen: () => false }));
vi.mock("motion/react", () => ({
  motion: { div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

import { ChatScreen } from "./ChatScreen.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.events = [];
});

describe("ChatScreen Strategy Room handoff", () => {
  it("offers the linked room only after a real chat is loaded", async () => {
    mocks.fetchSession.mockResolvedValue({
      session: { id: "chat-17" },
      messages: [
        { id: 1, role: "user", content: "Let's decide together", created_at: 1 },
        { id: 2, role: "assistant", content: "We can bring in Codex.", created_at: 2 },
      ],
    });
    const openRoom = vi.fn();

    render(
      <ChatScreen
        sessionId="chat-17"
        onOpenSessions={() => {}}
        onOpenRules={() => {}}
        onOpenMemory={() => {}}
        onOpenStrategy={openRoom}
      />,
    );

    const button = await screen.findByRole("button", { name: "Take to Room" });
    fireEvent.click(button);
    await waitFor(() => expect(openRoom).toHaveBeenCalledWith("chat-17"));
  });

  it("opens the Room after AVA's natural-language handoff tool succeeds", async () => {
    mocks.fetchSession.mockResolvedValue({
      session: { id: "chat-17" },
      messages: [{ id: 1, role: "user", content: "Take this to the Room", created_at: 1 }],
    });
    mocks.events = [{
      id: 8,
      runEpoch: 0,
      kind: "tool_result",
      payload: { tool: "strategy_room_open", ok: true, result: "room_1" },
    }];
    const openRoom = vi.fn();

    render(
      <ChatScreen
        sessionId="chat-17"
        onOpenSessions={() => {}}
        onOpenRules={() => {}}
        onOpenMemory={() => {}}
        onOpenStrategy={openRoom}
      />,
    );

    await waitFor(() => expect(openRoom).toHaveBeenCalledTimes(1));
    expect(openRoom).toHaveBeenCalledWith("chat-17");
  });
});
