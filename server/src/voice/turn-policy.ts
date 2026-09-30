/**
 * Hands-free speech occasionally arrives as two transcription items even when
 * semantic VAD is enabled ("I want you to go" / "into WhatsApp").  A realtime
 * model must not answer or call a tool from the first half.  This module keeps
 * that decision deterministic and testable instead of trusting a prompt.
 */

const STANDALONE_TURNS = new Set([
  "yes",
  "no",
  "stop",
  "cancel",
  "pause",
  "continue",
  "resume",
  "wait",
  "listen",
  "repeat",
  "again",
  "hello",
  "hi",
  "hey",
  "thanks",
  "sorry",
  "help",
  "why",
  "where",
  "when",
  "who",
  "how",
]);

const ACTION_VERBS = new Set([
  "open",
  "close",
  "find",
  "search",
  "send",
  "message",
  "call",
  "run",
  "start",
  "launch",
  "show",
  "read",
  "write",
  "create",
  "make",
  "move",
  "copy",
  "delete",
  "remove",
  "check",
  "look",
  "use",
  "type",
  "press",
  "focus",
  "remember",
  "forget",
]);

const NEEDS_COMPLEMENT = new Set([
  "open",
  "find",
  "search",
  "send",
  "message",
  "call",
  "run",
  "start",
  "launch",
  "show",
  "read",
  "write",
  "create",
  "make",
  "move",
  "copy",
  "delete",
  "remove",
  "check",
  "use",
  "type",
  "press",
  "focus",
  "tell",
  "give",
  "take",
  "put",
  "get",
  "go",
]);

const TRAILING_CONNECTORS = new Set([
  "a",
  "an",
  "the",
  "to",
  "for",
  "from",
  "with",
  "without",
  "into",
  "onto",
  "on",
  "at",
  "of",
  "about",
  "and",
  "or",
  "but",
  "because",
  "if",
  "when",
  "while",
  "that",
  "which",
  "who",
  "whose",
  "my",
  "your",
  "our",
  "their",
  "this",
  "these",
  "those",
]);

const CONTINUATION_STARTS = new Set([
  "to",
  "into",
  "onto",
  "on",
  "at",
  "for",
  "from",
  "with",
  "without",
  "about",
  "and",
  "or",
  "but",
  "because",
  "so",
  "then",
  "that",
  "which",
  "who",
  "where",
  "when",
]);

function wordsIn(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Conservative structural test for an utterance that visibly trails off.
 *
 * It intentionally targets the failure signatures seen in AVA's real voice
 * traces ("You are", "What", "The first step", "I want you to go") while
 * allowing terse, complete commands such as "open Chrome", "stop", and
 * "resume". Push-to-talk bypasses this policy because its boundary is explicit.
 */
export function looksLikeIncompleteVoiceTurn(text: string): boolean {
  const words = wordsIn(text);
  if (words.length === 0) return true;

  const phrase = words.join(" ");
  const first = words[0]!;
  const last = words.at(-1)!;

  if (words.length === 1) return !STANDALONE_TURNS.has(first);
  if (TRAILING_CONNECTORS.has(last)) return true;

  if (/^(can|could|would|will|should|do|does|did|are|is|was|were|have|has)\s+(you|we|i|it|they|he|she)$/.test(phrase)) {
    return true;
  }
  if (/^(i|you|we|they|he|she|it)\s+(am|is|are|was|were|will|would|can|could|should|have|has|had|want|need|mean)$/.test(phrase)) {
    return true;
  }
  if (/^(i|you|we|they|he|she|it)\s+(am|is|are|was|were)\s+(just|really|very|still|slowly|currently)$/.test(phrase)) {
    return true;
  }
  if (/^(i (?:want|need|would like)(?: you)? to|can you|could you|would you|will you|please)$/.test(phrase)) {
    return true;
  }

  // "Can you open" / "I want you to go" still lack the object or destination.
  if (NEEDS_COMPLEMENT.has(last)) {
    const isClearTwoWordImperative = words.length === 2 && ACTION_VERBS.has(first);
    if (!isClearTwoWordImperative) return true;
  }

  // A short determiner-led noun phrase ("the first step") has no predicate.
  if (
    words.length <= 4 &&
    ["the", "a", "an", "this", "that", "my", "your", "our"].includes(first) &&
    !/(ed|ing|s)$/.test(last)
  ) {
    return true;
  }

  if (words.length === 2) {
    if (ACTION_VERBS.has(first)) return false;
    if (["what", "which", "where", "when", "why", "how", "who"].includes(first)) return false;
    if (last === "please") return false;
    if (["good", "thank", "thanks", "sorry", "hello", "hey"].includes(first)) return false;
    // Pronoun + an inflected/past-tense verb is a compact but complete statement
    // ("she smiled", "it worked").
    if (
      ["i", "you", "we", "they", "he", "she", "it"].includes(first) &&
      /(ed|s|ing)$/.test(last)
    ) {
      return false;
    }
    return true;
  }

  return false;
}

export function looksLikeContinuationFragment(text: string): boolean {
  const first = wordsIn(text)[0];
  return !!first && CONTINUATION_STARTS.has(first);
}

export interface VoiceTurnOffer {
  kind: "hold" | "emit";
  text: string;
  itemIds: string[];
  /** Old upstream items replaced by a new, independently-complete turn. */
  discardedItemIds: string[];
}

/**
 * Accumulates only structurally-incomplete automatic-VAD turns.  If the next
 * transcription is independently complete, it replaces the stale fragment;
 * otherwise both pieces are joined and re-evaluated.
 */
export class VoiceTurnAccumulator {
  private pendingText = "";
  private pendingItemIds: string[] = [];

  get pending(): boolean {
    return this.pendingText.length > 0;
  }

  offer(text: string, itemId?: string | null): VoiceTurnOffer {
    const clean = text.replace(/\s+/g, " ").trim();
    const ids = itemId ? [itemId] : [];

    if (!this.pending) {
      if (!looksLikeIncompleteVoiceTurn(clean)) {
        return { kind: "emit", text: clean, itemIds: ids, discardedItemIds: [] };
      }
      this.pendingText = clean;
      this.pendingItemIds = ids;
      return { kind: "hold", text: clean, itemIds: [...ids], discardedItemIds: [] };
    }

    // A fresh complete command is more likely a restart/correction than the tail
    // of "You are …". Preserve only the new command and delete the stale item.
    if (!looksLikeIncompleteVoiceTurn(clean) && !looksLikeContinuationFragment(clean)) {
      const discardedItemIds = [...this.pendingItemIds];
      this.pendingText = "";
      this.pendingItemIds = [];
      return { kind: "emit", text: clean, itemIds: ids, discardedItemIds };
    }

    const combined = `${this.pendingText} ${clean}`.replace(/\s+/g, " ").trim();
    this.pendingText = combined;
    this.pendingItemIds.push(...ids);
    if (looksLikeIncompleteVoiceTurn(combined)) {
      return {
        kind: "hold",
        text: combined,
        itemIds: [...this.pendingItemIds],
        discardedItemIds: [],
      };
    }

    const itemIds = [...this.pendingItemIds];
    this.pendingText = "";
    this.pendingItemIds = [];
    return { kind: "emit", text: combined, itemIds, discardedItemIds: [] };
  }

  expire(): { text: string; itemIds: string[] } | null {
    if (!this.pending) return null;
    const expired = { text: this.pendingText, itemIds: [...this.pendingItemIds] };
    this.pendingText = "";
    this.pendingItemIds = [];
    return expired;
  }

  clear(): void {
    this.pendingText = "";
    this.pendingItemIds = [];
  }
}
