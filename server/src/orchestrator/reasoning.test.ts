import { describe, it, expect } from "vitest";
import { mapReasoning } from "./reasoning.js";

describe("mapReasoning", () => {
  it("fast/conversation -> none", () => {
    expect(mapReasoning("fast", "conversation")).toBe("none");
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
