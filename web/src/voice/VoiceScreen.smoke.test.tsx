import { describe, it, expect } from "vitest";
import { VoiceScreen } from "./VoiceScreen.js";
describe("VoiceScreen module", () => {
  it("exports a function component", () => {
    expect(typeof VoiceScreen).toBe("function");
  });
});
