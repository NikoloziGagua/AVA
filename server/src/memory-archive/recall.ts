import type { Db } from "../state/db.js";
import type { MemoryIndexService } from "../memory-index/store.js";
import { ftsQuery, type MemoryArchive } from "./archive.js";
import { AUTOMATION_TEXT, dublinStamp } from "./extractor.js";
import type { MemoryKind, MemoryRecord } from "./types.js";

// Deep recall (proposal requirement 4: basic from the start). It answers from
// the archive first and shows the messages each memory came from; when the
// archive has nothing, it searches the conversations themselves, because much
// of what was only discussed never becomes a memory. Messages behind a forget
// are never quoted.

export type RecallSource = { messageId: number; at: number; speaker: "Niko" | "AVA"; excerpt: string };
export type RecalledMemory = { record: MemoryRecord; score: number; sources: RecallSource[] };
export type RecalledMessage = RecallSource & { sessionId: string; sessionTitle: string; matched: number; voice: boolean };

type MessageRow = { id: number; session_id: string; role: string; content: string; metadata: string | null; created_at: number; title: string | null };

function excerpt(text: string, terms: string[], max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const lower = clean.toLowerCase();
  const hit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(hit - 80, clean.length - max));
  return `${start > 0 ? "..." : ""}${clean.slice(start, start + max)}${start + max < clean.length ? "..." : ""}`;
}

function termsOf(query: string): string[] {
  const match = ftsQuery(query);
  return match ? [...match.matchAll(/"([^"]+)"/g)].map((m) => m[1]!) : [];
}

export function recall(db: Db, archive: MemoryArchive, query: string, opts: {
  from?: number;
  to?: number;
  kinds?: readonly MemoryKind[];
  memoryLimit?: number;
  messageLimit?: number;
} = {}): { memories: RecalledMemory[]; messages: RecalledMessage[] } {
  const terms = termsOf(query);
  const hits = archive.search(query, {
    includeHistory: true, limit: opts.memoryLimit ?? 6, kinds: opts.kinds, from: opts.from, to: opts.to,
  });
  const allSourceIds = hits.flatMap((hit) => hit.record.sourceMessageIds);
  const forgotten = archive.forgottenMessageIds(allSourceIds);
  const sourceRow = db.prepare("SELECT id, role, content, created_at FROM messages WHERE id = ?");
  const memories = hits.map((hit) => ({
    ...hit,
    // A source that no longer exists is simply not shown; the memory still stands on its own record.
    sources: hit.record.sourceMessageIds.filter((id) => !forgotten.has(id)).slice(0, 3).flatMap((id) => {
      const row = sourceRow.get(id) as { id: number; role: string; content: string; created_at: number } | undefined;
      return row ? [{ messageId: row.id, at: row.created_at, speaker: row.role === "user" ? "Niko" as const : "AVA" as const, excerpt: excerpt(row.content, terms) }] : [];
    }),
  }));
  const messages: RecalledMessage[] = [];
  // Raw lines are a fallback for what was only discussed and never became a
  // memory. They also hold background audio and pasted text, which the
  // evaluation showed being repeated as fact, so they are searched only when
  // no memory matched, and only a few are shown.
  if (terms.length && !memories.length && (opts.messageLimit ?? 3) > 0) {
    // Terms are quoted words from ftsQuery; LIKE needs its wildcards escaped.
    const likes = terms.slice(0, 8).map((term) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const clauses = likes.map(() => "lower(m.content) LIKE ? ESCAPE '\\'").join(" OR ");
    const rows = db.prepare(`
      SELECT m.id, m.session_id, m.role, m.content, m.metadata, m.created_at, s.title
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE s.deleted_at IS NULL AND s.origin IN ('human', 'unknown') AND m.role IN ('user', 'assistant')
        AND (${clauses})
        ${opts.from !== undefined ? "AND m.created_at >= ?" : ""} ${opts.to !== undefined ? "AND m.created_at <= ?" : ""}
      ORDER BY m.created_at DESC LIMIT 400
    `).all(...likes, ...(opts.from !== undefined ? [opts.from] : []), ...(opts.to !== undefined ? [opts.to] : [])) as MessageRow[];
    const blocked = archive.forgottenMessageIds(rows.map((row) => row.id));
    const cited = new Set(memories.flatMap((memory) => memory.sources.map((source) => source.messageId)));
    const scored = rows
      .filter((row) => !blocked.has(row.id) && !cited.has(row.id) && !(row.role === "user" && AUTOMATION_TEXT.test(row.content)))
      .map((row) => {
        const lower = row.content.toLowerCase();
        return { row, matched: terms.filter((term) => lower.includes(term)).length };
      })
      .filter((item) => item.matched >= Math.min(2, terms.length))
      // More terms first; Niko's own words before AVA's; then the most recent.
      .sort((a, b) => b.matched - a.matched || (a.row.role === "user" ? -1 : 1) - (b.row.role === "user" ? -1 : 1) || b.row.created_at - a.row.created_at);
    for (const { row, matched } of scored.slice(0, opts.messageLimit ?? 3)) {
      let voice = false;
      try { voice = (JSON.parse(row.metadata ?? "{}") as { inputModality?: string }).inputModality === "voice"; } catch { /* plain text */ }
      messages.push({
        messageId: row.id, at: row.created_at, speaker: row.role === "user" ? "Niko" : "AVA", voice,
        excerpt: excerpt(row.content, terms), sessionId: row.session_id, sessionTitle: row.title ?? "", matched,
      });
    }
  }
  return { memories, messages };
}

function provenance(record: MemoryRecord): string {
  const who = { stated: "Niko said", decided: "Niko decided", requested: "Niko asked me to remember", discussed: "discussed, not decided", inferred: "my inference" }[record.speechAct];
  const when = record.status === "history" && record.validTo !== null
    ? `${who} ${dublinStamp(record.saidAt)}; no longer current since ${dublinStamp(record.validTo)}`
    : `${who} ${dublinStamp(record.saidAt)}`;
  return record.status === "unconfirmed" ? `${when}; not confirmed by Niko` : when;
}

export type RecalledIdea = { kind: string; title: string; summary: string; savedAt: number };

/**
 * Ideas and research saved in the older idea index (summaries of developed
 * discussions). Keyword-only, never the development log, and only entries
 * whose source conversation still verifies.
 */
export async function recallIdeas(index: MemoryIndexService, query: string, limit = 3): Promise<RecalledIdea[]> {
  try {
    const response = await index.search(query, {
      limit, latestOnly: true, semantic: false, excludeKinds: ["improvement", "artifact"],
    });
    return response.results.filter((result) => result.usable).map((result) => ({
      kind: result.entry.kind, title: result.entry.title, summary: result.entry.summary, savedAt: result.entry.createdAt,
    }));
  } catch {
    return [];
  }
}

/** The recall result as the model reads it: dated, attributed, sources quoted. */
export function formatRecall(result: ReturnType<typeof recall>, ideas: RecalledIdea[] = []): string {
  if (!result.memories.length && !result.messages.length && !ideas.length) {
    return "Nothing in memory or past conversations matches. Say plainly that I don't know, and ask Niko if it matters.";
  }
  const parts: string[] = [];
  if (result.memories.length) {
    parts.push("MEMORIES (newest standing first):");
    for (const memory of result.memories) {
      parts.push(`- [${memory.record.id}${memory.record.status === "history" ? ", history" : ""}] ${memory.record.text} (${provenance(memory.record)})`);
      for (const source of memory.sources) parts.push(`    source #${source.messageId}, ${source.speaker}, ${dublinStamp(source.at)}: "${source.excerpt}"`);
    }
  }
  if (ideas.length) {
    parts.push("SAVED IDEAS AND RESEARCH (summaries saved at the time; a newer memory above wins):");
    for (const idea of ideas) {
      const summary = idea.summary.length > 400 ? `${idea.summary.slice(0, 397)}...` : idea.summary;
      parts.push(`- [${idea.kind}, saved ${dublinStamp(idea.savedAt)}] ${idea.title}: ${summary}`);
    }
  }
  if (result.messages.length) {
    parts.push([
      "UNVERIFIED LINES FROM PAST CONVERSATIONS (not memories). Voice capture can include background audio",
      "and TV; typed lines can be pasted text; AVA's lines are not Niko's decisions. Never state these as facts",
      "about Niko. If one looks relevant, say it came up on that date and ask him.",
    ].join(" "));
    for (const message of result.messages) {
      const who = message.speaker === "Niko" ? (message.voice ? "Niko (voice)" : "Niko") : "AVA";
      parts.push(`- #${message.messageId} ${who}, ${dublinStamp(message.at)}${message.sessionTitle ? `, "${message.sessionTitle}"` : ""}: "${message.excerpt}"`);
    }
  }
  return parts.join("\n");
}
