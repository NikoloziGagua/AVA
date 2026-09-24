import { isExplicitMemoryRecall } from "../memory-index/auto-retrieve.js";

/**
 * How long a voice turn may wait for automatic memory before AVA starts
 * answering. Measured on real voice turns (2026-09-24): the embedding call alone
 * took 200-950 ms (1.8 s cold), and every one of the last eight turns found no
 * usable memory, so waiting in full delayed replies for nothing. Other voice
 * stacks (mem0, Zep, Pipecat guidance) likewise keep retrieval off the critical
 * path or cap it.
 */
export const VOICE_MEMORY_BUDGET_MS = 350;
/** When Sir explicitly asks AVA to remember something, accuracy is worth a longer wait. */
export const VOICE_RECALL_BUDGET_MS = 1_500;

export function voiceMemoryBudgetMs(query: string): number {
  return isExplicitMemoryRecall(query) ? VOICE_RECALL_BUDGET_MS : VOICE_MEMORY_BUDGET_MS;
}

export type BudgetOutcome<T> =
  | { status: "ready"; value: T; elapsedMs: number }
  | { status: "late"; elapsedMs: number }
  | { status: "failed"; error: unknown; elapsedMs: number };

/**
 * Wait for `work` at most `budgetMs`. The work itself is never cancelled: a
 * "late" caller can still observe it (for the record), but must not apply it to
 * a turn that has already been answered.
 */
export function withinBudget<T>(
  work: Promise<T>,
  budgetMs: number,
  now: () => number = () => performance.now(),
): Promise<BudgetOutcome<T>> {
  const started = now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: BudgetOutcome<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ status: "late", elapsedMs: now() - started }), Math.max(0, budgetMs));
    work.then(
      (value) => finish({ status: "ready", value, elapsedMs: now() - started }),
      (error: unknown) => finish({ status: "failed", error, elapsedMs: now() - started }),
    );
  });
}
