// TTS-only text formatter.
//
// Why this exists: the persona addresses the owner as "Sir", and written replies
// surround that vocative with commas ("Yes, Sir, ..."). A TTS engine reads each
// comma as a pause, so spoken output stutters around the word — "Yes <pause> Sir
// <pause> ...". This formatter smooths the spoken form by dropping the commas
// that hug a standalone "Sir" while preserving the word itself and all other
// text. It is applied ONLY at the voice/TTS delivery boundary — persisted chat
// text, displayed transcripts, memory, and persona prompts are never touched.

/**
 * Smooth vocative "Sir" punctuation for speech synthesis.
 *
 * - Removes a comma immediately before or after a standalone "Sir".
 * - Collapses any whitespace runs left behind, and trims.
 * - Preserves the word "Sir" (and its casing) and leaves all other text intact.
 *   Word-like neighbours such as "Sirius" are not affected (whole-word match).
 */
export function formatSpeechText(text: string): string {
  if (typeof text !== "string") return text;
  return text
    // comma immediately after a standalone "Sir": "Sir," → "Sir"
    .replace(/\bSir\b\s*,/g, "Sir")
    // comma immediately before a standalone "Sir": ", Sir" → " Sir"
    .replace(/,\s*\bSir\b/g, " Sir")
    // collapse whitespace runs introduced by the removals
    .replace(/\s+/g, " ")
    .trim();
}
