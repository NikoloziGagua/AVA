import { describe, it, expect } from "vitest";
import { buildPathAllowlist } from "./path-allowlist.js";

describe("buildPathAllowlist", () => {
  const check = buildPathAllowlist({
    roots: ["C:/ai/**", "C:/projects/**", "C:/Users/nikug/Downloads/**"],
  });

  it("allows paths inside an allowlisted root", () => {
    expect(check("C:/ai/chemiapebi/server/src/index.ts").ok).toBe(true);
    expect(check("C:/projects/foo/bar.md").ok).toBe(true);
  });

  it("denies paths outside the allowlist", () => {
    expect(check("C:/Windows/System32/cmd.exe").ok).toBe(false);
    expect(check("D:/private/notes.txt").ok).toBe(false);
  });

  it("hard-blocks any path matching *.env*", () => {
    expect(check("C:/ai/.env").ok).toBe(false);
    expect(check("C:/ai/.env.local").ok).toBe(false);
    expect(check("C:/ai/secrets.env.production").ok).toBe(false);
  });

  it("denies path-traversal attempts", () => {
    expect(check("C:/ai/../Windows/system.ini").ok).toBe(false);
  });

  it("normalizes mixed slashes", () => {
    expect(check("C:\\ai\\foo\\bar.ts").ok).toBe(true);
  });

  it("returns a useful reason on deny", () => {
    const r = check("C:/Windows/cmd.exe");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/allowlist/i);
  });
});
