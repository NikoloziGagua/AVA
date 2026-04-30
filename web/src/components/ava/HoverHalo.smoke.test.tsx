import { describe, it, expect } from "vitest";
import { HoverHalo } from "./HoverHalo.js";
describe("HoverHalo module", () => {
  it("exports a function component", () => {
    expect(typeof HoverHalo).toBe("function");
  });
});
