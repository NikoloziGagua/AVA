import { describe, it, expect } from "vitest";
import { MemoryEditor } from "./MemoryEditor.js";
describe("MemoryEditor module", () => {
  it("exports a function component", () => {
    expect(typeof MemoryEditor).toBe("function");
  });
});
