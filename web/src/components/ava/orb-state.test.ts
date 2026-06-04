import { describe, it, expect } from "vitest";
import { orbMotion } from "./orb-state.js";

describe("orbMotion", () => {
  it("idle is calmer (slower spin) than thinking/working", () => {
    expect(orbMotion("idle").spin).toBeGreaterThan(orbMotion("thinking").spin);
    expect(orbMotion("idle").spin).toBeGreaterThan(orbMotion("working").spin);
  });

  it("responding has the brightest rim", () => {
    expect(orbMotion("responding").rimOpacity).toBeGreaterThan(orbMotion("idle").rimOpacity);
  });

  it("listening scales rim opacity with amplitude (clamped 0..1)", () => {
    expect(orbMotion("listening", 0).rimOpacity).toBeCloseTo(0.5, 5);
    expect(orbMotion("listening", 1).rimOpacity).toBeCloseTo(1, 5);
    expect(orbMotion("listening", 5).rimOpacity).toBeCloseTo(1, 5); // clamped
    expect(orbMotion("listening", -2).rimOpacity).toBeCloseTo(0.5, 5);
  });

  it("every state returns positive periods", () => {
    for (const s of ["idle", "listening", "thinking", "responding", "working"] as const) {
      expect(orbMotion(s).spin).toBeGreaterThan(0);
      expect(orbMotion(s).morph).toBeGreaterThan(0);
    }
  });
});
