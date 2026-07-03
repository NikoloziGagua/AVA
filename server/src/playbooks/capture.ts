import type { LLMProvider } from "../orchestrator/llm/types.js";
import { distillPlaybook, type RunStep } from "./distill.js";
import { writePlaybook, loadPlaybookIndex, readPlaybook } from "./store.js";
import { prunePlaybooks, mergePlaybook } from "./mutate.js";
import { matchPlaybook } from "./match.js";

const SOFT_CAP = 50;
const MAX_AGE_DAYS = 60;

/**
 * Capture gate. `succeeded` means the run REACHED A FINAL REPLY — not "zero
 * tool failures". Mid-run failures that Ava recovered from are the most
 * valuable material we have (they distill into lessons), so they must not
 * block capture. What does block it:
 *  - fewer than 2 tool steps (nothing procedural to learn)
 *  - a failed LAST step (the model gave up and narrated the failure)
 *  - more failures than successes (the run was mostly flailing)
 */
export function shouldCapture(o: { succeeded: boolean; steps: RunStep[] }): boolean {
  if (!o.succeeded || o.steps.length < 2) return false;
  const last = o.steps[o.steps.length - 1]!;
  if (!last.ok) return false;
  const failed = o.steps.filter((s) => !s.ok).length;
  return failed <= o.steps.length - failed;
}

export async function maybeCapture(o: {
  memoryDir: string; provider: LLMProvider; goal: string; steps: RunStep[];
  outcome: string; succeeded: boolean; today: string;
  /** Wall-clock duration of the run, seconds — seeds the playbook's avg_secs. */
  durationSecs?: number;
  /** Called if capture fails. Capture is best-effort and never surfaces to the
   *  user, but failures must stay observable — a silent swallow once hid a 400
   *  that made the whole feature inert. Defaults to a console.warn. */
  onError?: (err: unknown) => void;
}): Promise<void> {
  if (!shouldCapture(o)) return;
  try {
    const pb = await distillPlaybook({
      provider: o.provider, goal: o.goal, steps: o.steps,
      outcome: o.outcome, today: o.today, durationSecs: o.durationSecs,
    });
    if (!pb) return;
    // Dedup: if an existing playbook already covers this task class (its own
    // trigger+keywords match the fresh trigger, or the slug collides), MERGE
    // instead of writing a near-duplicate or clobbering a proven track record.
    const index = loadPlaybookIndex(o.memoryDir).filter((e) => e.slug !== pb.slug);
    const dupSlug = matchPlaybook({ prompt: `${pb.trigger} ${pb.keywords.join(" ")}`, index })
      ?? (readPlaybook(o.memoryDir, pb.slug) ? pb.slug : null);
    if (dupSlug) {
      mergePlaybook(o.memoryDir, dupSlug, pb, o.today);
    } else {
      writePlaybook(o.memoryDir, pb);
    }
    prunePlaybooks(o.memoryDir, { today: o.today, maxAgeDays: MAX_AGE_DAYS, softCap: SOFT_CAP });
  } catch (err) {
    const report = o.onError
      ?? ((e: unknown) => console.warn("[playbooks] capture failed:", e instanceof Error ? e.message : e));
    report(err);
  }
}
