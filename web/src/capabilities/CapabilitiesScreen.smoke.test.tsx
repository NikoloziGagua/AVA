import { describe, expect, it } from "vitest";
import { CapabilitiesScreen } from "./CapabilitiesScreen.js";

describe("CapabilitiesScreen module", () => {
  it("exports the discovery surface", () => {
    expect(typeof CapabilitiesScreen).toBe("function");
  });
});
