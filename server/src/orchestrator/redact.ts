// Central redaction for tool-call arguments before they leave the tool layer:
// SSE events (activity panel), approval summaries, playbook capture, and logs
// all consume the EMITTED args — never the raw ones the tool executes with.
// Without this, `instagram_login({password: ...})` would spray Sir's password
// across the event stream, the transcript, and distilled playbooks.

const SENSITIVE_KEY_RE = /pass(word|code|wd)?$|passwd|secret|token|otp|^pin$|^code$|credential|api[_-]?key/i;

// Inside string blobs (e.g. a provider's malformed-args sentinel {_raw: "..."}
// carrying raw JSON), scrub sensitive JSON-style fields by pattern.
const BLOB_FIELD_RE = /("(?:pass(?:word|code|wd)?|passwd|secret|token|otp|pin|code|credential|api[_-]?key)[^"]*"\s*:\s*")(?:[^"\\]|\\.)*(")/gi;

export function redactSensitiveArgs<T>(args: T): T {
  if (typeof args === "string") {
    return (args as string).replace(BLOB_FIELD_RE, "$1***$2") as unknown as T;
  }
  if (!args || typeof args !== "object") return args;
  if (Array.isArray(args)) return args.map((v) => redactSensitiveArgs(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k) && (typeof v === "string" ? v.length > 0 : typeof v === "number" || typeof v === "bigint")) {
      // Numbers matter too: a 2FA code emitted as {code: 123456} is just as
      // sensitive as a string.
      out[k] = "***";
    } else if (typeof v === "string") {
      out[k] = v.replace(BLOB_FIELD_RE, "$1***$2");
    } else if (v && typeof v === "object") {
      out[k] = redactSensitiveArgs(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
