// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  sendMessage: vi.fn(),
  kill: vi.fn(),
  fetchVisual: vi.fn(),
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
vi.mock("../visuals/api.js", () => ({ fetchVisualExplanation: mocks.fetchVisual }));
vi.mock("./MessageList.js", () => ({
  MessageList: ({ history, onVisualSemanticAction }: {
    history: Array<{ text: string; visualMessages?: Array<{ visualMessageId: string; revision: number; title: string }> }>;
    onVisualSemanticAction?: (context: any, visual: any) => void;
  }) => {
    const visual = history.flatMap((message) => message.visualMessages ?? [])[0];
    const context = visual ? { visualMessageId: visual.visualMessageId, revision: visual.revision, sceneId: "routeScene", selectedElementIds: ["route"] } : null;
    return <div>
      {history.map((message) => message.text).join(" | ")}
      <output data-testid="inline-visual-ids">{history.flatMap((message) => message.visualMessages ?? []).map((item) => `${item.visualMessageId}@${item.revision}`).join(",")}</output>
      {visual && context && <>
        <button onClick={() => onVisualSemanticAction?.({ ...context, action: "explain" }, visual)}>Mock explain visual</button>
        <button onClick={() => onVisualSemanticAction?.({ ...context, action: "attach" }, visual)}>Mock attach visual</button>
      </>}
    </div>;
  },
}));
vi.mock("./Composer.js", () => ({ Composer: ({ onSend }: { onSend: (text: string) => void }) => <button onClick={() => onSend("Follow up")}>Mock composer send</button> }));
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
import { visualFixture } from "../visuals/fixtures.test-helper.js";

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

  it("restores the exact inline visual revision from persisted conversation history", async () => {
    mocks.fetchSession.mockResolvedValue({
      session: { id: "chat-17" },
      messages: [{
        id: 2,
        role: "assistant",
        content: "The saved explanation.",
        created_at: 2,
        visualMessages: [{ ...visualFixture, visualMessageId: "visual_saved001", revision: 4 }],
        metadata: { visualMessages: [{ visualMessageId: "visual_saved001", revision: 4 }] },
      }],
    });

    render(
      <ChatScreen
        sessionId="chat-17"
        onOpenSessions={() => {}}
        onOpenRules={() => {}}
        onOpenMemory={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("inline-visual-ids").textContent).toBe("visual_saved001@4"));
    expect(mocks.fetchVisual).not.toHaveBeenCalled();
  });

  it("sends only explicit visual actions and holds attached context until submit", async () => {
    const savedVisual = { ...visualFixture, visualMessageId: "visual_saved001", revision: 4 };
    mocks.fetchSession.mockResolvedValue({
      session: { id: "chat-17" },
      messages: [{ id: 2, role: "assistant", content: "The saved explanation.", created_at: 2, visualMessages: [savedVisual] }],
    });
    mocks.sendMessage.mockResolvedValue({ sessionId: "chat-17", taskId: "task-visual" });

    render(
      <ChatScreen
        sessionId="chat-17"
        onOpenSessions={() => {}}
        onOpenRules={() => {}}
        onOpenMemory={() => {}}
      />,
    );
    await screen.findByRole("button", { name: "Mock explain visual" });
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Mock attach visual" }));
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(screen.getByText(/Selected visual context attached/).textContent).toContain("revision 4");
    fireEvent.click(screen.getByRole("button", { name: "Mock composer send" }));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith("chat-17", "Follow up", {
      visualContext: {
        visualMessageId: "visual_saved001",
        revision: 4,
        sceneId: "routeScene",
        selectedElementIds: ["route"],
        action: "attach",
      },
    }));
  });

  it("places the exact visual revision inline after AVA's validated creation tool succeeds", async () => {
    mocks.fetchSession.mockResolvedValue({
      session: { id: "chat-17" },
      messages: [{ id: 1, role: "user", content: "Visualize the request path", created_at: 1 }],
    });
    mocks.fetchVisual.mockResolvedValue({ ...visualFixture, visualMessageId: "visual_abcdefgh", revision: 3 });
    mocks.events = [
      {
        id: 9,
        runEpoch: 0,
        kind: "tool_result",
        payload: {
          tool: "visual_explanation_create",
          ok: true,
          result: JSON.stringify({ visualMessageId: "visual_abcdefgh", revision: 3 }),
        },
      },
      { id: 10, runEpoch: 0, kind: "final", payload: { text: "Here is the request path." } },
      { id: 11, runEpoch: 0, kind: "done", payload: {} },
    ];
    const openVisual = vi.fn();

    render(
      <ChatScreen
        sessionId="chat-17"
        onOpenSessions={() => {}}
        onOpenRules={() => {}}
        onOpenMemory={() => {}}
        onOpenVisual={openVisual}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("inline-visual-ids").textContent).toBe("visual_abcdefgh@3"));
    expect(mocks.fetchVisual).toHaveBeenCalledWith("visual_abcdefgh", 3);
    expect(openVisual).not.toHaveBeenCalled();
  });
});
