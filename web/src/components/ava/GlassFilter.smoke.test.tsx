import { describe, it, expect } from "vitest";
import { GlassFilter } from "./GlassFilter.js";
describe("GlassFilter module", () => {
  it("exports a function component", () => {
    expect(typeof GlassFilter).toBe("function");
  });
});
