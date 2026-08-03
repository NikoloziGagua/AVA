import { describe, expect, it } from "vitest";
import type { Message } from "../state/messages.js";
import { isContextualContinuation, resolveRunObjective } from "./objective-lineage.js";

function message(id: number, role: Message["role"], content: string): Message {
  return { id, session_id: "session", role, content, created_at: id };
}

describe("objective lineage", () => {
  it.each(["try again", "try agin", "retry it again", "continue", "resume that", "go on"])(
    "recognizes the contextual continuation %s",
    (text) => expect(isContextualContinuation(text)).toBe(true),
  );

  it("inherits the nearest substantive user objective across repeated retries", () => {
    const resolved = resolveRunObjective("try agin", [
      message(1, "user", "Read and compare the five research articles."),
      message(2, "assistant", "One source failed."),
      message(3, "user", "try again"),
      message(4, "assistant", "The retry was partial."),
    ]);
    expect(resolved).toBe("Continue previous objective: Read and compare the five research articles.");
  });

  it("does not rewrite a substantive new request", () => {
    expect(resolveRunObjective("Try the browser route instead", [
      message(1, "user", "Open the report."),
    ])).toBe("Try the browser route instead");
  });
});
