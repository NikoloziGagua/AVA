import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rememberObservation } from "./remember.js";
import { memoryPaths } from "./paths.js";

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "ava-remember-"));
}

describe("rememberObservation", () => {
  let dir: string;
  beforeEach(() => { dir = makeDir(); });

  it("appends a fresh observation as a new line", () => {
    rememberObservation({
      memoryDir: dir,
      category: "preferences",
      confidence: "low",
      text: "uses pwsh for shell",
      today: "2026-04-29",
    });
    const body = readFileSync(memoryPaths(dir).observations, "utf8");
    expect(body).toContain("[2026-04-29 / low / preferences] uses pwsh for shell");
  });

  it("bumps tier on repeat instead of duplicating", () => {
    rememberObservation({
      memoryDir: dir, category: "preferences", confidence: "low",
      text: "uses pwsh for shell", today: "2026-04-29",
    });
    rememberObservation({
      memoryDir: dir, category: "preferences", confidence: "low",
      text: "uses pwsh for shell", today: "2026-04-30",
    });
    const body = readFileSync(memoryPaths(dir).observations, "utf8");
    const matches = body.split("\n").filter((l) => l.includes("uses pwsh for shell"));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain("[2026-04-30 / medium /");
  });

  it("respects the firewall (scrubSecrets) on append path", () => {
    rememberObservation({
      memoryDir: dir, category: "context", confidence: "low",
      text: "API key sk-ant-1234567890abcdefghijklmnopqrstuvwx",
      today: "2026-04-29",
    });
    const body = readFileSync(memoryPaths(dir).observations, "utf8");
    expect(body).not.toContain("1234567890abcdefghijklmnopqrstuvwx");
    expect(body).toContain("sk-ant-***");
  });

  it("respects the firewall on the promote path", () => {
    const secretText = "API key sk-ant-1234567890abcdefghijklmnopqrstuvwx";
    rememberObservation({
      memoryDir: dir, category: "context", confidence: "low",
      text: secretText, today: "2026-04-29",
    });
    rememberObservation({
      memoryDir: dir, category: "context", confidence: "low",
      text: secretText, today: "2026-04-30",
    });
    const body = readFileSync(memoryPaths(dir).observations, "utf8");
    expect(body).not.toContain("1234567890abcdefghijklmnopqrstuvwx");
  });
});
