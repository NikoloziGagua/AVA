import { describe, it, expect } from "vitest";
import { classifyRisk } from "./classify.js";

describe("classifyRisk", () => {
  it("read-only: chrome.read_page", () => {
    expect(classifyRisk("chrome_read_page", {}).tier).toBe("read-only");
  });
  it("read-only: fs_read", () => {
    expect(classifyRisk("fs_read", { path: "C:/ai/x" }).tier).toBe("read-only");
  });
  it("read-only: fs_list, fs_stat, chrome_screenshot, chrome_tabs", () => {
    for (const t of ["fs_list", "fs_stat", "chrome_screenshot", "chrome_tabs"]) {
      expect(classifyRisk(t, {}).tier).toBe("read-only");
    }
  });
  it("low: chrome.navigate non-purchase URL", () => {
    expect(classifyRisk("chrome_navigate", { url: "https://news.ycombinator.com" }).tier).toBe("low");
  });
  it("low: fs_write under allowlist root (caller still allowlist-checks separately)", () => {
    expect(classifyRisk("fs_write", { path: "C:/ai/x.txt" }).tier).toBe("low");
  });
  it("medium: claude_code (always asks)", () => {
    expect(classifyRisk("claude_code", { prompt: "fix it", cwd: "C:/ai" }).tier).toBe("medium");
  });
  it("high: fs_delete is always high regardless of path", () => {
    expect(classifyRisk("fs_delete", { path: "C:/ai/scratch.txt" }).tier).toBe("high");
  });
  it("high: chrome_click on a submit/checkout token", () => {
    expect(classifyRisk("chrome_click", { selector: "button[type='submit']" }).tier).toBe("high");
    expect(classifyRisk("chrome_click", { selector: "#checkout-btn" }).tier).toBe("high");
  });
  it("high: shell with rm -rf", () => {
    expect(classifyRisk("shell", { command: "rm -rf /tmp/x" }).tier).toBe("high");
  });
  it("high: shell with git push", () => {
    expect(classifyRisk("shell", { command: "git push origin main" }).tier).toBe("high");
  });
  it("blocked: anything touching .env", () => {
    expect(classifyRisk("fs_read", { path: "C:/ai/.env" }).tier).toBe("blocked");
    expect(classifyRisk("fs_write", { path: "C:/ai/foo/.env.local" }).tier).toBe("blocked");
    expect(classifyRisk("shell", { command: "cat /tmp/.env" }).tier).toBe("blocked");
  });
  it("blocked: --dangerously-skip-permissions in claude_code prompt or args", () => {
    expect(classifyRisk("claude_code", { prompt: "--dangerously-skip-permissions" }).tier).toBe("blocked");
  });
  it("read-only: memory_read", () => {
    expect(classifyRisk("memory_read", { category: "preferences" }).tier).toBe("read-only");
  });
  it("low: memory_remember and memory_forget (local memory dir, behind firewall)", () => {
    expect(classifyRisk("memory_remember", { category: "preferences", text: "user prefers pwsh" }).tier).toBe("low");
    expect(classifyRisk("memory_forget", { category: "preferences", line: "old pref" }).tier).toBe("low");
  });
});
