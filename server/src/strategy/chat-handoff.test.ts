import { describe, expect, it } from "vitest";
import type { Message } from "../state/messages.js";
import type { SessionWithSummary } from "../state/sessions.js";
import { buildReturnedConclusion, prepareChatHandoff } from "./chat-handoff.js";

const session: SessionWithSummary = {
  id: "chat-1",
  title: "Visibility discussion",
  created_at: 1,
  updated_at: 2,
  status: "active",
  pinned: 0,
  summary: "Earlier context",
  summary_through_message_id: 1,
};

describe("Strategy Room chat handoff", () => {
  it("builds attributed server context and redacts copied secrets", () => {
    const messages: Message[] = [
      { id: 1, session_id: session.id, role: "user", content: "authorization: Bearer private-chat-token", created_at: 1 },
      { id: 2, session_id: session.id, role: "assistant", content: "Let's involve Codex.", created_at: 2 },
    ];
    const handoff = prepareChatHandoff(session, messages)!;

    expect(handoff.sourceThroughMessageId).toBe(2);
    expect(handoff.context).toContain("Niko:");
    expect(handoff.context).toContain("AVA:");
    expect(handoff.context).not.toContain("private-chat-token");
    expect(handoff.context).toContain("***");
  });

  it("does not manufacture a snapshot for an empty chat", () => {
    expect(prepareChatHandoff(session, [])).toBeNull();
  });

  it("labels a returned conclusion as a proposal and sanitizes it again", () => {
    const text = buildReturnedConclusion(
      "A room",
      "Use option A. Cookie: sid=private-room-cookie",
    );
    expect(text).toContain("proposed course of action (not executed)");
    expect(text).not.toContain("private-room-cookie");
    expect(text).toContain("Tell me what course of action");
  });
});
