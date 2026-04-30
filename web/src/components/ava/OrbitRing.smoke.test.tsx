import { describe, it, expect } from "vitest";
import { OrbitRing, computeNodePosition } from "./OrbitRing.js";

describe("OrbitRing", () => {
  it("exports the component", () => {
    expect(typeof OrbitRing).toBe("function");
  });
  it("computeNodePosition places node 0 at the right when rotation=0", () => {
    const p = computeNodePosition({ index: 0, total: 4, radius: 100, rotationDeg: 0 });
    expect(Math.round(p.x)).toBe(100);
    expect(Math.round(p.y)).toBe(0);
  });
  it("computeNodePosition rotation shifts the angle", () => {
    const p = computeNodePosition({ index: 0, total: 4, radius: 100, rotationDeg: 90 });
    expect(Math.round(p.x)).toBe(0);
    expect(Math.round(p.y)).toBe(100);
  });
});
