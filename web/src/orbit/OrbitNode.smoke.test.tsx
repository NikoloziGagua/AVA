import { describe, it, expect } from "vitest";
import { OrbitNode } from "./OrbitNode.js";
describe("OrbitNode module", () => {
  it("exports a function component", () => {
    expect(typeof OrbitNode).toBe("function");
  });
});
