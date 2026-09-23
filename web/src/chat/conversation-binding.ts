// Client half of the agentroom contract `i1-conversation-binding`: the helpers
// chat and voice share to ask the server for exactly one conversation.

/**
 * An opaque key that makes one explicit "new conversation" idempotent across
 * retries and reconnects. crypto.getRandomValues is used instead of randomUUID
 * because AVA is also served over plain http on a Tailscale address, which is
 * not a secure context and has no randomUUID.
 */
export function mintBindingRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The exact conversation asked for is gone, or is not one a person can talk in
 * (for example an automated run). The server never substitutes another one, so
 * the UI must let Nika choose instead of silently switching.
 *
 * Structural rather than `instanceof ApiError` so callers work against mocked
 * API modules too.
 */
export function isSessionUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 404 && candidate.code === "session_unavailable";
}

export const SESSION_UNAVAILABLE_MESSAGE = "This conversation is unavailable.";
