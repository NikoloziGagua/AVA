import type { Message } from "../state/messages.js";

const CONTINUATION_PATTERNS = [
  /^(?:please\s+)?(?:try|retry)(?:\s+(?:it|that|this))?\s+(?:again|agin)\b[\s.!?]*$/i,
  /^(?:please\s+)?(?:continue|resume)(?:\s+(?:it|that|this|the\s+(?:task|work|request)))?[\s.!?]*$/i,
  /^(?:please\s+)?(?:go|carry)\s+on[\s.!?]*$/i,
];

const MAX_OBJECTIVE_CHARS = 1_000;

export function isContextualContinuation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) return false;
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Preserve the real objective for terse retry/continue turns without rewriting
 * immutable request history. The original user text remains stored verbatim;
 * this derived string is used only by current-state observability and receipts.
 */
export function resolveRunObjective(currentText: string, priorMessages: Message[]): string {
  const current = currentText.trim();
  if (!isContextualContinuation(current)) return currentText;

  const prior = [...priorMessages]
    .reverse()
    .find((message) =>
      message.role === "user" &&
      message.content.trim().length > 0 &&
      !isContextualContinuation(message.content)
    );
  if (!prior) return currentText;

  const prefix = "Continue previous objective: ";
  const remaining = MAX_OBJECTIVE_CHARS - prefix.length;
  const objective = prior.content.trim();
  return `${prefix}${objective.length > remaining ? `${objective.slice(0, remaining - 3)}...` : objective}`;
}
