// Shell command gate for Ava on Sir's Windows PC.
//
// Policy: ALLOW BY DEFAULT. Sir has authorized Ava to launch any app, open any
// file, and run system commands on his own machine "in seconds" — so launching
// (`start whatsapp:`), opening (`explorer .`), chaining and piping all go
// through. The gate only refuses a curated blocklist of genuinely destructive /
// dangerous operations (recursive force-delete, disk format, registry/system
// wipe, remote-code-exec pipelines, fork bombs) plus the standing .env/secret
// hard-block. Those destructive operations are additionally classified "high"
// risk (see policy/classify.ts) so they still surface Sir's approval veto.
//
// DESTRUCTIVE_PATTERNS is exported so the policy layer and tests share one
// source of truth. The full command string is scanned (not just the first
// token) so a destructive op hidden after a pipe/`&&` is still caught.

/** Genuinely destructive / dangerous operations. Scanned case-insensitively
 *  against the FULL command string. Keep this curated and conservative — it is
 *  the real safety net, so do not let normal launches/commands match. */
export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // recursive / force delete
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf, -fr, -r -f collapsed
  /\brm\s+(-\S+\s+)*-r\b(.*\s)?-f\b/i, // rm -r ... -f (separate flags)
  /\brm\s+(-\S+\s+)*-f\b(.*\s)?-r\b/i, // rm -f ... -r (separate flags)
  /\bdel\s+.*\/[sq]\b/i, // del /s or /q
  /\brd\s+\/s\b/i, // rd /s
  /\brmdir\s+\/s\b/i, // rmdir /s
  /\bRemove-Item\b[\s\S]*-Recurse[\s\S]*-Force|\bRemove-Item\b[\s\S]*-Force[\s\S]*-Recurse/i,
  // disk / format
  /\bformat\b/i,
  /\bdiskpart\b/i,
  /\bcipher\s+\/w/i,
  /\bmkfs/i,
  /\bfdisk\b/i,
  // registry / system wipe & power
  /\breg\s+delete\b/i,
  /\bshutdown\b/i,
  /\bRestart-Computer\b/i,
  /\bStop-Computer\b/i,
  // remote code execution
  /\b(curl|wget|iwr|invoke-webrequest)\b[\s\S]*\|\s*(sh|bash|iex|invoke-expression)\b/i,
  /\bpowershell\b[\s\S]*-e(nc|ncodedcommand)\b/i,
  /\bcertutil\b[\s\S]*-urlcache\b/i,
  // fork bomb
  /:\s*\(\s*\)\s*\{/,
];

const ENV_PATH = /(^|[\\/\s])([^\s\\/]*\.env(\.[a-zA-Z0-9]+)?(\s|$))/i;

export type AllowedResult = { allowed: true } | { allowed: false; reason: string };

/** Find the first destructive pattern a command matches, if any. */
export function matchDestructive(cmd: string): RegExp | null {
  for (const re of DESTRUCTIVE_PATTERNS) {
    if (re.test(cmd)) return re;
  }
  return null;
}

export function isAllowed(input: string): AllowedResult {
  const cmd = input.trim();
  if (cmd.length === 0) return { allowed: false, reason: "empty" };

  // .env / secret access stays hard-blocked.
  if (ENV_PATH.test(" " + cmd + " ")) {
    return { allowed: false, reason: ".env file access blocked" };
  }

  // Destructive / dangerous operations are refused outright.
  const hit = matchDestructive(cmd);
  if (hit) {
    return { allowed: false, reason: `destructive command blocked (matched ${hit.source})` };
  }

  // Everything else is allowed — Sir's authorized machine access.
  return { allowed: true };
}
