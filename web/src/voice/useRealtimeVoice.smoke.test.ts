import { describe, it, expect } from "vitest";
import { useRealtimeVoice } from "./useRealtimeVoice.js";

describe("useRealtimeVoice module", () => {
  it("exports a function", () => {
    expect(typeof useRealtimeVoice).toBe("function");
  });
});
