import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { updateSummary, getSessionFull } from "../state/sessions.js";

export type SummarizeArgs = {
  db: Db;
  sessionId: string;
  client: Anthropic;
  threshold?: number;     // default 50
  keepRecent?: number;    // default 20
};

export async function maybeSummarize({
  db,
  sessionId,
  client,
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
    const r = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content:
            priorSummary +
            "Summarize the following conversation transcript in 6-12 bullet points. Preserve names, numbers, file paths, and outcomes. No preamble.\n\n" +
            transcript,
        },
      ],
    });
    const block = r.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return;
    updateSummary(db, sessionId, block.text.trim(), throughId);
  } catch {
    return;
  }
}
