import { describe, expect, it } from "vitest";
import {
  PERSONA_COLLABORATION_CONTRACT,
  VOICE_DELIVERY_GUIDANCE,
  buildActivePersonaRegister,
  classifyPersonaRegister,
} from "./runtime.js";

describe("Persona v2 register selection", () => {
  it.each([
    ["hey ava", "casual"],
    ["open my downloads", "execution"],
    ["brainstorm the best improvements for AVA", "brainstorming"],
    ["you opened the wrong chat again, fix this", "repair"],
    ["send this message to Lasha", "high_stakes"],
    ["I think the medical answer is definitely X, agree?", "high_stakes"],
  ] as const)("classifies %s as %s", (text, expected) => {
    expect(classifyPersonaRegister({ text })).toBe(expected);
  });

  it("uses conservative precedence when contexts overlap", () => {
    expect(classifyPersonaRegister({
      text: "brainstorm why the bank transfer failed and send it again",
    })).toBe("high_stakes");
    expect(classifyPersonaRegister({
      text: "brainstorm why your previous answer was wrong",
    })).toBe("repair");
  });

  it("renders only the selected closed register", () => {
    const raw = "brainstorm ideas using marker-991";
    const block = buildActivePersonaRegister({ text: raw, channel: "voice" });
    expect(block).toContain("Active delivery register: Brainstorming");
    expect(block).toContain("Channel: voice");
    expect(block).not.toContain("marker-991");
  });

  it("keeps warmth separate from flattery and authority", () => {
    expect(PERSONA_COLLABORATION_CONTRACT).toContain("Warmth comes from attention");
    expect(PERSONA_COLLABORATION_CONTRACT).toContain("Never fabricate");
    expect(PERSONA_COLLABORATION_CONTRACT).not.toMatch(/grant|allow the tool/i);
    expect(VOICE_DELIVERY_GUIDANCE).toContain("same AVA");
    expect(VOICE_DELIVERY_GUIDANCE).toContain("no humor");
  });
});
