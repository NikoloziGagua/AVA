import { describe, it, expect } from "vitest";
import { PairingScreen } from "./PairingScreen.js";
describe("PairingScreen module", () => {
  it("exports a function component", () => {
    expect(typeof PairingScreen).toBe("function");
  });
});
