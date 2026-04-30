import { describe, it, expect } from "vitest";
import { formatTime } from "./VoiceScreen.js";

describe("formatTime", () => {
  it("formats 0", () => expect(formatTime(0)).toBe("0:00"));
  it("formats 65", () => expect(formatTime(65)).toBe("1:05"));
  it("formats 600", () => expect(formatTime(600)).toBe("10:00"));
  it("formats 9", () => expect(formatTime(9)).toBe("0:09"));
});
