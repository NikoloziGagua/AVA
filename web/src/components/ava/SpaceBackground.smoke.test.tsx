import { describe, it, expect } from "vitest";
import { SpaceBackground } from "./SpaceBackground.js";
describe("SpaceBackground module", () => {
  it("exports a function component", () => {
    expect(typeof SpaceBackground).toBe("function");
  });
});
