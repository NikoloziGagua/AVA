import type { Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { updateSummary, getSessionFull } from "../state/sessions.js";
import type { LLMProvider } from "./llm/types.js";

export type SummarizeArgs = {
  db: Db;
  sessionId: string;
  provider: LLMProvider;
  threshold?: number;     // default 50
  keepRecent?: number;    // default 20
  /** Min NEW collapsed messages before re-summarizing (default 10). */
  stride?: number;
};

const SYSTEM =
  "You produce concise conversation summaries. Output 6-12 bullet points. Preserve names, numbers, file paths, and outcomes. No preamble, no fences.";

export async function maybeSummarize({
  db,
  sessionId,
  provider,
  threshold = 50,
  keepRecent = 20,
  stride = 10,
}: SummarizeArgs): Promise<void> {
  const all = listMessages(db, sessionId);
  if (all.length <= threshold) return;

  const cutoffIndex = all.length - keepRecent;
  if (cutoffIndex <= 0) return;

  const existing = getSessionFull(db, sessionId);

  // INCREMENTAL: fold only the messages newer than the previous summary point
  // into the prior summary. The old code re-sent the ENTIRE transcript from
  // message 0 on EVERY turn past the threshold (the cutoff moves each turn, so
  // the dedupe guard never skipped) — O(N²) tokens; at ~300 messages that was
  // ~15-40k side-model tokens per turn, the biggest hidden burner in the app.
  const lastThrough = existing?.summary_through_message_id ?? null;
  const startIndex = lastThrough !== null
    ? all.findIndex((m) => m.id === lastThrough) + 1 // not-found → 0 (full fold, safe fallback)
    : 0;
  const toCollapse = all.slice(Math.max(startIndex, 0), cutoffIndex);
  if (toCollapse.length === 0) return;
  // Stride: don't pay a side-model call for every single new message — let a
  // batch accumulate. Messages between the summary point and `keepRecent` ride
  // raw in the prompt meanwhile, so nothing is lost.
  if (lastThrough !== null && toCollapse.length < stride) return;
  const throughId = toCollapse.at(-1)!.id;
  if (existing?.summary_through_message_id === throughId) return;

  const transcript = toCollapse.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const priorSummary = existing?.summary
    ? `Prior summary (preserve relevant detail):\n${existing.summary}\n\n`
    : "";

  try {
    const text = await provider.complete({
      model: provider.defaultSideModel,
      system: SYSTEM,
      user: priorSummary + transcript,
      maxTokens: 1024,
    });
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    updateSummary(db, sessionId, trimmed, throughId);
  } catch {
    return;
  }
}
