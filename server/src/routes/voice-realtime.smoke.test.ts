import { describe, it, expect } from "vitest";
import { buildRealtimeProxy } from "./voice-realtime.js";

describe("voice-realtime module", () => {
  it("exports buildRealtimeProxy", () => {
    expect(typeof buildRealtimeProxy).toBe("function");
  });
});
