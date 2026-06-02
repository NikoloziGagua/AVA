import type { LLMProvider } from "../orchestrator/llm/types.js";
import { distillPlaybook, type RunStep } from "./distill.js";
import { writePlaybook } from "./store.js";
import { prunePlaybooks } from "./mutate.js";

const SOFT_CAP = 50;
const MAX_AGE_DAYS = 60;

export async function maybeCapture(o: {
  memoryDir: string; provider: LLMProvider; goal: string; steps: RunStep[];
  outcome: string; succeeded: boolean; today: string;
  /** Called if capture fails. Capture is best-effort and never surfaces to the
   *  user, but failures must stay observable — a silent swallow once hid a 400
   *  that made the whole feature inert. Defaults to a console.warn. */
  onError?: (err: unknown) => void;
}): Promise<void> {
  if (!o.succeeded || o.steps.length < 2) return;
  try {
    const pb = await distillPlaybook({ provider: o.provider, goal: o.goal, steps: o.steps, outcome: o.outcome, today: o.today });
    if (!pb) return;
    writePlaybook(o.memoryDir, pb);
    prunePlaybooks(o.memoryDir, { today: o.today, maxAgeDays: MAX_AGE_DAYS, softCap: SOFT_CAP });
  } catch (err) {
    const report = o.onError
      ?? ((e: unknown) => console.warn("[playbooks] capture failed:", e instanceof Error ? e.message : e));
    report(err);
  }
}
