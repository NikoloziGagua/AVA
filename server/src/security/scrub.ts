// Patterns are applied in order; more-specific patterns must precede the
// generic yaml-ish one so its negative lookahead can skip already-redacted values.
// sk-ant-* variants are listed before the general sk-* rule so Anthropic keys
// keep their distinct "sk-ant-***" marker.
const PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // PEM private-key blocks (header is enough to redact the whole secret).
  { re: /-----BEGIN[A-Z ]+PRIVATE KEY-----/g, replace: "-----BEGIN PRIVATE KEY----- ***" },

  // Database / message-broker connection strings carrying inline credentials.
  // Redact only the credential segment so host/db context survives.
  {
    re: /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^@\s/]+:[^@\s/]+@/gi,
    replace: "$1://***@",
  },

  // Anthropic OAuth tokens (sk-ant-oat../sk-ant-ort..) and API keys (sk-ant-…).
  { re: /sk-ant-(?:oat|ort)[0-9]{2}-[A-Za-z0-9_-]{20,}/g, replace: "sk-ant-***" },
  { re: /sk-ant-[A-Za-z0-9_-]{10,}/g, replace: "sk-ant-***" },

  // Stripe secret keys.
  { re: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g, replace: "sk_***" },

  // OpenAI keys — broadened so project keys (sk-proj-…) are caught too.
  { re: /sk-[A-Za-z0-9-]{20,}/g, replace: "sk-***" },

  // GitHub tokens: classic PATs/OAuth/app tokens and fine-grained PATs.
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/g, replace: "gh_***" },
  { re: /github_pat_[A-Za-z0-9_]{30,}/g, replace: "github_pat_***" },

  // Google API keys.
  { re: /AIza[0-9A-Za-z_\-]{35}/g, replace: "AIza***" },

  // Slack tokens.
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replace: "xox-***" },

  // Figma personal access tokens.
  { re: /figu[rd]?_[A-Za-z0-9_-]{20,}/g, replace: "figu_***" },

  // Supabase service keys.
  { re: /sba_[A-Za-z0-9]{20,}/g, replace: "sba_***" },

  // AWS access key IDs.
  { re: /AKIA[0-9A-Z]{16}/g, replace: "AKIA***EXAMPLE" },

  // JSON Web Tokens (header.payload.signature, all base64url).
  { re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replace: "***" },

  // Bearer tokens in Authorization headers.
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
