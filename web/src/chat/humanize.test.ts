import { describe, it, expect } from "vitest";
import { humanizeTool } from "./humanize.js";

describe("humanizeTool", () => {
  it("turns shell into the command being run", () => {
    expect(humanizeTool("shell", { command: "git status" })).toBe("Running git status");
    expect(humanizeTool("shell", {})).toBe("Running a command");
  });

  it("uses the file's basename, not the full path", () => {
    expect(humanizeTool("fs_write", { path: "C:/ai/proj/notes.txt" })).toBe("Writing notes.txt");
    expect(humanizeTool("fs_read", { path: "/etc/hosts" })).toBe("Reading hosts");
  });

  it("turns chrome_navigate into the bare domain", () => {
    expect(humanizeTool("chrome_navigate", { url: "https://www.bing.com/search?q=x" })).toBe("Opening bing.com");
    expect(humanizeTool("chrome_navigate", {})).toBe("Opening a page");
  });

  it("gives friendly phrases for the common tools", () => {
    expect(humanizeTool("take_screenshot")).toBe("Taking a screenshot");
    expect(humanizeTool("claude_code")).toBe("Writing code");
    expect(humanizeTool("memory_remember")).toBe("Saving to memory");
    expect(humanizeTool("notes_capture", { project: "AVA Voice" })).toBe("Saving to AVA Voice Notes");
    expect(humanizeTool("notes_promote", { target: "task" })).toBe("Turning a note into a task");
    expect(humanizeTool("self_improve")).toBe("Queuing a self-improvement");
  });

  it("truncates long shell commands", () => {
    const long = humanizeTool("shell", { command: "x".repeat(200) });
    expect(long.length).toBeLessThan(60);
    expect(long.endsWith("…")).toBe(true);
  });

  it("falls back to a readable form for unknown tools", () => {
    expect(humanizeTool("some_new_tool")).toBe("Some new tool");
  });
});
