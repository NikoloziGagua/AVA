import type { LLMProvider } from "../orchestrator/llm/types.js";
import { distillPlaybook, type RunStep } from "./distill.js";
import { writePlaybook } from "./store.js";
import { prunePlaybooks } from "./mutate.js";

const SOFT_CAP = 50;
const MAX_AGE_DAYS = 60;

export async function maybeCapture(o: {
  memoryDir: string; provider: LLMProvider; goal: string; steps: RunStep[];
  outcome: string; succeeded: boolean; today: string;
}): Promise<void> {
  if (!o.succeeded || o.steps.length < 2) return;
  try {
    const pb = await distillPlaybook({ provider: o.provider, goal: o.goal, steps: o.steps, outcome: o.outcome, today: o.today });
    if (!pb) return;
    writePlaybook(o.memoryDir, pb);
    prunePlaybooks(o.memoryDir, { today: o.today, maxAgeDays: MAX_AGE_DAYS, softCap: SOFT_CAP });
  } catch { /* capture is best-effort; never surface */ }
}
