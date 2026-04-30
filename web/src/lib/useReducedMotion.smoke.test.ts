import { describe, it, expect } from "vitest";
import { useReducedMotion } from "./useReducedMotion.js";
describe("useReducedMotion module", () => {
  it("exports a function", () => {
    expect(typeof useReducedMotion).toBe("function");
  });
});
