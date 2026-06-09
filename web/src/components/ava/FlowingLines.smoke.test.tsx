import { describe, it, expect } from "vitest";
import { FlowingLines } from "./FlowingLines.js";
describe("FlowingLines module", () => {
  it("exports a function component", () => {
    expect(typeof FlowingLines).toBe("function");
  });
});
