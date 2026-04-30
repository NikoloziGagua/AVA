import { describe, it, expect } from "vitest";
import { OrbitScreen } from "./OrbitScreen.js";
describe("OrbitScreen module", () => {
  it("exports a function component", () => {
    expect(typeof OrbitScreen).toBe("function");
  });
});
