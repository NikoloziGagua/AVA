export const FIRST_TOKEN_ALLOWLIST = new Set([
  "ls",
  "dir",
  "cat",
  "pwd",
  "git",
  "npm",
  "node",
  "python",
  "pip",
  "where",
  "echo",
]);

const FORBIDDEN_META = /[;&|`$><\n\r]/;
const ENV_PATH = /(^|[\\/\s])([^\s\\/]*\.env(\.[a-zA-Z0-9]+)?(\s|$))/i;

export type AllowedResult = { allowed: true } | { allowed: false; reason: string };

export function isAllowed(input: string): AllowedResult {
  const cmd = input.trim();
  if (cmd.length === 0) return { allowed: false, reason: "empty" };

  if (FORBIDDEN_META.test(cmd)) {
    return { allowed: false, reason: "shell metacharacters not allowed" };
  }
  if (ENV_PATH.test(" " + cmd + " ")) {
    return { allowed: false, reason: ".env file access blocked" };
  }
  const first = cmd.split(/\s+/)[0]!.toLowerCase();
  if (!FIRST_TOKEN_ALLOWLIST.has(first)) {
    return { allowed: false, reason: `command "${first}" not in allowlist` };
  }
  return { allowed: true };
}
