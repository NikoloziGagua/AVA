import picomatch from "picomatch";
import { resolve, normalize } from "node:path";

export type AllowDecision = { ok: true } | { ok: false; reason: string };

export type AllowlistConfig = {
  roots: string[];
};

const ENV_PATTERN = /(^|[\\/])[^\\/]*\.env(\.[^\\/]*)?$/i;

// Secret-file hard-block. Checked BEFORE the allowlist so these are refused even
// inside the broad authorized roots (Sir wants broad machine access, but never
// credential exfiltration). Matched case-insensitively anywhere in the path; the
// `[\\/]` separator classes accept either Windows or POSIX slashes so the same
// source can be reused by the shell gate (which sees raw command strings).
// Patterns are tuned NOT to catch innocent look-alikes (keymap.ts, monkey.json,
// awsome-notes.md, credentials-helper.ts) — extension blocks are end-anchored and
// directory blocks require the literal `.aws/` / `.ssh/` boundaries.
export const SECRET_FILE_PATTERNS: RegExp[] = [
  /\.credentials\.json/i, // cloud SDK saved creds
  /[\\/]\.aws[\\/]/i, // AWS creds/config dir
  /[\\/]\.ssh[\\/]/i, // SSH keys/known_hosts dir
  /(^|[\\/])id_rsa/i, // SSH private (and id_rsa.pub) key
  /[\\/]gh[\\/]hosts\.yml/i, // GitHub CLI auth token store
  /\.git-credentials/i, // git stored credentials
  /\.pem($|["'\s])/i, // private-key / cert bundle
  /\.pfx($|["'\s])/i, // PKCS#12 key bundle
  /\.key($|["'\s])/i, // private-key file
];

/** True if a path/command references a hard-blocked secret file. */
export function matchSecretFile(s: string): RegExp | null {
  for (const re of SECRET_FILE_PATTERNS) {
    if (re.test(s)) return re;
  }
  return null;
}

export function buildPathAllowlist(cfg: AllowlistConfig): (absPath: string) => AllowDecision {
  const matchers = cfg.roots.map((root) =>
    picomatch(root.replace(/\\/g, "/"), { nocase: true, dot: true }),
  );

  return (absPath: string): AllowDecision => {
    const resolved = normalize(resolve(absPath)).replace(/\\/g, "/");

    if (ENV_PATTERN.test(resolved)) {
      return { ok: false, reason: `path matches .env hard-block: ${resolved}` };
    }
    const secret = matchSecretFile(resolved);
    if (secret) {
      return { ok: false, reason: `path matches secret-file hard-block (${secret.source}): ${resolved}` };
    }
    for (const m of matchers) {
      if (m(resolved)) return { ok: true };
    }
    return { ok: false, reason: `path not in allowlist: ${resolved}` };
  };
}
