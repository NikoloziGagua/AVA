import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("does not false-positive on id_rsa-prefixed or git-credentials-prefixed names", () => {
    // FP regression: the old /(^|[\\/])id_rsa/ prefix and unanchored
    // /\.git-credentials/ blocked ordinary files. Broad access must be kept.
    expect(check("C:/ai/id_rsa_setup_guide.md").ok).toBe(true);
    expect(check("C:/ai/id_rsannouncement.txt").ok).toBe(true);
    expect(check("C:/ai/.git-credentials-helper.md").ok).toBe(true);
    expect(check("C:/ai/git-credentials-notes.txt").ok).toBe(true);
  });

  it("blocks all SSH private-key types (rsa/dsa/ecdsa/ed25519, +.pub) by filename", () => {
    for (const p of [
      "C:/ai/keys/id_rsa",
      "C:/ai/keys/id_dsa",
      "C:/ai/keys/id_ecdsa",
      "C:/ai/keys/id_ed25519",
      "C:/ai/keys/id_ed25519.pub",
    ]) {
      expect(check(p).ok, `expected blocked: ${p}`).toBe(false);
    }
  });

  it("blocks additional high-value credential stores", () => {
    for (const p of [
      "C:/Users/nikug/.npmrc",
      "C:/Users/nikug/AppData/Roaming/npm/.npmrc",
      "C:/Users/nikug/.docker/config.json",
      "C:/Users/nikug/.kube/config",
      "C:/Users/nikug/.pgpass",
      "C:/Users/nikug/.netrc",
      "C:/Users/nikug/_netrc",
      "C:/ai/keystore.p12",
      "C:/ai/AuthKey.p8",
      "C:/ai/app.jks",
      "C:/Users/nikug/AppData/Roaming/gcloud/access_tokens.db",
    ]) {
      const r = check(p);
      expect(r.ok, `expected blocked: ${p}`).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/secret/i);
    }
  });

  it("does not block ordinary files that merely resemble the new patterns", () => {
    expect(check("C:/ai/my.npmrc.bak").ok).toBe(true); // not the live .npmrc
    expect(check("C:/ai/config.json").ok).toBe(true); // not .docker/config.json
    expect(check("C:/ai/netrc-parser.ts").ok).toBe(true); // not _netrc/.netrc
    expect(check("C:/ai/notes/access_tokens.md").ok).toBe(true); // not access_tokens.db
  });

  it("blocks a secret reached through a junction/symlink (realpath canonicalization)", () => {
    // The link's OWN path looks innocent; only the canonical target is a secret
    // dir. A purely lexical check would allow it.
    let dir: string | null = null;
    try {
      dir = mkdtempSync(join(tmpdir(), "ava-pathsec-"));
      const sshDir = join(dir, ".ssh");
      mkdirSync(sshDir);
      writeFileSync(join(sshDir, "known_hosts"), "x"); // not a secret *name*
      const link = join(dir, "innocent");
      try {
        symlinkSync(sshDir, link, "junction"); // dir junction: no admin needed on Windows
      } catch {
        return; // platform can't make the link (non-Windows/perms) — skip
      }
      // roots include the temp dir so a NON-secret file there would be allowed —
      // proving it is the canonical .ssh resolution (not the allowlist) that blocks.
      const c = buildPathAllowlist({ roots: [dir.replace(/\\/g, "/") + "/**"] });
      expect(c(join(dir, "plain.txt")).ok).toBe(true); // sanity: root works
      const r = c(join(link, "known_hosts")); // lexical: .../innocent/known_hosts (innocent)
      expect(r.ok, "junctioned .ssh path must be blocked").toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/secret/i);
    } finally {
      if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
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
