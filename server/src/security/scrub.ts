// Patterns are applied in order; more-specific patterns must precede the
// generic yaml-ish one so its negative lookahead can skip already-redacted values.
const PATTERNS: Array<{ re: RegExp; replace: string }> = [
  { re: /sk-ant-[A-Za-z0-9_-]{10,}/g, replace: "sk-ant-***" },
  { re: /sk-[A-Za-z0-9]{20,}/g, replace: "sk-***" },
  { re: /AKIA[0-9A-Z]{16}/g, replace: "AKIA***EXAMPLE" },
  { re: /(Bearer\s+)[A-Za-z0-9_\-.~+/]+=*/gi, replace: "$1***" },
  // generic yaml-ish lines — skip already-redacted values (those containing ***)
  {
    re: /\b(api[_-]?key|password|secret|token)\s*[:=]\s*(?![^\s,;]*\*\*\*)[^\s,;]+/gi,
    replace: "$1: ***",
  },
];

export function scrubSecrets(input: string): string {
  let out = input;
  for (const { re, replace } of PATTERNS) out = out.replace(re, replace);
  return out;
}
