import type { StrategyChatHandoffResult } from "../strategy/coordinator.js";
import type { ToolDef } from "./ava-mcp.js";

export function buildStrategyRoomTools(options: {
  sessionId: string;
  openFromSession: (sessionId: string) => StrategyChatHandoffResult;
}): ToolDef[] {
  return [{
    tool: {
      name: "strategy_room_open",
      description:
        "Move this exact AVA conversation into the shared Strategy Room with Niko, AVA and real Codex. Use when Sir says take/bring/move this conversation to the Room, asks to bring Codex into this discussion, or asks all three of us to decide together. This starts discussion only and never implements the conclusion.",
      inputSchema: { type: "object", properties: {} },
    },
    run: async () => {
      const result = options.openFromSession(options.sessionId);
      if (!result.ok) {
        return {
          ok: false,
          text: result.reason === "source_session_empty"
            ? "This chat has no persisted conversation to move into the Strategy Room."
            : "The originating AVA chat is no longer available.",
        };
      }
      return {
        ok: true,
        text: JSON.stringify({
          roomId: result.linked.detail.room.id,
          title: result.linked.detail.room.title,
          status: result.linked.detail.room.status,
          sourceThroughMessageId: result.sourceThroughMessageId,
          reused: result.linked.reused,
          effect: "discussion_started_only_no_implementation",
        }),
      };
    },
  }];
}
