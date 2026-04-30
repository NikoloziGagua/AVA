import { describe, it, expect } from "vitest";
import { ShiningText } from "./ShiningText.js";
describe("ShiningText module", () => {
  it("exports a function component", () => {
    expect(typeof ShiningText).toBe("function");
  });
});
