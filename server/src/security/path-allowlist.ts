import picomatch from "picomatch";
import { resolve, normalize, dirname, basename, join } from "node:path";
import { realpathSync } from "node:fs";

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
  // SSH private keys by filename (rsa/dsa/ecdsa/ed25519, +optional .pub). The
  // leading boundary `(?:^|[\s"'\\/=:,;])` accepts a path separator OR a
  // command-string delimiter (space/quote/=/: …) because matchSecretFile runs on
  // BOTH resolved paths and raw shell command strings. The trailing boundary keeps
  // `id_rsa_notes.md` / `id_rsannouncement.txt` (and `valid_rsa`) readable.
  /(?:^|[\s"'\\/=:,;])id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?($|["'\s])/i,
  /[\\/]gh[\\/]hosts\.yml/i, // GitHub CLI auth token store
  /(?:^|[\s"'\\/=:,;])\.git-credentials($|["'\s])/i, // git stored credentials (anchored)
  /\.pem($|["'\s])/i, // private-key / cert bundle
  /\.pfx($|["'\s])/i, // PKCS#12 key bundle
  /\.key($|["'\s])/i, // private-key file (conservative: also catches public.key/license.key)
  // Additional high-value credential stores under the home root (tightly anchored
  // so ordinary files like `my.npmrc.bak` / `config.json` are NOT blocked).
  /(?:^|[\s"'\\/=:,;])\.npmrc($|["'\s])/i, // npm _authToken
  /[\\/]\.docker[\\/]config\.json($|["'\s])/i, // container registry auth
  /[\\/]\.kube[\\/]config($|["'\s])/i, // k8s cluster tokens/certs
  /(?:^|[\s"'\\/=:,;])\.pgpass($|["'\s])/i, // Postgres password file
  /(?:^|[\s"'\\/=:,;])(?:\.netrc|_netrc)($|["'\s])/i, // netrc credentials
  /\.(?:p12|p8|pkcs12|keystore|jks)($|["'\s])/i, // PKCS#12/Java keystores, Apple .p8
  /[\\/]access_tokens\.db($|["'\s])/i, // gcloud saved access tokens
];

/** True if a path/command references a hard-blocked secret file. */
export function matchSecretFile(s: string): RegExp | null {
  for (const re of SECRET_FILE_PATTERNS) {
    if (re.test(s)) return re;
  }
  return null;
}

/** Canonicalize an absolute path through the real filesystem so an NTFS
 *  junction/symlink whose own name is innocent (e.g. `C:/Users/nikug/ml` →
 *  `C:/Users/nikug/.ssh`) cannot smuggle a blocked target past the lexical
 *  regexes. Falls back to the existing-parent's realpath for a not-yet-created
 *  write target, then to the lexical form when nothing resolves. Returns POSIX
 *  slashes. Best-effort and never throws. */
export function canonicalizePath(absPath: string): string {
  const abs = resolve(absPath);
  try {
    return realpathSync.native(abs).replace(/\\/g, "/");
  } catch {
    /* path may not exist yet (write target) — realpath the nearest ancestor */
  }
  try {
    const parent = realpathSync.native(dirname(abs)).replace(/\\/g, "/");
    return normalize(join(parent, basename(abs))).replace(/\\/g, "/");
  } catch {
    return normalize(abs).replace(/\\/g, "/");
  }
}

export function buildPathAllowlist(cfg: AllowlistConfig): (absPath: string) => AllowDecision {
  const matchers = cfg.roots.map((root) =>
    picomatch(root.replace(/\\/g, "/"), { nocase: true, dot: true }),
  );

  return (absPath: string): AllowDecision => {
    const resolved = normalize(resolve(absPath)).replace(/\\/g, "/");
    // Canonical (junction/symlink-resolved) form. The secret/.env hard-blocks are
    // checked against BOTH the lexical and the canonical path — purely additive,
    // so a benign-looking junction that resolves into ~/.ssh is caught without
    // ever newly denying a legitimately-allowed file.
    const canonical = canonicalizePath(absPath);

    if (ENV_PATTERN.test(resolved) || ENV_PATTERN.test(canonical)) {
      return { ok: false, reason: `path matches .env hard-block: ${resolved}` };
    }
    const secret = matchSecretFile(resolved) ?? matchSecretFile(canonical);
    if (secret) {
      return { ok: false, reason: `path matches secret-file hard-block (${secret.source}): ${resolved}` };
    }
    // Allowlist match stays on the lexical path so a root that itself sits behind
    // a junction is not spuriously denied (broad access preserved).
    for (const m of matchers) {
      if (m(resolved)) return { ok: true };
    }
    return { ok: false, reason: `path not in allowlist: ${resolved}` };
  };
}
