import { describe, it, expect } from "vitest";
import { SegmentedTabs } from "./SegmentedTabs.js";
describe("SegmentedTabs module", () => {
  it("exports a function component", () => {
    expect(typeof SegmentedTabs).toBe("function");
  });
});
