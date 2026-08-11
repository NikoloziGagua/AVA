// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StrategyDetail, StrategyMeta, StrategyRoom } from "./api.js";

const api = vi.hoisted(() => ({
  fetchStrategyMeta: vi.fn(),
  fetchStrategyRooms: vi.fn(),
  fetchStrategyRoom: vi.fn(),
  createStrategyRoom: vi.fn(),
  createStrategyRoomFromChat: vi.fn(),
  sendStrategyMessage: vi.fn(),
  approveStrategyRoom: vi.fn(),
  returnStrategyConclusionToChat: vi.fn(),
  pauseStrategyRoom: vi.fn(),
  resumeStrategyRoom: vi.fn(),
  subscribeStrategyEvents: vi.fn(() => () => {}),
}));

vi.mock("./api.js", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./api.js")>();
  return { ...original, ...api };
});

import { StrategyRoomScreen } from "./StrategyRoomScreen.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const room: StrategyRoom = {
  id: "room_1",
  title: "Improve AVA reliability",
  topic: "Improve AVA reliability",
  status: "awaiting_niko",
  phase: "waiting_for_niko",
  activeActor: null,
  round: 1,
  version: 12,
  livingBrief: "# Objective\nMake AVA dependable\n# Recommended decision\nBuild verification first",
  conclusion: "Build verification first",
  codexThreadId: "thr_real_codex_session",
  sourceSessionId: null,
  sourceThroughMessageId: null,
  returnedMessageId: null,
  returnedAt: null,
  error: null,
  createdAt: Date.now() - 1000,
  updatedAt: Date.now(),
  approvedAt: null,
  stoppedAt: null,
};

const detail: StrategyDetail = {
  room,
  messages: [
    { id: "m1", roomId: room.id, sequence: 1, author: "niko", kind: "message", content: room.topic, correlationId: "c1", createdAt: Date.now() - 800 },
    { id: "m2", roomId: room.id, sequence: 2, author: "ava", kind: "position", content: "AVA position", correlationId: "c1", createdAt: Date.now() - 600 },
    { id: "m3", roomId: room.id, sequence: 3, author: "codex", kind: "review", content: "Codex review", correlationId: "c1", createdAt: Date.now() - 400 },
  ],
};

const meta: StrategyMeta = {
  service: "ava-strategy-room",
  apiVersion: 1,
  authority: "ava",
  participants: {
    niko: { available: true, role: "owner" },
    ava: { available: true, role: "facilitator" },
    codex: { available: true, role: "critical collaborator", version: "codex 1", error: null },
  },
  approvalEffect: "records_decision_only",
  chatHandoff: "server_snapshot_and_explicit_approved_return",
  codexBoundary: "dedicated_read_only_resumable_cli_thread",
  eventBounds: { min: 1, max: 8 },
};

describe("StrategyRoomScreen", () => {
  it("shows attributed participants, living brief and version-guarded approval", async () => {
    api.fetchStrategyMeta.mockResolvedValue(meta);
    api.fetchStrategyRooms.mockResolvedValue([room]);
    api.fetchStrategyRoom.mockResolvedValue(detail);
    api.approveStrategyRoom.mockResolvedValue({ ...room, status: "approved", version: 13 });

    render(<StrategyRoomScreen />);

    expect(await screen.findByText("Codex review")).toBeTruthy();
    expect(screen.getByText("Make AVA dependable")).toBeTruthy();
    expect(screen.getByText(/dedicated read-only room thread/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve conclusion" }));
    await waitFor(() => expect(api.approveStrategyRoom).toHaveBeenCalledWith("room_1", 12));
  });

  it("labels an active message as an interruption", async () => {
    const active = { ...room, status: "discussing" as const, phase: "codex_review", activeActor: "codex" as const };
    api.fetchStrategyMeta.mockResolvedValue(meta);
    api.fetchStrategyRooms.mockResolvedValue([active]);
    api.fetchStrategyRoom.mockResolvedValue({ ...detail, room: active });
    api.sendStrategyMessage.mockResolvedValue({ ...detail, room: active });

    render(<StrategyRoomScreen />);
    const box = await screen.findByRole("textbox", { name: "Message the strategy room" });
    fireEvent.change(box, { target: { value: "Consider this constraint" } });
    fireEvent.click(screen.getByRole("button", { name: "Interrupt & add" }));
    await waitFor(() => expect(api.sendStrategyMessage).toHaveBeenCalledWith("room_1", "Consider this constraint"));
  });

  it("imports a linked chat and returns only its approved conclusion", async () => {
    const linked = {
      ...room,
      status: "approved" as const,
      phase: "approved",
      sourceSessionId: "chat-17",
      sourceThroughMessageId: 42,
    };
    const openChat = vi.fn();
    api.fetchStrategyMeta.mockResolvedValue(meta);
    api.fetchStrategyRooms.mockResolvedValue([]);
    api.createStrategyRoomFromChat.mockResolvedValue({ ...detail, room: linked });
    api.returnStrategyConclusionToChat.mockResolvedValue({
      room: { ...linked, returnedMessageId: 43, returnedAt: Date.now(), version: 13 },
      sessionId: "chat-17",
      messageId: 43,
      idempotent: false,
    });

    render(<StrategyRoomScreen sourceSessionId="chat-17" onOpenChat={openChat} />);

    expect(await screen.findByText(/linked to ava chat through message 42/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return conclusion to AVA chat" }));
    await waitFor(() => expect(api.returnStrategyConclusionToChat).toHaveBeenCalledWith("room_1", 12));
    expect(openChat).toHaveBeenCalledWith("chat-17");
  });
});
