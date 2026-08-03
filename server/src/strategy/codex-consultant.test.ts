import { describe, expect, it } from "vitest";
import { codexConsultArgs, consumeCodexJsonLine } from "./codex-consultant.js";

describe("Codex Strategy Room adapter", () => {
  it("starts read-only and resumes the exact dedicated thread", () => {
    expect(codexConsultArgs()).toEqual([
      "-a", "never", "-s", "read-only", "exec", "--json", "--cd", ".", "-",
    ]);
    expect(codexConsultArgs("thread-1")).toEqual([
      "-a", "never", "-s", "read-only", "exec", "resume", "--json", "thread-1", "-",
    ]);
    expect(codexConsultArgs().join(" ")).not.toMatch(/dangerously|workspace-write|full-access/i);
  });

  it("captures public agent output and usage but ignores reasoning items", () => {
    const state = { threadId: null, finalText: "", usage: null, error: null };
    consumeCodexJsonLine(JSON.stringify({ type: "thread.started", thread_id: "thr_real" }), state);
    consumeCodexJsonLine(JSON.stringify({
      type: "item.completed",
      item: { type: "reasoning", text: "private reasoning must not appear" },
    }), state);
    consumeCodexJsonLine(JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Public Codex recommendation" },
    }), state);
    consumeCodexJsonLine(JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 6 },
    }), state);
    expect(state).toEqual({
      threadId: "thr_real",
      finalText: "Public Codex recommendation",
      usage: { inputTokens: 10, cachedInputTokens: 4, outputTokens: 6 },
      error: null,
    });
    expect(JSON.stringify(state)).not.toContain("private reasoning");
  });
});
