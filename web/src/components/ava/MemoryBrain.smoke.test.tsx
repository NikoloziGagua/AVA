// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryBrain } from "./MemoryBrain.js";
import type { MemoryView } from "../../api.js";

const TINY: MemoryView = {
  personality: "calm, direct.",
  personaProfile: {
    version: "2.0",
    architecture: "identity + collaboration + context registers",
    registers: [],
    lab: {
      kind: "deterministic_contract",
      scenarioCount: 50,
      coverage: { casual: 10, execution: 10, brainstorming: 10, repair: 10, high_stakes: 10 },
      channels: ["chat", "voice"],
      valid: true,
      caveat: "Contract coverage is not a live-model preference score.",
    },
  },
  memoryIndex: "",
  preferences: { lines: ["prefers cyan", "no emojis"] },
  observations: {
    lines: [
      {
        raw: "obs-1",
        date: "2026-06-09",
        confidence: "high",
        category: "context",
        text: "owner is on Windows 11",
        superseded: null,
      },
      {
        raw: "obs-2",
        date: "2026-06-08",
        confidence: "low",
        category: "people",
        text: "calls himself Sir",
        superseded: "obs-9",
      },
    ],
  },
  projects: [{ slug: "yovlisshemdzle", body: "the Ava monorepo" }],
};

describe("MemoryBrain", () => {
  it("mounts via the null-WebGL fallback in jsdom without throwing", () => {
    // jsdom has no WebGL → MemoryBrain renders the static 'memory map' placeholder
    // and returns early instead of crashing.
    const { container, unmount } = render(<MemoryBrain memory={TINY} />);
    const root = container.firstChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.querySelector("[data-memory-brain-fallback]")).toBeTruthy();
    // Clean unmount must not throw (exercises the effect cleanup path).
    expect(() => unmount()).not.toThrow();
  });
});
