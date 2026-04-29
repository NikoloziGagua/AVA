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
