import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MemoryView } from "../api.js";
import { PersonaProfileCard } from "./PersonaProfileCard.js";

const PROFILE: MemoryView["personaProfile"] = {
  version: "2.0",
  architecture: "identity + collaboration + context registers",
  registers: [
    { id: "casual", label: "Casual", summary: "Warm and relaxed." },
    { id: "repair", label: "Repair", summary: "Calm accountability." },
  ],
  lab: {
    kind: "deterministic_contract",
    scenarioCount: 50,
    coverage: { casual: 10, execution: 10, brainstorming: 10, repair: 10, high_stakes: 10 },
    channels: ["chat", "voice"],
    valid: true,
    caveat: "Contract coverage is not a live-model preference score.",
  },
};

describe("PersonaProfileCard", () => {
  it("makes the persona architecture and honest lab status visible", () => {
    render(<PersonaProfileCard profile={PROFILE} />);
    expect(screen.getByRole("region", { name: "AVA Persona version 2.0" })).toBeTruthy();
    expect(screen.getByText("CONTRACT VALID")).toBeTruthy();
    expect(screen.getByText("Casual")).toBeTruthy();
    expect(screen.getByText("Repair")).toBeTruthy();
    expect(screen.getByText("50 CONSISTENCY SCENARIOS / CHAT + VOICE")).toBeTruthy();
    expect(screen.getByText(/not a live-model preference score/i)).toBeTruthy();
  });
});
