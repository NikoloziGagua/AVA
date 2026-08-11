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
  it("low: opening the dedicated AVA Chrome never asks for approval", () => {
    expect(classifyRisk("chrome_open", {}).tier).toBe("low");
    expect(classifyRisk("chrome_open", { url: "https://www.google.com" }).tier).toBe("low");
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
  it("high: shell with destructive op (rm -rf)", () => {
    expect(classifyRisk("shell", { command: "rm -rf /tmp/x" }).tier).toBe("high");
  });
  it("high: shell with format / reg delete / shutdown", () => {
    expect(classifyRisk("shell", { command: "format c:" }).tier).toBe("high");
    expect(classifyRisk("shell", { command: "reg delete HKLM\\Software\\Foo /f" }).tier).toBe("high");
    expect(classifyRisk("shell", { command: "shutdown /s /t 0" }).tier).toBe("high");
  });
  it("low: app-launch / open commands (start, explorer, code) auto-allow instantly", () => {
    expect(classifyRisk("shell", { command: "start whatsapp:" }).tier).toBe("low");
    expect(classifyRisk("shell", { command: "start spotify:" }).tier).toBe("low");
    expect(classifyRisk("shell", { command: 'start "" "C:\\x\\App.exe"' }).tier).toBe("low");
    expect(classifyRisk("shell", { command: "explorer ." }).tier).toBe("low");
    expect(classifyRisk("shell", { command: "code ." }).tier).toBe("low");
  });
  it("low: Strategy Room handoff starts discussion but cannot execute", () => {
    expect(classifyRisk("strategy_room_open", {}).tier).toBe("low");
  });
  it("low: dedicated Instagram profile opening", () => {
    expect(classifyRisk("instagram_open_profile", { person: "Lasha" }).tier).toBe("low");
  });
  it("low: ordinary shell (dir, git status, git push) — Sir wants no friction", () => {
    expect(classifyRisk("shell", { command: "dir" }).tier).toBe("low");
    expect(classifyRisk("shell", { command: "git status" }).tier).toBe("low");
    expect(classifyRisk("shell", { command: "git push origin main" }).tier).toBe("low");
  });
  it("low: control_app with a benign UI-Automation / SendKeys script (auto-allow, no stall)", () => {
    expect(
      classifyRisk("control_app", {
        script:
          "(New-Object -ComObject WScript.Shell).AppActivate('WhatsApp'); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^f')",
      }).tier,
    ).toBe("low");
  });
  it("high: control_app with a destructive script (Remove-Item -Recurse -Force / format)", () => {
    expect(
      classifyRisk("control_app", { script: "Remove-Item -Recurse -Force C:\\stuff" }).tier,
    ).toBe("high");
    expect(classifyRisk("control_app", { script: "format c:" }).tier).toBe("high");
  });
  it("blocked: control_app script that touches .env (top-level guard)", () => {
    expect(
      classifyRisk("control_app", { script: "Get-Content C:\\ai\\.env" }).tier,
    ).toBe("blocked");
  });
  it("blocked: anything touching .env", () => {
    expect(classifyRisk("fs_read", { path: "C:/ai/.env" }).tier).toBe("blocked");
    expect(classifyRisk("fs_write", { path: "C:/ai/foo/.env.local" }).tier).toBe("blocked");
    expect(classifyRisk("shell", { command: "cat /tmp/.env" }).tier).toBe("blocked");
    // bare `cat .env` (no leading slash) is also blocked via the shell gate
    expect(classifyRisk("shell", { command: "cat .env" }).tier).toBe("blocked");
    expect(classifyRisk("shell", { command: "type .env" }).tier).toBe("blocked");
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
  it("routes Notes reads and local mutations without a redundant approval stall", () => {
    expect(classifyRisk("notes_search", { query: "voice" }).tier).toBe("read-only");
    expect(classifyRisk("notes_capture", { content: "idea" }).tier).toBe("low");
    expect(classifyRisk("notes_update", { id: "note_1", expected_version: 1 }).tier).toBe("low");
    expect(classifyRisk("notes_promote", { id: "note_1", target: "self_improvement" }).tier).toBe("low");
  });
  it("routes visual creation as bounded local state and visual listing as read-only", () => {
    expect(classifyRisk("visual_explanation_create", { title: "Map" }).tier).toBe("low");
    expect(classifyRisk("research_visual_create", { title: "Evidence map" }).tier).toBe("low");
    expect(classifyRisk("visual_explanation_list", {}).tier).toBe("read-only");
  });
});

describe("screen-sight and watch tools (2026-07-03 stall fix)", () => {
  it("look_at_screen is low — no approval stall for reading Sir's own screen", () => {
    expect(classifyRisk("look_at_screen", { question: "what's on screen?" }).tier).toBe("low");
  });
  it("watch bookkeeping is low, watch_list read-only", () => {
    expect(classifyRisk("watch_create", { prompt: "x", interval_minutes: 30 }).tier).toBe("low");
    expect(classifyRisk("watch_delete", { id: "abc" }).tier).toBe("low");
    expect(classifyRisk("watch_list", {}).tier).toBe("read-only");
    expect(classifyRisk("chrome_snapshot", {}).tier).toBe("read-only");
  });
  it(".env path-shaped watch args hard-block (prose mentions gate later, at the tool)", () => {
    expect(classifyRisk("watch_create", { prompt: "C:/x/.env" }).tier).toBe("blocked");
    expect(classifyRisk("watch_create", { prompt: "report on env hygiene practices" }).tier).toBe("low");
  });
});
