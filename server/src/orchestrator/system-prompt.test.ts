import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "./system-prompt.js";

describe("buildSystemPrompt (M1)", () => {
  it("includes the agent name and identity", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("Ava");
  });

  it("instructs the agent to report errors honestly", () => {
    const p = buildSystemPrompt();
    expect(p.toLowerCase()).toContain("report errors honestly");
  });

  it("describes the shell tool's purpose and constraints", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("shell");
    expect(p).toContain("allowlist");
  });
});
