import { scrubSecrets } from "../security/scrub.js";

const MAX_STRING_LENGTH = 20_000;
const MAX_DEPTH = 12;
const MAX_COLLECTION_ITEMS = 200;
const MAX_VISITED_VALUES = 5_000;
const TRUNCATED = "[truncated by Explorer]";

const SECRET_FIELD_KEY_RE =
  /pass(word|code|wd)?$|passwd|secret|token|otp|^pin$|^code$|credential|api[_-]?key/i;
const SENSITIVE_HEADER_KEY_RE =
  /^(authorization|proxy-authorization|cookie|cookies|cookie[_-]?jar|set-cookie|x-api-key)$/i;
const SPOKEN_SECRET_RE =
  /\b(password|passcode|api[_ -]?key|access[_ -]?token|secret|otp|verification[_ -]?code)\s+(is|was|=|:)\s*[^\s,;]+/gi;

// Raw HTTP transcripts and command output commonly contain headers as text
// rather than structured objects. Redact the complete value through end-of-line
// so semicolon-separated cookies cannot leak piecemeal.
const RAW_SENSITIVE_HEADER_RE =
  /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key)\s*([:=])\s*[^\r\n]*/gi;
const CLI_SECRET_FLAG_RE =
  /(^|\s)(--(?:password|passwd|pass|token|access-token|api-key|apikey|secret|cookie|cookie-jar)|-[pu])(?:\s*=\s*|\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gim;
const SECRET_ENV_ASSIGNMENT_RE =
  /\b((?:[A-Z0-9]+_)*(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|APIKEY|COOKIE)(?:_[A-Z0-9_]+)?)\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi;
const URL_USERINFO_RE =
  /\b((?:https?|ftp):\/\/)[^/\s:@]+:[^@\s/]+@/gi;
const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
const UNTERMINATED_PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*$/g;

type SanitiseContext = {
  visited: number;
  seen: WeakSet<object>;
};

function isSensitiveKey(key: string): boolean {
  return SECRET_FIELD_KEY_RE.test(key) || SENSITIVE_HEADER_KEY_RE.test(key);
}

function isSensitiveHeaderTuple(value: unknown[]): boolean {
  return typeof value[0] === "string" && SENSITIVE_HEADER_KEY_RE.test(value[0]);
}

function scrubString(
  value: string,
  context: SanitiseContext,
  depth: number,
): string {
  // Run block removal before the shared scrubber: its legacy PEM rule masks
  // only the BEGIN line, which would otherwise leave the base64 key body behind
  // and also prevent this complete-block matcher from recognising it.
  let safe = value
    .replace(PRIVATE_KEY_BLOCK_RE, "[private key redacted]")
    .replace(UNTERMINATED_PRIVATE_KEY_RE, "[private key redacted]");
  safe = scrubSecrets(safe)
    .replace(SPOKEN_SECRET_RE, "$1 $2 ***")
    .replace(
      CLI_SECRET_FLAG_RE,
      (_match, prefix: string, flag: string) => `${prefix}${flag} ***`,
    )
    .replace(
      SECRET_ENV_ASSIGNMENT_RE,
      (_match, name: string) => `${name}=***`,
    )
    .replace(URL_USERINFO_RE, "$1***:***@")
    .replace(
      RAW_SENSITIVE_HEADER_RE,
      (_match, name: string, separator: string) => `${name}${separator} ***`,
    );

  // Tool output is sometimes a JSON document encoded inside a string. Parse
  // only complete object/array strings and run the same bounded key-aware walk;
  // ordinary prose and logs retain their original useful formatting.
  const trimmed = safe.trim();
  if (
    depth < MAX_DEPTH &&
    ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      safe = JSON.stringify(sanitiseBounded(parsed, context, depth + 1));
    } catch {
      // Malformed/partial JSON remains useful evidence after text scrubbing.
    }
  }

  if (safe.length <= MAX_STRING_LENGTH) return safe;
  return `${safe.slice(0, MAX_STRING_LENGTH)}\n${TRUNCATED}`;
}

function sanitiseBounded(
  value: unknown,
  context: SanitiseContext,
  depth: number,
): unknown {
  context.visited += 1;
  if (context.visited > MAX_VISITED_VALUES || depth > MAX_DEPTH) return TRUNCATED;

  if (typeof value === "string") return scrubString(value, context, depth);
  if (!value || typeof value !== "object") return value;
  if (context.seen.has(value)) return "[circular value omitted by Explorer]";
  context.seen.add(value);

  if (Array.isArray(value)) {
    // Covers common `headers: [["authorization", "Basic ..."]]` output.
    if (isSensitiveHeaderTuple(value)) return [value[0], "***"];
    const safe = value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((child) => sanitiseBounded(child, context, depth + 1));
    if (value.length > MAX_COLLECTION_ITEMS) {
      safe.push(`[${value.length - MAX_COLLECTION_ITEMS} more items ${TRUNCATED}]`);
    }
    return safe;
  }

  let entries: Array<[string, unknown]>;
  try {
    entries = Object.entries(value as Record<string, unknown>);
  } catch {
    return "[unreadable value omitted by Explorer]";
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of entries.slice(0, MAX_COLLECTION_ITEMS)) {
    if (isSensitiveKey(key)) {
      output[key] = child === null || child === undefined || child === "" ? child : "***";
    } else {
      output[key] = sanitiseBounded(child, context, depth + 1);
    }
  }
  if (entries.length > MAX_COLLECTION_ITEMS) {
    output.__explorer_truncated__ =
      `${entries.length - MAX_COLLECTION_ITEMS} more fields ${TRUNCATED}`;
  }
  return output;
}

/**
 * Explorer's independent, bounded redaction boundary. It runs before
 * persistence and again when records are read. Besides normal credentials, it
 * removes structured and raw auth/cookie headers while preserving safe evidence
 * such as status, content type, safe URL components, timing, and ordinary
 * output text. Common command-line credential forms are scrubbed too.
 */
export function sanitiseExplorerValue(value: unknown): unknown {
  return sanitiseBounded(value, { visited: 0, seen: new WeakSet() }, 0);
}

export function sanitiseExplorerText(value: string | null): string | null {
  if (value === null) return null;
  return scrubString(value, { visited: 0, seen: new WeakSet() }, 0);
}
