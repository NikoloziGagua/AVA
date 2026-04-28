import { describe, it, expect } from "vitest";
import { TOOL_RUBRIC } from "./tool-rubric.js";

describe("TOOL_RUBRIC", () => {
  it("documents the available tools", () => {
    expect(TOOL_RUBRIC).toContain("shell");
    expect(TOOL_RUBRIC).toContain("fs_read");
    expect(TOOL_RUBRIC).toContain("chrome_navigate");
    expect(TOOL_RUBRIC).toContain("memory_remember");
    expect(TOOL_RUBRIC).toContain("memory_forget");
    expect(TOOL_RUBRIC).toContain("memory_read");
  });

  it("biases toward conversation-mode (answer + offer over silent escalation)", () => {
    expect(TOOL_RUBRIC.toLowerCase()).toContain("answer from memory first");
  });

  it("documents the observation line format with date / confidence / category", () => {
    expect(TOOL_RUBRIC).toMatch(/\[date \/ confidence \/ category\]/);
    expect(TOOL_RUBRIC).toContain("low");
    expect(TOOL_RUBRIC).toContain("medium");
    expect(TOOL_RUBRIC).toContain("high");
  });

  it("instructs that 'forget that' patterns route through memory_forget, not plain text", () => {
    expect(TOOL_RUBRIC.toLowerCase()).toContain("forget that");
    expect(TOOL_RUBRIC).toContain("memory_forget");
  });

  it("instructs that memory-read queries route through memory_read, not recitation", () => {
    expect(TOOL_RUBRIC.toLowerCase()).toContain("what do you remember");
    expect(TOOL_RUBRIC).toContain("memory_read");
  });

  it("hard rules: .env paths blocked, no --dangerously-skip-permissions", () => {
    expect(TOOL_RUBRIC).toContain(".env");
    expect(TOOL_RUBRIC).toContain("dangerously-skip-permissions");
  });
});
