import { describe, it, expect } from "vitest";
import { CyclingText } from "./CyclingText.js";
describe("CyclingText module", () => {
  it("exports a function component", () => {
    expect(typeof CyclingText).toBe("function");
  });
});
