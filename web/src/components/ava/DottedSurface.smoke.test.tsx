import { describe, it, expect } from "vitest";
import { DottedSurface } from "./DottedSurface.js";
describe("DottedSurface module", () => {
  it("exports a function component", () => {
    expect(typeof DottedSurface).toBe("function");
  });
});
