import { describe, it, expect } from "vitest";
import { RulesScreen } from "./RulesScreen.js";
describe("RulesScreen module", () => {
  it("exports a function component", () => {
    expect(typeof RulesScreen).toBe("function");
  });
});
