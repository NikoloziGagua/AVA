import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { scrubSecrets } from "../security/scrub.js";
import { MEMORY_CHECKPOINT_KINDS } from "./types.js";
import { MemoryGovernanceStore, type GovernanceWriteBase, type GovernanceWriteResult } from "./governance.js";
import type {
  CaptureMemoryInput,
  CaptureMemoryResult,
  CaptureImprovementInput,
  MemoryCorrection,
  MemoryEmbedder,
  MemoryEmbedding,
  MemoryCheckpointKind,
  MemoryIndexEntry,
  MemoryIndexKind,
  MemoryIndexResult,
  MemoryGovernanceActor,
  MemoryGovernanceMutation,
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
  capture_mode: string;
  capture_reason: string | null;
  thread_id: string | null;
  parent_entry_id: string | null;
  checkpoint_sequence: number;
  checkpoint_kind: string;
  checkpoint_reason: string | null;
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
  source_type: string;
  source_ref: string | null;
  source_label: string;
  from_message_id: number;
  through_message_id: number;
  message_count: number;
  content_hash: string;
  availability: string;
  last_verified_at: number | null;
};

type ImprovementRecordRow = {
  id: string;
  source_kind: string;
  source_id: string;
  commit_sha: string;
  actor: string;
  title: string;
  summary: string;
  capabilities: string;
  changed_files: string;
  verification: string;
  record_fingerprint: string;
  created_at: number;
  indexed_at: number;
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
    captureMode: row.capture_mode === "automatic" ? "automatic" : "explicit",
    captureReason: row.capture_reason ? scrubSecrets(row.capture_reason) : null,
    threadId: row.thread_id ?? row.id,
    parentEntryId: row.parent_entry_id,
    checkpointSequence: row.checkpoint_sequence || 1,
    checkpointKind: (row.checkpoint_kind || "initial") as MemoryCheckpointKind,
    checkpointReason: row.checkpoint_reason ? scrubSecrets(row.checkpoint_reason) : null,
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

function improvementRecordHash(row: Omit<ImprovementRecordRow, "id" | "record_fingerprint" | "indexed_at">): string {
  return sha256(JSON.stringify({
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    commitSha: row.commit_sha,
    actor: row.actor,
    title: row.title,
    summary: row.summary,
    capabilities: parseStringArray(row.capabilities),
    changedFiles: parseStringArray(row.changed_files),
    verification: parseStringArray(row.verification),
    createdAt: row.created_at,
  }));
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

function sourceReason(status: MemorySourceStatus, count: number, type: "conversation_range" | "improvement_record"): string {
  if (type === "improvement_record") {
    if (status === "verified") return "The immutable improvement record still matches and its exact Git commit remains on AVA's current branch.";
    if (status === "changed") return "The stored improvement record no longer matches its original fingerprint.";
    return "The improvement record or its exact Git commit is no longer available on AVA's current branch.";
  }
  if (status === "verified") return `The original ${count} conversation message${count === 1 ? "" : "s"} still exist and match the capture fingerprint.`;
  if (status === "changed") return "The referenced conversation range no longer matches its capture fingerprint.";
  return "The original conversation range is no longer available.";
}

export class MemoryIndexService {
  private readonly governance: MemoryGovernanceStore;
  /** Serializes background backfill so boot reconciliation cannot burst the embedder. */
  private embeddingQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly embedder: MemoryEmbedder | null = null,
    private readonly committedImprovementExists: ((commitSha: string) => boolean) | null = null,
  ) {
    this.governance = new MemoryGovernanceStore(db);
  }

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
    const type = source.source_type === "improvement_record" ? "improvement_record" : "conversation_range";
    let status: MemorySourceStatus = "unavailable";
    let commitSha: string | null = null;
    if (type === "improvement_record" && source.source_ref) {
      const record = this.db.prepare("SELECT * FROM improvement_records WHERE id = ?")
        .get(source.source_ref) as ImprovementRecordRow | undefined;
      if (record) {
        commitSha = record.commit_sha;
        const hash = improvementRecordHash(record);
        if (hash !== source.content_hash || hash !== record.record_fingerprint) status = "changed";
        else if (this.committedImprovementExists?.(record.commit_sha)) status = "verified";
      }
    } else if (source.session_id) {
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
      type,
      label: scrubSecrets(source.source_label),
      sessionId: source.session_id,
      fromMessageId: source.from_message_id,
      throughMessageId: source.through_message_id,
      messageCount: source.message_count,
      reference: source.source_ref ? scrubSecrets(source.source_ref) : null,
      commitSha,
      status,
      verifiedAt: now,
      reason: sourceReason(status, source.message_count, type),
    };
  }

  private result(
    row: EntryRow,
    match: MemoryMatchEvidence,
    now = Date.now(),
  ): MemoryIndexResult {
    const source = this.verifySource(row.id, now);
    const threadId = row.thread_id ?? row.id;
    const aggregate = this.db.prepare(`
      SELECT COUNT(*) AS total, MAX(checkpoint_sequence) AS latest
      FROM memory_index_entries
      WHERE status = 'active' AND COALESCE(thread_id, id) = ?
    `).get(threadId) as { total: number; latest: number | null };
    const originalEntry = entryFromRow(row);
    const governed = this.governance.view(originalEntry);
    const entry = governed.entry;
    return {
      entry,
      originalEntry,
      source,
      match,
      lineage: {
        threadId,
        parentEntryId: entry.parentEntryId,
        sequence: entry.checkpointSequence,
        kind: entry.checkpointKind,
        reason: entry.checkpointReason,
        totalCheckpoints: aggregate.total,
        isLatest: entry.checkpointSequence === (aggregate.latest ?? entry.checkpointSequence),
      },
      governance: {
        threadVersion: governed.threadVersion,
        pinned: governed.pinned,
        state: governed.state,
        retrievalEligible: governed.retrievalEligible,
        corrected: governed.corrected,
        correctionEventId: governed.correctionEventId,
        correctionReason: governed.correctionReason,
        supersededByThreadId: governed.supersededByThreadId,
        conflictWithThreadIds: governed.conflictWithThreadIds,
        updatedAt: governed.updatedAt,
        events: governed.events,
      },
      usable: source.status === "verified",
    };
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

  private queueEmbedding(entry: MemoryIndexEntry): void {
    this.embeddingQueue = this.embeddingQueue
      .then(() => this.storeEmbedding(entry))
      .catch(() => undefined);
  }

  async capture(input: CaptureMemoryInput): Promise<CaptureMemoryResult> {
    if ((input as { kind?: string }).kind === "improvement") {
      throw new Error("improvement memories require an immutable committed source");
    }
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
    const captureMode = input.captureMode === "automatic" ? "automatic" : "explicit";
    const captureReason = cleanInline(input.captureReason, 280) || null;
    const checkpointReason = cleanInline(input.checkpointReason, 280) || null;
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
      let threadId = id;
      let parentEntryId: string | null = null;
      let checkpointSequence = 1;
      let checkpointKind: MemoryCheckpointKind = "initial";
      if (input.parentEntryId) {
        const parent = this.entryRow(input.parentEntryId);
        if (!parent || parent.kind !== "idea" || input.kind !== "idea") {
          throw new Error("memory checkpoint parent is unavailable or incompatible");
        }
        if (input.expectedParentVersion !== parent.version) {
          throw new Error("memory checkpoint parent version is stale");
        }
        const parentSource = this.sourceRow(parent.id);
        if (!parentSource || parentSource.session_id !== input.sessionId) {
          throw new Error("memory checkpoint parent belongs to a different source conversation");
        }
        const parentThreadId = parent.thread_id ?? parent.id;
        const latest = this.db.prepare(`
          SELECT id, checkpoint_sequence
          FROM memory_index_entries
          WHERE status = 'active' AND COALESCE(thread_id, id) = ?
          ORDER BY checkpoint_sequence DESC, created_at DESC, id ASC
          LIMIT 1
        `).get(parentThreadId) as { id: string; checkpoint_sequence: number } | undefined;
        if (!latest || latest.id !== parent.id) throw new Error("memory checkpoint parent is stale");
        if (parentSource.through_message_id >= input.throughMessageId) {
          throw new Error("memory checkpoint does not extend its parent source");
        }
        threadId = parentThreadId;
        parentEntryId = parent.id;
        checkpointSequence = (parent.checkpoint_sequence || 1) + 1;
        checkpointKind = input.checkpointKind
          && (MEMORY_CHECKPOINT_KINDS as readonly string[]).includes(input.checkpointKind)
          && input.checkpointKind !== "initial"
          ? input.checkpointKind
          : "revision";
      }
      this.db.transaction(() => {
        this.db.prepare(`
          INSERT OR IGNORE INTO memory_index_entries (
            id, version, kind, title, summary, conclusions, open_questions,
            next_steps, tags, project, project_key, privacy_level, capture_mode,
            capture_reason, thread_id, parent_entry_id, checkpoint_sequence,
            checkpoint_kind, checkpoint_reason, status, embedding_status,
            source_fingerprint, created_at, updated_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'active', ?, ?, ?, ?)
        `).run(
          id, input.kind, title, summary, JSON.stringify(conclusions), JSON.stringify(openQuestions),
          JSON.stringify(nextSteps), JSON.stringify(tags), project.display, project.key,
          privacyLevel, captureMode, captureReason, threadId, parentEntryId,
          checkpointSequence, checkpointKind, checkpointReason, embeddingStatus,
          fingerprint, now, now,
        );
        const inserted = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
          .get(fingerprint) as EntryRow | undefined;
        if (!inserted) throw new Error("memory checkpoint sequence conflict");
        if (inserted.id === id) {
          this.db.prepare(`
            INSERT INTO memory_index_sources (
              entry_id, session_id, source_label, from_message_id,
              through_message_id, message_count, content_hash, availability,
              last_verified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?)
          `).run(id, input.sessionId, sourceLabel, input.fromMessageId, input.throughMessageId, messages.length, hash, now);
          this.governance.ensureCurrent(threadId, id, now);
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

  /**
   * Index one committed AVA product improvement without manufacturing a chat
   * transcript. The immutable record and reachable Git commit are the source;
   * the compact memory remains only a searchable locator.
   */
  async captureImprovement(input: CaptureImprovementInput): Promise<CaptureMemoryResult> {
    const commitSha = cleanInline(input.commitSha, 64).toLocaleLowerCase();
    if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("improvement commit SHA is invalid");
    if (!this.committedImprovementExists?.(commitSha)) {
      throw new Error("improvement commit is not reachable from AVA's current branch");
    }
    const title = cleanInline(input.title, 160);
    const summary = cleanText(input.summary, 6_000);
    if (!title || !summary) throw new Error("improvement title and summary are required");
    const capabilities = cleanList(input.capabilities, 20, 80);
    const changedFiles = cleanList(input.changedFiles, 120, 260);
    const verification = cleanList(input.verification, 12, 600);
    const tags = cleanList([...(input.tags ?? []), ...capabilities, "ava-improvement"], 16, 48);
    const createdAt = Number.isFinite(input.shippedAt) && (input.shippedAt ?? 0) > 0
      ? Math.floor(input.shippedAt!)
      : Date.now();
    const sourceId = `git:${commitSha}`;
    const recordId = `improvement_${commitSha.slice(0, 20)}`;
    const recordBase = {
      source_kind: input.sourceKind,
      source_id: sourceId,
      commit_sha: commitSha,
      actor: input.actor,
      title,
      summary,
      capabilities: JSON.stringify(capabilities),
      changed_files: JSON.stringify(changedFiles),
      verification: JSON.stringify(verification),
      created_at: createdAt,
    };
    const recordFingerprint = improvementRecordHash(recordBase);
    const now = Date.now();
    this.db.prepare(`
      INSERT OR IGNORE INTO improvement_records (
        id, source_kind, source_id, commit_sha, actor, title, summary,
        capabilities, changed_files, verification, record_fingerprint,
        created_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recordId, recordBase.source_kind, sourceId, commitSha, recordBase.actor,
      title, summary, recordBase.capabilities, recordBase.changed_files,
      recordBase.verification, recordFingerprint, createdAt, now,
    );
    const record = this.db.prepare("SELECT * FROM improvement_records WHERE commit_sha = ?")
      .get(commitSha) as ImprovementRecordRow | undefined;
    if (!record) throw new Error("improvement record could not be created");
    const sourceContentHash = improvementRecordHash(record);
    if (sourceContentHash !== record.record_fingerprint) {
      throw new Error("existing improvement record failed its immutable fingerprint check");
    }
    const fingerprint = sha256(JSON.stringify({
      type: "improvement_record",
      sourceRef: record.id,
      hash: sourceContentHash,
      privacyLevel: "personal",
    }));
    const prior = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
      .get(fingerprint) as EntryRow | undefined;
    if (prior?.status === "forgotten") throw new Error("this exact improvement was deliberately forgotten");

    let row = prior;
    let created = false;
    if (!row) {
      const id = `memory_improvement_${commitSha.slice(0, 16)}`;
      const embeddingStatus = this.embedder ? "pending" : "unavailable";
      this.db.transaction(() => {
        this.db.prepare(`
          INSERT OR IGNORE INTO memory_index_entries (
            id, version, kind, title, summary, conclusions, open_questions,
            next_steps, tags, project, project_key, privacy_level, capture_mode,
            capture_reason, thread_id, parent_entry_id, checkpoint_sequence,
            checkpoint_kind, checkpoint_reason, status, embedding_status,
            source_fingerprint, created_at, updated_at
          ) VALUES (?, 1, 'improvement', ?, ?, ?, '[]', '[]', ?, NULL, NULL,
            'personal', 'automatic', ?, ?, NULL, 1, 'initial', NULL, 'active',
            ?, ?, ?, ?)
        `).run(
          id, record.title, record.summary, record.verification, JSON.stringify(tags),
          `Automatically indexed a committed AVA improvement from ${record.source_kind}.`,
          id, embeddingStatus, fingerprint, record.created_at, now,
        );
        const inserted = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
          .get(fingerprint) as EntryRow | undefined;
        if (!inserted) throw new Error("improvement memory could not be created");
        if (inserted.id === id) {
          this.db.prepare(`
            INSERT INTO memory_index_sources (
              entry_id, session_id, source_type, source_ref, source_label,
              from_message_id, through_message_id, message_count, content_hash,
              availability, last_verified_at
            ) VALUES (?, NULL, 'improvement_record', ?, ?, 0, 0, 0, ?, 'verified', ?)
          `).run(id, record.id, `AVA Git commit ${commitSha.slice(0, 8)}`, sourceContentHash, now);
          this.governance.ensureCurrent(id, id, now);
          created = true;
        }
      })();
      row = this.db.prepare("SELECT * FROM memory_index_entries WHERE source_fingerprint = ?")
        .get(fingerprint) as EntryRow;
    }

    if (row.embedding_status !== "ready") {
      if (input.deferEmbedding) {
        this.queueEmbedding(entryFromRow(row));
      } else {
        await this.storeEmbedding(entryFromRow(row));
        row = this.entryRow(row.id)!;
      }
    }
    return {
      created,
      result: this.result(row, {
        mode: "recent",
        reason: created
          ? "Indexed automatically from a source-verified AVA product commit."
          : "This exact AVA product commit was already indexed; AVA reused it instead of duplicating it.",
        semanticScore: null,
        lexicalScore: 0,
        sharedTerms: [],
      }),
    };
  }

  private candidateRows(project: string | null | undefined, latestOnly = false): CandidateRow[] {
    const scope = projectKey(project).key;
    return this.db.prepare(`
      SELECT e.*, s.entry_id, s.session_id, s.source_type, s.source_ref,
             s.source_label, s.from_message_id,
             s.through_message_id, s.message_count, s.content_hash, s.availability,
             s.last_verified_at, b.provider, b.model, b.dimensions, b.input_hash,
             b.vector, b.created_at AS embedding_created_at
      FROM memory_index_entries e
      JOIN memory_index_sources s ON s.entry_id = e.id
      LEFT JOIN memory_index_embeddings b ON b.entry_id = e.id
      WHERE e.status = 'active'
        AND (e.privacy_level = 'personal' OR (? IS NOT NULL AND e.project_key = ?))
        AND (
          ? = 0 OR e.checkpoint_sequence = (
            SELECT MAX(newest.checkpoint_sequence)
            FROM memory_index_entries newest
            WHERE newest.status = 'active'
              AND COALESCE(newest.thread_id, newest.id) = COALESCE(e.thread_id, e.id)
          )
        )
      ORDER BY e.updated_at DESC, e.id ASC
      LIMIT 500
    `).all(scope, scope, latestOnly ? 1 : 0) as CandidateRow[];
  }

  async search(
    query: string,
    options: { project?: string | null; limit?: number; latestOnly?: boolean; includeHistory?: boolean } = {},
  ): Promise<MemorySearchResponse> {
    const cleanQuery = cleanInline(query, 1_000);
    if (!cleanQuery) throw new Error("memory search query is required");
    const rows = this.candidateRows(options.project, options.latestOnly === true);
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
      const governed = this.governance.view(entryFromRow(row));
      const entry = governed.entry;
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
      return [{ row, lexical, semanticScore, score, governed }];
    }).sort((left, right) =>
      (right.score + (right.governed.pinned ? 0.03 : 0)) - (left.score + (left.governed.pinned ? 0.03 : 0))
      || right.governed.updatedAt - left.governed.updatedAt
      || left.row.id.localeCompare(right.row.id));

    const visible = options.includeHistory
      ? scored
      : scored.filter((item) => item.governed.retrievalEligible);
    const suppressedByGovernance = scored.length - visible.length;

    const results = visible.slice(0, limit).map(({ row, lexical, semanticScore }) => {
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
    const governanceNotice = suppressedByGovernance
      ? `${suppressedByGovernance} matching memory ${suppressedByGovernance === 1 ? "thread was" : "threads were"} excluded because it is superseded, historical, or has an unresolved conflict.`
      : null;
    return {
      query: cleanQuery,
      project: projectKey(options.project).display,
      mode,
      semanticAvailable: queryEmbedding !== null,
      notice: [notice, governanceNotice].filter(Boolean).join(" ") || null,
      suppressedByGovernance,
      results,
    };
  }

  listRecent(options: { project?: string | null; limit?: number } = {}): MemorySearchResponse {
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 12)));
    const results = this.candidateRows(options.project).map((row) => this.result(row, {
      mode: "recent",
      reason: "Recently captured. The source is verified separately before use.",
      semanticScore: null,
      lexicalScore: 0,
      sharedTerms: [],
    })).sort((left, right) =>
      Number(right.governance.pinned) - Number(left.governance.pinned)
      || Number(right.governance.retrievalEligible) - Number(left.governance.retrievalEligible)
      || right.governance.updatedAt - left.governance.updatedAt)
      .slice(0, limit);
    return {
      query: "",
      project: projectKey(options.project).display,
      mode: "recent",
      semanticAvailable: this.embedder !== null,
      notice: this.embedder ? null : "No embedding provider is configured; searches use exact and keyword matching.",
      suppressedByGovernance: 0,
      results,
    };
  }

  get(entryId: string, options: { project?: string | null } = {}): MemoryIndexResult | null {
    const row = this.entryRow(entryId);
    if (!row) return null;
    if (row.privacy_level === "project" && row.project_key !== projectKey(options.project).key) return null;
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
    options: { project?: string | null; maxCharacters?: number; preferRecent?: boolean } = {},
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
    if (!result.usable) {
      return { result, messages: [], truncated: false, returnedCharacters: 0 };
    }
    const limit = Math.max(1_000, Math.min(40_000, Math.floor(options.maxCharacters ?? 24_000)));
    if (result.source.type === "improvement_record" && result.source.reference) {
      const record = this.db.prepare("SELECT * FROM improvement_records WHERE id = ?")
        .get(result.source.reference) as ImprovementRecordRow | undefined;
      if (!record) return { result, messages: [], truncated: false, returnedCharacters: 0 };
      const capabilities = parseStringArray(record.capabilities);
      const changedFiles = parseStringArray(record.changed_files);
      const verification = parseStringArray(record.verification);
      const content = scrubSecrets([
        `AVA improvement: ${record.title}`,
        record.summary,
        capabilities.length ? `Capabilities: ${capabilities.join(", ")}` : "",
        `Author: ${record.actor}`,
        `Git commit: ${record.commit_sha}`,
        changedFiles.length ? `Committed product files: ${changedFiles.slice(0, 24).join(", ")}${changedFiles.length > 24 ? ` (+${changedFiles.length - 24} more)` : ""}` : "",
        ...verification.map((item) => `Evidence: ${item}`),
      ].filter(Boolean).join("\n")).slice(0, limit);
      return {
        result,
        messages: [{ id: 0, role: "assistant", content }],
        truncated: content.length >= limit,
        returnedCharacters: content.length,
      };
    }
    if (!result.source.sessionId) {
      return { result, messages: [], truncated: false, returnedCharacters: 0 };
    }
    const sourceMessages = this.messagesForRange(
      result.source.sessionId,
      result.source.fromMessageId,
      result.source.throughMessageId,
    );
    const messages: MemorySourceRead["messages"] = [];
    let returnedCharacters = 0;
    let truncated = false;
    const ordered = options.preferRecent ? [...sourceMessages].reverse() : sourceMessages;
    for (const message of ordered) {
      const remaining = limit - returnedCharacters;
      if (remaining <= 0) { truncated = true; break; }
      const scrubbed = scrubSecrets(message.content);
      const content = options.preferRecent
        ? scrubbed.slice(Math.max(0, scrubbed.length - remaining))
        : scrubbed.slice(0, remaining);
      messages.push({ id: message.id, role: message.role, content });
      returnedCharacters += content.length;
      if (content.length < scrubbed.length) { truncated = true; break; }
    }
    if (options.preferRecent) messages.reverse();
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
    this.governance.reconcileAfterForget(current.thread_id ?? current.id, now);
    return { ok: true };
  }

  private governanceFailure(result: Exclude<GovernanceWriteResult, { ok: true }>): MemoryGovernanceMutation {
    return { ...result };
  }

  private governedMutation(result: GovernanceWriteResult, project?: string | null): MemoryGovernanceMutation {
    if (!result.ok) return this.governanceFailure(result);
    const current = this.get(result.currentEntryId, { project });
    if (!current) {
      return { ok: false, reason: "not_found", currentVersion: null, message: "Governed memory is no longer available." };
    }
    return { ok: true, event: result.event, result: current };
  }

  async correct(input: GovernanceWriteBase & { entryId: string; correction: MemoryCorrection }): Promise<MemoryGovernanceMutation> {
    const written = this.governance.correct(input);
    if (!written.ok) return this.governanceFailure(written);
    const current = this.get(written.currentEntryId, { project: input.project });
    if (!current) return { ok: false, reason: "not_found", currentVersion: null, message: "Corrected memory is unavailable." };
    await this.storeEmbedding(current.entry);
    return this.governedMutation(written, input.project);
  }

  setPinned(input: GovernanceWriteBase & { pinned: boolean }): MemoryGovernanceMutation {
    return this.governedMutation(this.governance.setPinned(input), input.project);
  }

  supersede(input: GovernanceWriteBase & { replacementThreadId: string; replacementExpectedVersion: number }): MemoryGovernanceMutation {
    const replacementId = this.governance.currentEntryId(input.replacementThreadId, input.project);
    const replacement = replacementId ? this.get(replacementId, { project: input.project }) : null;
    if (!replacement?.usable || !replacement.governance.retrievalEligible) {
      return {
        ok: false,
        reason: replacement ? "source_unverified" : "not_found",
        currentVersion: replacement?.governance.threadVersion ?? null,
        message: "Replacement memory must be current and source-verified.",
      };
    }
    return this.governedMutation(this.governance.supersede(input), input.project);
  }

  openConflict(input: GovernanceWriteBase & { otherThreadId: string; otherExpectedVersion: number }): MemoryGovernanceMutation {
    return this.governedMutation(this.governance.openConflict(input), input.project);
  }

  resolveConflict(input: GovernanceWriteBase & { losingThreadId: string; losingExpectedVersion: number }): MemoryGovernanceMutation {
    const winnerId = this.governance.currentEntryId(input.threadId, input.project);
    const winner = winnerId ? this.get(winnerId, { project: input.project }) : null;
    if (!winner?.usable) {
      return {
        ok: false,
        reason: winner ? "source_unverified" : "not_found",
        currentVersion: winner?.governance.threadVersion ?? null,
        message: "The winning memory must have a verified authoritative source.",
      };
    }
    return this.governedMutation(this.governance.resolveConflict(input), input.project);
  }
}
