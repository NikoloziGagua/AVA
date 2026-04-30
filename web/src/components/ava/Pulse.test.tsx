import { describe, it, expect } from "vitest";
import { Pulse, type PulseState } from "./Pulse.js";

describe("Pulse module", () => {
  it("exports the component", () => {
    expect(typeof Pulse).toBe("function");
  });
  it("PulseState type accepts the four states", () => {
    const states: PulseState[] = ["idle", "listening", "thinking", "responding"];
    expect(states.length).toBe(4);
  });
});
