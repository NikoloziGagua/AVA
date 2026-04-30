import { describe, it, expect } from "vitest";
import { Composer } from "./Composer.js";
describe("Composer module", () => {
  it("exports a function component", () => {
    expect(typeof Composer).toBe("function");
  });
});
