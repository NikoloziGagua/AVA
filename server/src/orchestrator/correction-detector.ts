const CORRECTION_RE = /^(no|nope|wrong|actually|stop|don't|do not|instead)\b[\s,:.\-—]/i;
const STALENESS_MS = 5 * 60 * 1000;

export type DetectInput = {
  userText: string;
  priorRole: "user" | "assistant" | "system" | null;
  priorAtMs: number | null;
  nowMs: number;
};

export function detectCorrection(input: DetectInput): boolean {
  if (input.priorRole !== "assistant") return false;
  if (input.priorAtMs == null) return false;
  if (input.nowMs - input.priorAtMs > STALENESS_MS) return false;
  return CORRECTION_RE.test(input.userText);
}

/**
 * Build the observation text for an auto-learned correction. We pair the
 * assistant turn that drew the pushback with the user's objection, so the
 * stored memory records WHAT was wrong — not just an uninformative "no". The
 * bare negation ("no, don't") carries no signal on its own; the assistant line
 * it rejected is what makes the entry actionable later.
 */
export function formatCorrection(opts: { priorAssistant: string; userText: string }): string {
  const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
  const ava = collapse(opts.priorAssistant).slice(0, 160);
  const sir = collapse(opts.userText).slice(0, 200);
  return ava
    ? `(corrected) Ava said: "${ava}" — Sir: "${sir}"`
    : `(corrected) ${sir}`;
}
