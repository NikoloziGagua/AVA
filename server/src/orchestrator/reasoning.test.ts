import { describe, it, expect } from "vitest";
import { mapReasoning } from "./reasoning.js";

describe("mapReasoning", () => {
  it("fast/conversation -> minimal", () => {
    expect(mapReasoning("fast", "conversation")).toBe("minimal");
  });
  it("fast/action -> low", () => {
    expect(mapReasoning("fast", "action")).toBe("low");
  });
  it("thorough/conversation -> low", () => {
    expect(mapReasoning("thorough", "conversation")).toBe("low");
  });
  it("thorough/action -> medium", () => {
    expect(mapReasoning("thorough", "action")).toBe("medium");
  });
});
