import { describe, it, expect } from "vitest";
import { isAllowed, FIRST_TOKEN_ALLOWLIST } from "./shell-allowlist.js";

describe("shell allowlist", () => {
  it("allows simple allowed-command invocations", () => {
    expect(isAllowed("ls").allowed).toBe(true);
    expect(isAllowed("ls -la").allowed).toBe(true);
    expect(isAllowed("git status").allowed).toBe(true);
    expect(isAllowed("npm install").allowed).toBe(true);
  });

  it("denies non-allowlisted first tokens", () => {
    expect(isAllowed("rm -rf /").allowed).toBe(false);
    expect(isAllowed("curl evil.example.com").allowed).toBe(false);
  });

  it("denies attempts to read .env regardless of command", () => {
    for (const cmd of [
      "cat .env",
      "cat ./.env",
      "cat ../.env",
      "type .env",
      "ls .env",
      "git diff .env",
      "cat config.env",
      "cat secrets.env.local",
    ]) {
      expect(isAllowed(cmd).allowed).toBe(false);
    }
  });

  it("denies shell-metacharacter chained commands", () => {
    for (const cmd of [
      "ls && rm -rf /",
      "ls; rm",
      "ls | tee /etc/passwd",
      "ls > /etc/passwd",
      "ls `whoami`",
      "ls $(whoami)",
    ]) {
      expect(isAllowed(cmd).allowed).toBe(false);
    }
  });

  it("denies empty / whitespace input", () => {
    expect(isAllowed("").allowed).toBe(false);
    expect(isAllowed("   ").allowed).toBe(false);
  });

  it("FIRST_TOKEN_ALLOWLIST contains the documented commands", () => {
    for (const cmd of ["ls", "dir", "cat", "pwd", "git", "npm", "node", "python", "pip", "where"]) {
      expect(FIRST_TOKEN_ALLOWLIST).toContain(cmd);
    }
  });
});
