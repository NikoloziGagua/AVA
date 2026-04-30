import { describe, it, expect } from "vitest";
import { ToolCallChip } from "./ToolCallChip.js";
describe("ToolCallChip module", () => {
  it("exports a function component", () => {
    expect(typeof ToolCallChip).toBe("function");
  });
});
