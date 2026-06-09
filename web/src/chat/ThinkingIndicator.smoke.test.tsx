import { describe, it, expect } from "vitest";
import { ThinkingIndicator } from "./ThinkingIndicator.js";
describe("ThinkingIndicator module", () => {
  it("exports a function component", () => {
    expect(typeof ThinkingIndicator).toBe("function");
  });
});
