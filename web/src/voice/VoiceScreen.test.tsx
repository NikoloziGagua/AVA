import { describe, it, expect } from "vitest";
import { formatTime, shouldShowVoiceStop } from "./VoiceScreen.js";
import { recentVoiceTurns, VOICE_HISTORY_LIMIT } from "./useRealtimeVoice.js";

describe("formatTime", () => {
  it("formats 0", () => expect(formatTime(0)).toBe("0:00"));
  it("formats 65", () => expect(formatTime(65)).toBe("1:05"));
  it("formats 600", () => expect(formatTime(600)).toBe("10:00"));
  it("formats 9", () => expect(formatTime(9)).toBe("0:09"));
});

describe("shouldShowVoiceStop", () => {
  it("keeps Stop available while AVA is thinking or running an action", () => {
    expect(shouldShowVoiceStop("thinking", false)).toBe(true);
    expect(shouldShowVoiceStop("listening", true)).toBe(true);
  });

  it("shows Stop while speaking but not while simply listening", () => {
    expect(shouldShowVoiceStop("responding", false)).toBe(true);
    expect(shouldShowVoiceStop("listening", false)).toBe(false);
  });
});

describe("recentVoiceTurns", () => {
  it("keeps only the newest voice-sized history window", () => {
    const messages = Array.from({ length: VOICE_HISTORY_LIMIT + 4 }, (_, index) => ({
      id: index + 1,
      role: index % 2 ? "assistant" : "user",
      content: `turn ${index + 1}`,
      created_at: index,
    }));
    const turns = recentVoiceTurns(messages);
    expect(turns).toHaveLength(VOICE_HISTORY_LIMIT);
    expect(turns[0]?.text).toBe("turn 5");
    expect(turns.at(-1)?.text).toBe(`turn ${VOICE_HISTORY_LIMIT + 4}`);
  });

  it("omits non-conversation rows", () => {
    const turns = recentVoiceTurns([
      { id: 1, role: "system", content: "internal", created_at: 1 },
      { id: 2, role: "assistant", content: "hello", created_at: 2 },
    ]);
    expect(turns.map((turn) => turn.text)).toEqual(["hello"]);
  });

  it("restores the persisted exact-text source marker", () => {
    const turns = recentVoiceTurns([{
      id: 1,
      role: "user",
      content: "@Exact_Name",
      created_at: 1,
      metadata: { inputSource: "voice_exact_text" },
    }]);
    expect(turns[0]).toMatchObject({ text: "@Exact_Name", inputSource: "voice_exact_text" });
  });
});
