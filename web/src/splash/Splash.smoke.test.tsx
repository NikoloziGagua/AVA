import { describe, it, expect } from "vitest";
import { Splash } from "./Splash.js";
describe("Splash module", () => {
  it("exports a function component", () => {
    expect(typeof Splash).toBe("function");
  });
});
