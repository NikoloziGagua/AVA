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

import { matchSecretFile } from "../security/path-allowlist.js";

/** Genuinely destructive / dangerous operations. Scanned case-insensitively
 *  against the FULL command string. Keep this curated and conservative — it is
 *  the real safety net, so do not let normal launches/commands match. */
export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  // recursive / force delete (POSIX rm)
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, // rm -rf, -fr, -r -f collapsed
  /\brm\s+(-\S+\s+)*-r\b(.*\s)?-f\b/i, // rm -r ... -f (separate flags)
  /\brm\s+(-\S+\s+)*-f\b(.*\s)?-r\b/i, // rm -f ... -r (separate flags)
  // PowerShell delete cmdlet/aliases with a Force OR Recurse flag (either alone
  // is destructive — the old rule wrongly required BOTH). Accepts abbreviations
  // -Force/-fo/-f and -Recurse/-rec/-r. Verb must be a delete verb so a bare
  // single-file `rm foo.txt` (no flag) stays allowed.
  /\b(Remove-Item|ri|rm|del)\b[\s\S]*?\s-(Force|Recurse|rec|r|fo|f)\b/i,
  // cmd delete/dir-remove targeting a wildcard or a path (no /s /q required):
  // `del C:\Users\nikug\Documents\*.docx`, `rd C:\path`, `rmdir .\sub`.
  /\b(del|erase|rd|rmdir)\b\s+(?:[^\r\n]*?)(\*|[A-Za-z]:|[\\/])/i,
  // .NET file/directory delete via reflection.
  /\[IO\.(File|Directory)\]::Delete/i,
  // Clear-Content truncates a file's contents in place.
  /\bClear-Content\b/i,
  // Redirection truncation overwriting a file by absolute path (`> C:\...`).
  />\s*["']?[A-Za-z]:/,
  // disk / format — only a drive target (format C:), NOT Format-Table/-List,
  // `--pretty=format:`, `npm run format`, etc.
  /\bformat\s+[A-Za-z]:/i,
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
  // PowerShell encoded command via -e/-en/-enc/.../-encodedcommand (short flag).
  // Negative lookahead skips the benign -e* parameters/operators that share the
  // prefix: -ExecutionPolicy (-ex…), -ErrorAction/-ErrorVariable (-err…),
  // -Encoding (-encodi…), and the comparison/alias operators -eq, -ea, -ev
  // (q/a/v) that appear constantly inside `powershell -Command "… -eq …"`.
  // -EncodedCommand diverges at "-encode" so it is still caught.
  /\b(powershell|pwsh)\b[\s\S]*\s-e(?!x|rr|ncodi|q|a|v)[a-z]*\s/i,
  /\bcertutil\b[\s\S]*-urlcache\b/i,
  // outbound data-upload exfiltration (curl/wget/iwr/irm uploading a file).
  /\b(curl|wget|iwr|invoke-webrequest|invoke-restmethod)\b[\s\S]*(-d\s*@|--data\s*@|-T\s|-InFile\b|@[A-Za-z]:)/i,
  // secret env-var reads and credential dumps (block; also flags control_app high)
  /\$env:[A-Z_]*KEY\b/i,
  /\$env:[A-Z_]*TOKEN\b/i,
  /\$env:[A-Z_]*SECRET\b/i,
  /\bGet-ChildItem\s+Env:/i,
  /\bgh\s+auth\s+token\b/i,
  /\bgit\s+config\s+(--global\s+)?--list\b/i,
  // fork bomb
  /:\s*\(\s*\)\s*\{/,
];

// .env hard-block: any literal ".env" substring (case-insensitive) — covers a
// trailing quote/wildcard/separator (`"C:\app\.env"`, `.env*`, `.env.production`)
// that the old anchored rule let slip past.
const ENV_PATH = /\.env/i;

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

  // .env / secret access stays hard-blocked (any ".env" substring).
  if (ENV_PATH.test(cmd)) {
    return { allowed: false, reason: ".env file access blocked" };
  }

  // Secret files (cloud creds, SSH/private keys, gh token store, git creds) are
  // hard-blocked even within Sir's broad roots — broad access, never exfil.
  const secret = matchSecretFile(cmd);
  if (secret) {
    return { allowed: false, reason: `secret file access blocked (matched ${secret.source})` };
  }

  // Destructive / dangerous operations are refused outright.
  const hit = matchDestructive(cmd);
  if (hit) {
    return { allowed: false, reason: `destructive command blocked (matched ${hit.source})` };
  }

  // Everything else is allowed — Sir's authorized machine access.
  return { allowed: true };
}
