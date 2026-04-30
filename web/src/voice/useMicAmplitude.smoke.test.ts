import { describe, it, expect } from "vitest";
import { useMicAmplitude } from "./useMicAmplitude.js";
describe("useMicAmplitude module", () => {
  it("exports a function", () => {
    expect(typeof useMicAmplitude).toBe("function");
  });
});
