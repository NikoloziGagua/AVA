import { describe, it, expect } from "vitest";
import { TOOL_RUBRIC } from "./tool-rubric.js";

describe("TOOL_RUBRIC", () => {
  it("documents the available tools", () => {
    expect(TOOL_RUBRIC).toContain("shell");
    expect(TOOL_RUBRIC).toContain("fs_read");
    expect(TOOL_RUBRIC).toContain("chrome_navigate");
    expect(TOOL_RUBRIC).toContain("memory_remember");
    expect(TOOL_RUBRIC).toContain("notes_capture");
    expect(TOOL_RUBRIC).toContain("memory_forget");
    expect(TOOL_RUBRIC).toContain("memory_read");
    expect(TOOL_RUBRIC).toContain("memory_index_capture");
    expect(TOOL_RUBRIC).toContain("memory_index_search");
    expect(TOOL_RUBRIC).toContain("memory_index_open");
    expect(TOOL_RUBRIC).toContain("memory_index_forget");
    expect(TOOL_RUBRIC).toContain("self_improve");
    expect(TOOL_RUBRIC).toContain("focus-default-window.ps1");
    expect(TOOL_RUBRIC).toContain("WinSta0\\Default");
  });

  it("biases toward acting immediately, not idling in chat", () => {
    expect(TOOL_RUBRIC.toLowerCase()).toContain("act immediately");
    expect(TOOL_RUBRIC.toLowerCase()).not.toContain("answer from memory first");
  });

  it("advertises procedural memory (playbooks) and self-improvement", () => {
    expect(TOOL_RUBRIC.toLowerCase()).toContain("playbook");
    expect(TOOL_RUBRIC.toLowerCase()).toContain("my own code");
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

  it("keeps semantic recall source-verified and explicit-capture only", () => {
    expect(TOOL_RUBRIC).toContain("original conversation range re-verifies");
    expect(TOOL_RUBRIC).toContain("automatic indexing is not enabled");
    expect(TOOL_RUBRIC).toContain("exact/keyword matching");
  });

  it("hard rules: .env paths blocked, no --dangerously-skip-permissions", () => {
    expect(TOOL_RUBRIC).toContain(".env");
    expect(TOOL_RUBRIC).toContain("dangerously-skip-permissions");
  });

  it("advertises 'people' as a memory category", () => {
    expect(TOOL_RUBRIC).toContain(
      "category: preferences | context | skills | setup | schedule | people",
    );
  });
});
