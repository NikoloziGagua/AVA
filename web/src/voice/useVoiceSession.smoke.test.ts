import { describe, it, expect } from "vitest";
import { useVoiceSession } from "./useVoiceSession.js";
describe("useVoiceSession module", () => {
  it("exports a function", () => {
    expect(typeof useVoiceSession).toBe("function");
  });
});
