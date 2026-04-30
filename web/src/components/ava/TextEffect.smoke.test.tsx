import { describe, it, expect } from "vitest";
import { TextEffect } from "./TextEffect.js";
describe("TextEffect module", () => {
  it("exports a function component", () => {
    expect(typeof TextEffect).toBe("function");
  });
});
