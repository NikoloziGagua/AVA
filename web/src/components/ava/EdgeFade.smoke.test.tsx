import { describe, it, expect } from "vitest";
import { EdgeFade } from "./EdgeFade.js";
describe("EdgeFade module", () => {
  it("exports a function component", () => {
    expect(typeof EdgeFade).toBe("function");
  });
});
