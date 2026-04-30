import { describe, it, expect } from "vitest";
import { MemoryScreen } from "./MemoryScreen.js";
describe("MemoryScreen module", () => {
  it("exports a function component", () => {
    expect(typeof MemoryScreen).toBe("function");
  });
});
