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

  it("hard-blocks secret files even inside an allowlisted root", () => {
    // These all live under C:/ai/** (an allowed root) yet must be refused.
    const blocked = [
      "C:/ai/.credentials.json",
      "C:/ai/gcloud/legacy_credentials/.credentials.json",
      "C:/ai/.aws/credentials",
      "C:/ai/.aws/config",
      "C:/ai/.ssh/known_hosts",
      "C:/ai/.ssh/id_rsa",
      "C:/ai/keys/id_rsa",
      "C:/ai/id_rsa.pub",
      "C:/ai/gh/hosts.yml",
      "C:/ai/.git-credentials",
      "C:/ai/server.pem",
      "C:/ai/cert.pfx",
      "C:/ai/private.key",
      "C:/ai/sub/dir/leaf.PEM",
    ];
    for (const p of blocked) {
      const r = check(p);
      expect(r.ok, `expected blocked: ${p}`).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/secret/i);
    }
  });

  it("hard-blocks secret files with backslash separators too", () => {
    expect(check("C:\\ai\\.aws\\credentials").ok).toBe(false);
    expect(check("C:\\ai\\.ssh\\id_rsa").ok).toBe(false);
  });

  it("still allows ordinary files whose names merely resemble secret tokens", () => {
    // broad access preserved: these are NOT secret files.
    expect(check("C:/ai/keymap.ts").ok).toBe(true);
    expect(check("C:/ai/monkey.json").ok).toBe(true);
    expect(check("C:/ai/awsome-notes.md").ok).toBe(true);
    expect(check("C:/ai/credentials-helper.ts").ok).toBe(true);
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
