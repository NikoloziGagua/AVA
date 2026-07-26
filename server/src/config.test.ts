import { afterEach, describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

const originalCwd = process.cwd();
const ENV_KEYS = [
  "DATA_DIR",
  "MEMORY_DIR",
  "LOGS_DIR",
  "PIDFILE_DIR",
  "SCREENSHOT_DIR",
  "CHROME_PROFILE_DIR",
  "CHROME_EXECUTABLE_PATH",
  "CHROME_CDP_URL",
  "AVA_REPO_ROOT",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

afterEach(() => {
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function clearPathEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("loadConfig path stability", () => {
  it("uses server/data and the repository root regardless of cwd", () => {
    clearPathEnv();
    const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const repoRoot = resolve(serverRoot, "..");

    process.chdir(repoRoot);
    const fromRepo = loadConfig();
    process.chdir(serverRoot);
    const fromServer = loadConfig();

    expect(fromRepo.dataDir).toBe(join(serverRoot, "data"));
    expect(fromServer.dataDir).toBe(fromRepo.dataDir);
    expect(fromServer.memoryDir).toBe(join(serverRoot, "data", "memory"));
    expect(fromRepo.repoRoot).toBe(repoRoot);
    expect(fromServer.repoRoot).toBe(repoRoot);
  });

  it("anchors relative path overrides to server rather than cwd", () => {
    clearPathEnv();
    const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    process.env.DATA_DIR = "./data";
    process.env.MEMORY_DIR = "./relative-memory";
    process.chdir(resolve(serverRoot, ".."));

    const cfg = loadConfig();

    expect(cfg.dataDir).toBe(join(serverRoot, "data"));
    expect(cfg.memoryDir).toBe(join(serverRoot, "relative-memory"));
  });
});
