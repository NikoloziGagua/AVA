import { describe, it, expect } from "vitest";
import { loadSelfKnowledge } from "./identity.js";

describe("loadSelfKnowledge", () => {
  it("returns repo facts + the SELF.md body", () => {
    const k = loadSelfKnowledge({ repoRoot: "C:/ai/chemiapebi/yovlisshemdzle" });
    expect(k.repoRoot).toContain("yovlisshemdzle");
    expect(k.testCmd).toBe("npm test");
    expect(k.body).toMatch(/Ava/);
    expect(k.body.length).toBeGreaterThan(50);
  });
});
