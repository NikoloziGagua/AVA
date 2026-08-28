import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { scrubSecrets } from "../security/scrub.js";
import type {
  CaptureMemoryInput,
  CaptureMemoryResult,
  MemoryEmbedder,
  MemoryEmbedding,
  MemoryIndexEntry,
  MemoryIndexKind,
  MemoryIndexResult,
  MemoryMatchEvidence,
  MemoryPrivacyLevel,
  MemoryRetrievalMode,
  MemorySearchResponse,
  MemorySourceRead,
  MemorySourceEvidence,
  MemorySourceStatus,
} from "./types.js";

type EntryRow = {
  id: string;
  version: number;
  kind: string;
  title: string;
  summary: string;
  conclusions: string;
  open_questions: string;
  next_steps: string;
  tags: string;
  project: string | null;
  project_key: string | null;
  privacy_level: string;
  status: string;
  embedding_status: string;
  source_fingerprint: string;
  created_at: number;
  updated_at: number;
  forgotten_at: number | null;
};

type SourceRow = {
  entry_id: string;
  session_id: string | null;
  source_label: string;
  from_message_id: number;
  through_message_id: number;
  message_count: number;
  content_hash: string;
  availability: string;
  last_verified_at: number | null;
};

type EmbeddingRow = {
  entry_id: string;
  provider: string;
  model: string;
  dimensions: number;
  input_hash: string;
  vector: Buffer;
  created_at: number;
};

type CandidateRow = EntryRow & SourceRow & Partial<EmbeddingRow>;
type MessageRow = { id: number; role: string; content: string };

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from",
  "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our",
  "that", "the", "this", "to", "was", "we", "what", "when", "where", "with",
  "you", "your",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cleanText(value: string | null | undefined, max: number): string {
  return scrubSecrets(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function cleanInline(value: string | null | undefined, max: number): string {
  return cleanText(value, max).replace(/\s+/g, " ");
}

function cleanList(values: readonly string[] | undefined, maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values ?? []) {
    const value = cleanInline(raw, maxLength);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= maxItems) break;
  }
  return result;
}

function parseStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function entryFromRow(row: EntryRow): MemoryIndexEntry {
  return {
    id: row.id,
    version: row.version,
    kind: row.kind as MemoryIndexKind,
    title: scrubSecrets(row.title),
    summary: scrubSecrets(row.summary),
    conclusions: parseStringArray(row.conclusions).map(scrubSecrets),
    openQuestions: parseStringArray(row.open_questions).map(scrubSecrets),
    nextSteps: parseStringArray(row.next_steps).map(scrubSecrets),
    tags: parseStringArray(row.tags).map(scrubSecrets),
    project: row.project ? scrubSecrets(row.project) : null,
    privacyLevel: row.privacy_level as MemoryPrivacyLevel,
    embeddingStatus: row.embedding_status as MemoryIndexEntry["embeddingStatus"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceHash(messages: readonly MessageRow[]): string {
  return sha256(JSON.stringify(messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
  }))));
}

function embeddingInput(entry: MemoryIndexEntry): string {
  // Keep provider input comfortably inside the embedding endpoint's token
  // ceiling even for text whose token-to-character ratio is unusually high.
  return [
    entry.title,
    entry.summary,
    entry.conclusions.length ? `Conclusions: ${entry.conclusions.join(" | ")}` : "",
    entry.openQuestions.length ? `Open questions: ${entry.openQuestions.join(" | ")}` : "",
    entry.nextSteps.length ? `Next steps: ${entry.nextSteps.join(" | ")}` : "",
    entry.tags.length ? `Tags: ${entry.tags.join(", ")}` : "",
    entry.project ? `Project: ${entry.project}` : "",
  ].filter(Boolean).join("\n").slice(0, 6_000);
}

function encodeVector(values: readonly number[]): Buffer {
  if (!values.length || values.length > 8_192 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("embedding vector is invalid");
  }
  const buffer = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function decodeVector(buffer: Buffer, dimensions: number): number[] | null {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 8_192 || buffer.length !== dimensions * 4) {
    return null;
  }
  const values = Array.from({ length: dimensions }, (_, index) => buffer.readFloatLE(index * 4));
  return values.every(Number.isFinite) ? values : null;
}

function cosine(left: readonly number[], right: readonly number[]): number | null {
  if (!left.length || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function tokenRoot(token: string): string {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function tokens(value: string): string[] {
  const result = value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  return [...new Set(result.map(tokenRoot).filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

function lexicalEvidence(query: string, entry: MemoryIndexEntry): { score: number; shared: string[]; exact: boolean } {
  const normalizedQuery = query.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const title = entry.title.toLocaleLowerCase();
  const body = [entry.title, entry.summary, ...entry.conclusions, ...entry.openQuestions, ...entry.nextSteps, ...entry.tags]
    .join(" ").toLocaleLowerCase();
  const queryTokens = tokens(query);
  const entryTokens = new Set(tokens(body));
  const shared = queryTokens.filter((token) => entryTokens.has(token));
  const exact = normalizedQuery.length > 1 && body.includes(normalizedQuery);
  const overlap = queryTokens.length ? shared.length / queryTokens.length : 0;
  const titleOverlap = queryTokens.length
    ? queryTokens.filter((token) => tokens(title).includes(token)).length / queryTokens.length
    : 0;
  return { score: Math.min(1, overlap * 0.7 + titleOverlap * 0.2 + (exact ? 0.35 : 0)), shared, exact };
}

function projectKey(project: string | null | undefined): { display: string | null; key: string | null } {
  const display = cleanInline(project, 80);
  return display
    ? { display, key: display.toLocaleLowerCase() }
    : { display: null, key: null };
}

function sourceReason(status: MemorySourceStatus, count: number): string {
  if (status === "verified") return `The original ${count} conversation message${count === 1 ? "" : "s"} still exist and match the capture fingerprint.`;
  if (status === "changed") return "The referenced conversation range no longer matches its capture fingerprint.";
  return "The original conversation range is no longer available.";
}

export class MemoryIndexService {
  constructor(
    private readonly db: Db,
    private readonly embedder: MemoryEmbedder | null = null,
  ) {}

  private messagesForRange(sessionId: string, fromMessageId: number, throughMessageId: number): MessageRow[] {
    return this.db.prepare(`
      SELECT m.id, m.role, m.content
      FROM messages m
      JOIN sessions s ON s.id = m.session_id AND s.deleted_at IS NULL
      WHERE m.session_id = ? AND m.id BETWEEN ? AND ?
      ORDER BY m.id ASC
    `).all(sessionId, fromMessageId, throughMessageId) as MessageRow[];
  }

  private sourceRow(entryId: string): SourceRow | null {
    return (this.db.prepare("SELECT * FROM memory_index_sources WHERE entry_id = ?")
      .get(entryId) as SourceRow | undefined) ?? null;
  }

  private entryRow(entryId: string, includeForgotten = false): EntryRow | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_index_entries
      WHERE id = ? ${includeForgotten ? "" : "AND status = 'active'"}
    `).get(entryId) as EntryRow | undefined;
    return row ?? null;
  }

  private verifySource(entryId: string, now = Date.now()): MemorySourceEvidence {
    const source = this.sourceRow(entryId);
    if (!source) throw new Error("memory source record is missing");
    let status: MemorySourceStatus = "unavailable";
    if (source.session_id) {
      const messages = this.messagesForRange(source.session_id, source.from_message_id, source.through_message_id);
      const boundariesMatch = messages[0]?.id === source.from_message_id
        && messages.at(-1)?.id === source.through_message_id
        && messages.length === source.message_count;
      if (boundariesMatch) status = sourceHash(messages) === source.content_hash ? "verified" : "changed";
    }
    this.db.prepare(`
      UPDATE memory_index_sources SET availability = ?, last_verified_at = ? WHERE entry_id = ?
    `).run(status, now, entryId);
    return {
      type: "conversation_range",
      label: scrubSecrets(source.source_label),
      sessionId: source.session_id,
      fromMessageId: source.from_message_id,
      throughMessageId: source.through_message_id,
      messageCount: source.message_count,
      status,
      verifiedAt: now,
      reason: sourceReason(status, source.message_count),
    };
  }

  private result(
    row: EntryRow,
    match: MemoryMatchEvidence,
    now = Date.now(),
  ): MemoryIndexResult {
    const source = this.verifySource(row.id, now);
    return { entry: entryFromRow(row), source, match, usable: source.status === "verified" };
  }

  private async storeEmbedding(entry: MemoryIndexEntry): Promise<void> {
    if (!this.embedder) {
      this.db.prepare("UPDATE memory_index_entries SET embedding_status = 'unavailable' WHERE id = ?")
        .run(entry.id);
      return;
    }
    const input = embeddingInput(entry);
    try {
      const embedded = await this.embedder.embed(input);
      const vector = encodeVector(embedded.vector);
      const now = Date.now();
      this.db.transaction(() => {
        this.db.prepare(`
          INSERT INTO memory_index_embeddings (
            entry_id, provider, model, dimensions, input_hash, vector, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(entry_id) DO UPDATE SET
            provider = excluded.provider,
            model = excluded.model,
            dimensions = excluded.dimensions,
            input_hash = excluded.input_hash,
            vector = excluded.vector,
            created_at = excluded.created_at
        `).run(entry.id, embedded.provider, embedded.model, embedded.vector.length, sha256(input), vector, now);
        this.db.prepare("UPDATE memory_index_entries SET embedding_status = 'ready', updated_at = ? WHERE id = ? AND status = 'active'")
          .run(now, entry.id);
      })();
    } catch {
      this.db.prepare("UPDATE memory_index_entries SET embedding_status = 'unavailable' WHERE id = ? AND status = 'active'")
        .run(entry.id);
    }
  }

  async capture(input: CaptureMemoryInput): Promise<CaptureMemoryResult> {
    if (!Number.isInteger(input.fromMessageId) || !Number.isInteger(input.throughMessageId)
      || input.fromMessageId < 1 || input.throughMessageId < input.fromMessageId) {
      throw new Error("invalid conversation message range");
    }
    const messages = this.messagesForRange(input.sessionId, input.fromMessageId, input.throughMessageId);
    if (!messages.length || messages[0]?.id !== input.fromMessageId || messages.at(-1)?.id !== input.throughMessageId) {
      throw new Error("conversation range was not found");
    }
    if (messages.length > 80) throw new Error("conversation range exceeds 80 messages");
    const title = cleanInline(input.title, 160);
    const summary = cleanText(input.summary, 6_000);
    if (!title || !summary) throw new Error("memory title and summary are required");
    const privacyLevel = input.privacyLevel ?? "personal";
    const project = projectKey(input.project);
    if (privacyLevel === "project" && !project.key) throw new Error("project privacy requires a project");
    const conclusions = cleanList(input.conclusions, 12, 600);
    const openQuestions = cleanList(input.openQuestions, 12, 600);
    const nextSteps = cleanList(input.nextSteps, 12, 600);
    const tags = cleanList(input.tags, 16, 48);
    const hash = sourceHash(messages);
    const fingerprint = sha256(JSON.stringify({
      type: "conversation_range",
      sessionId: input.sessionId,
      from: input.fromMessageId,
      through: input.throughMessageId,
      hash,
      project: project.key,
      privacyLevel,
    }));
    const prior = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
      .get(fingerprint) as EntryRow | undefined;
    if (prior?.status === "forgotten") throw new Error("this exact source range was deliberately forgotten");

    let row = prior;
    let created = false;
    if (!row) {
      const session = this.db.prepare("SELECT title FROM sessions WHERE id = ?")
        .get(input.sessionId) as { title: string | null } | undefined;
      if (!session) throw new Error("source conversation was not found");
      const id = `memory_${nanoid(14)}`;
      const now = Date.now();
      const sourceLabel = cleanInline(session.title || "AVA conversation", 160);
      const embeddingStatus = this.embedder ? "pending" : "unavailable";
      this.db.transaction(() => {
        this.db.prepare(`
          INSERT OR IGNORE INTO memory_index_entries (
            id, version, kind, title, summary, conclusions, open_questions,
            next_steps, tags, project, project_key, privacy_level, status,
            embedding_status, source_fingerprint, created_at, updated_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
        `).run(
          id, input.kind, title, summary, JSON.stringify(conclusions), JSON.stringify(openQuestions),
          JSON.stringify(nextSteps), JSON.stringify(tags), project.display, project.key,
          privacyLevel, embeddingStatus, fingerprint, now, now,
        );
        const inserted = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
          .get(fingerprint) as EntryRow;
        if (inserted.id === id) {
          this.db.prepare(`
            INSERT INTO memory_index_sources (
              entry_id, session_id, source_label, from_message_id,
              through_message_id, message_count, content_hash, availability,
              last_verified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?)
          `).run(id, input.sessionId, sourceLabel, input.fromMessageId, input.throughMessageId, messages.length, hash, now);
          created = true;
        }
      })();
      row = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
        .get(fingerprint) as EntryRow;
    }

    if (row.embedding_status !== "ready") {
      await this.storeEmbedding(entryFromRow(row));
      row = this.entryRow(row.id)!;
    }
    return {
      created,
      result: this.result(row, {
        mode: "recent",
        reason: created ? "Captured from this verified conversation range." : "This exact conversation range was already indexed; AVA reused it instead of duplicating it.",
        semanticScore: null,
        lexicalScore: 0,
        sharedTerms: [],
      }),
    };
  }

  private candidateRows(project: string | null | undefined): CandidateRow[] {
    const scope = projectKey(project).key;
    return this.db.prepare(`
      SELECT e.*, s.entry_id, s.session_id, s.source_label, s.from_message_id,
             s.through_message_id, s.message_count, s.content_hash, s.availability,
             s.last_verified_at, b.provider, b.model, b.dimensions, b.input_hash,
             b.vector, b.created_at AS embedding_created_at
      FROM memory_index_entries e
      JOIN memory_index_sources s ON s.entry_id = e.id
      LEFT JOIN memory_index_embeddings b ON b.entry_id = e.id
      WHERE e.status = 'active'
        AND (e.privacy_level = 'personal' OR (? IS NOT NULL AND e.project_key = ?))
      ORDER BY e.updated_at DESC, e.id ASC
      LIMIT 500
    `).all(scope, scope) as CandidateRow[];
  }

  async search(query: string, options: { project?: string | null; limit?: number } = {}): Promise<MemorySearchResponse> {
    const cleanQuery = cleanInline(query, 1_000);
    if (!cleanQuery) throw new Error("memory search query is required");
    const rows = this.candidateRows(options.project);
    const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 8)));
    let queryEmbedding: MemoryEmbedding | null = null;
    let notice: string | null = null;
    if (this.embedder) {
      try { queryEmbedding = await this.embedder.embed(cleanQuery); }
      catch { notice = "Semantic search was unavailable, so AVA used exact and keyword matching only."; }
    } else {
      notice = "No embedding provider is configured; AVA used exact and keyword matching only.";
    }

    const scored = rows.flatMap((row) => {
      const entry = entryFromRow(row);
      const lexical = lexicalEvidence(cleanQuery, entry);
      let semanticScore: number | null = null;
      if (
        queryEmbedding && row.vector && row.provider === queryEmbedding.provider
        && row.model === queryEmbedding.model && row.dimensions === queryEmbedding.vector.length
      ) {
        const stored = decodeVector(row.vector, row.dimensions);
        if (stored) semanticScore = cosine(queryEmbedding.vector, stored);
      }
      if (lexical.score <= 0 && (semanticScore === null || semanticScore < 0.45)) return [];
      const score = lexical.score * 0.48 + Math.max(0, semanticScore ?? 0) * 0.52;
      return [{ row, lexical, semanticScore, score }];
    }).sort((left, right) => right.score - left.score || right.row.updated_at - left.row.updated_at || left.row.id.localeCompare(right.row.id));

    const results = scored.slice(0, limit).map(({ row, lexical, semanticScore }) => {
      const usedSemantic = semanticScore !== null;
      const usedLexical = lexical.score > 0;
      const mode: MemoryRetrievalMode = usedSemantic && usedLexical ? "hybrid" : usedSemantic ? "semantic" : "lexical";
      const parts: string[] = [];
      if (usedSemantic) parts.push(`semantic similarity ${Math.round(Math.max(0, semanticScore) * 100)}%`);
      if (lexical.exact) parts.push("exact phrase match");
      else if (lexical.shared.length) parts.push(`shared terms: ${lexical.shared.slice(0, 6).join(", ")}`);
      const match: MemoryMatchEvidence = {
        mode,
        reason: `Matched by ${parts.join(" plus ") || "bounded retrieval"}. The source is verified separately before use.`,
        semanticScore,
        lexicalScore: lexical.score,
        sharedTerms: lexical.shared.slice(0, 12),
      };
      return this.result(row, match);
    });
    const mode: MemoryRetrievalMode = queryEmbedding
      ? results.some((result) => result.match.lexicalScore > 0) ? "hybrid" : "semantic"
      : "lexical";
    return {
      query: cleanQuery,
      project: projectKey(options.project).display,
      mode,
      semanticAvailable: queryEmbedding !== null,
      notice,
      results,
    };
  }

  listRecent(options: { project?: string | null; limit?: number } = {}): MemorySearchResponse {
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 12)));
    const results = this.candidateRows(options.project).slice(0, limit).map((row) => this.result(row, {
      mode: "recent",
      reason: "Recently captured. The source is verified separately before use.",
      semanticScore: null,
      lexicalScore: 0,
      sharedTerms: [],
    }));
    return {
      query: "",
      project: projectKey(options.project).display,
      mode: "recent",
      semanticAvailable: this.embedder !== null,
      notice: this.embedder ? null : "No embedding provider is configured; searches use exact and keyword matching.",
      results,
    };
  }

  get(entryId: string): MemoryIndexResult | null {
    const row = this.entryRow(entryId);
    if (!row) return null;
    return this.result(row, {
      mode: "recent",
      reason: "Opened by exact memory ID. The source is verified separately before use.",
      semanticScore: null,
      lexicalScore: 0,
      sharedTerms: [],
    });
  }

  readSource(
    entryId: string,
    options: { project?: string | null; maxCharacters?: number } = {},
  ): MemorySourceRead | null {
    const row = this.entryRow(entryId);
    if (!row) return null;
    if (row.privacy_level === "project" && row.project_key !== projectKey(options.project).key) return null;
    const result = this.result(row, {
      mode: "recent",
      reason: "Opened by exact memory ID after scoped retrieval. The source was verified before content was returned.",
      semanticScore: null,
      lexicalScore: 0,
      sharedTerms: [],
    });
    if (!result.usable || !result.source.sessionId) {
      return { result, messages: [], truncated: false, returnedCharacters: 0 };
    }
    const limit = Math.max(1_000, Math.min(40_000, Math.floor(options.maxCharacters ?? 24_000)));
    const sourceMessages = this.messagesForRange(
      result.source.sessionId,
      result.source.fromMessageId,
      result.source.throughMessageId,
    );
    const messages: MemorySourceRead["messages"] = [];
    let returnedCharacters = 0;
    let truncated = false;
    for (const message of sourceMessages) {
      const remaining = limit - returnedCharacters;
      if (remaining <= 0) { truncated = true; break; }
      const scrubbed = scrubSecrets(message.content);
      const content = scrubbed.slice(0, remaining);
      messages.push({ id: message.id, role: message.role, content });
      returnedCharacters += content.length;
      if (content.length < scrubbed.length) { truncated = true; break; }
    }
    return { result, messages, truncated, returnedCharacters };
  }

  forget(entryId: string, expectedVersion: number):
    | { ok: true }
    | { ok: false; reason: "not_found" | "version_conflict"; currentVersion: number | null } {
    const current = this.entryRow(entryId);
    if (!current) return { ok: false, reason: "not_found", currentVersion: null };
    if (current.version !== expectedVersion) {
      return { ok: false, reason: "version_conflict", currentVersion: current.version };
    }
    const now = Date.now();
    const changed = this.db.transaction(() => {
      const updated = this.db.prepare(`
        UPDATE memory_index_entries
        SET status = 'forgotten', embedding_status = 'unavailable',
            forgotten_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND status = 'active' AND version = ?
      `).run(now, now, entryId, expectedVersion);
      if (updated.changes === 1) this.db.prepare("DELETE FROM memory_index_embeddings WHERE entry_id = ?").run(entryId);
      return updated.changes;
    })();
    if (changed !== 1) {
      const latest = this.entryRow(entryId);
      return latest
        ? { ok: false, reason: "version_conflict", currentVersion: latest.version }
        : { ok: false, reason: "not_found", currentVersion: null };
    }
    return { ok: true };
  }
}
