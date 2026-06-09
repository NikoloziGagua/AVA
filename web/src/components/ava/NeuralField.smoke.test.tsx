import { describe, it, expect } from "vitest";
import { NeuralField } from "./NeuralField.js";
describe("NeuralField module", () => {
  it("exports a function component", () => {
    expect(typeof NeuralField).toBe("function");
  });
});
