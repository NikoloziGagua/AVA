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
};

const SYSTEM =
  "You produce concise conversation summaries. Output 6-12 bullet points. Preserve names, numbers, file paths, and outcomes. No preamble, no fences.";

export async function maybeSummarize({
  db,
  sessionId,
  provider,
  threshold = 50,
  keepRecent = 20,
}: SummarizeArgs): Promise<void> {
  const all = listMessages(db, sessionId);
  if (all.length <= threshold) return;

  const cutoffIndex = all.length - keepRecent;
  const toCollapse = all.slice(0, cutoffIndex);
  if (toCollapse.length === 0) return;
  const throughId = toCollapse.at(-1)!.id;

  const existing = getSessionFull(db, sessionId);
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
