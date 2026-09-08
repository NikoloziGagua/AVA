import { describe, expect, it, vi } from "vitest";
import type { StrategyChatHandoffResult } from "../strategy/coordinator.js";
import { buildStrategyRoomTools } from "./strategy-room-mcp.js";

describe("Strategy Room AVA tool", () => {
  it("opens the current server session and reports a discussion-only effect", async () => {
    const openFromSession = vi.fn(() => ({
      ok: true as const,
      sourceThroughMessageId: 17,
      omittedMessageCount: 0,
      linked: {
        reused: false,
        detail: {
          room: { id: "room-1", title: "Decide together", status: "discussing" },
          messages: [],
        },
      },
    } as unknown as StrategyChatHandoffResult));
    const tool = buildStrategyRoomTools({ sessionId: "chat-9", openFromSession })[0]!;

    const result = await tool.run({}, { runId: "run-1" });

    expect(openFromSession).toHaveBeenCalledWith("chat-9");
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain("discussion_started_only_no_implementation");
  });

  it("reports a missing source honestly", async () => {
    const tool = buildStrategyRoomTools({
      sessionId: "missing",
      openFromSession: () => ({ ok: false, reason: "source_session_not_found" }),
    })[0]!;
    await expect(tool.run({}, { runId: "run-2" })).resolves.toMatchObject({ ok: false });
  });
});
