import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { scrubSecrets } from "../security/scrub.js";
import {
  MEMORY_CONFIDENCE,
  MEMORY_KINDS,
  SPEECH_ACTS,
  type MemoryActor,
  type MemoryChange,
  type MemoryConfidence,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryRecord,
  type MemoryStatus,
  type MemoryWriteFailure,
  type MemoryWriteResult,
  type NewMemory,
  type SpeechAct,
} from "./types.js";

const MAX_TEXT = 600;
const MAX_TOPIC = 120;
const DAY_MS = 86_400_000;

type Row = {
  id: string;
  kind: string;
  topic: string;
  text: string;
  speech_act: string;
  status: string;
  carry: number;
  sensitive: number;
  confidence: string;
  origin: string;
  source_session_id: string | null;
  source_message_ids: string;
  said_at: number;
  valid_from: number;
  valid_to: number | null;
  due_at: number | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  text_fingerprint: string;
  topic_fingerprint: string;
  version: number;
  created_at: number;
  updated_at: number;
};

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function words(value: string): string[] {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}

export function textFingerprint(text: string): string {
  return sha(words(text).join(" "));
}

// Words that never distinguish one topic from another.
const TOPIC_FILLER = new Set(["a", "an", "the", "of", "s", "his", "her", "niko", "nikos", "sir", "my", "for", "to", "and", "about", "with", "on", "in"]);

/** Order-insensitive, so "Lasha's Instagram" and "Instagram of Lasha" are one topic. */
export function topicFingerprint(topic: string): string {
  return sha([...new Set(words(topic).filter((word) => !TOPIC_FILLER.has(word)))].sort().join(" "));
}

// Question words and fillers that would otherwise match every record.
const SEARCH_STOPWORDS = new Set([
  "a", "about", "am", "an", "and", "any", "are", "ava", "be", "can", "could", "did", "do", "does", "for",
  "from", "had", "has", "have", "he", "her", "his", "how", "i", "in", "is", "it", "its", "just", "know", "me",
  "my", "niko", "of", "on", "or", "our", "remember", "s", "she", "should", "sir", "tell", "that", "the", "their",
  "them", "they", "this", "to", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will",
  "with", "would", "you", "your",
]);

/** A safe FTS5 query: quoted terms joined by OR, longer words also matched as prefixes. */
export function ftsQuery(text: string): string | null {
  const terms = [...new Set(words(text).filter((word) => !SEARCH_STOPWORDS.has(word)))].slice(0, 16);
  if (!terms.length) return null;
  return terms.map((term) => (term.length >= 4 ? `"${term}"*` : `"${term}"`)).join(" OR ");
}

function uniqueIds(ids: readonly number[] | undefined): number[] {
  return [...new Set((ids ?? []).filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
}

function parseIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? uniqueIds(parsed.filter((id): id is number => typeof id === "number")) : [];
  } catch {
    return [];
  }
}

function mapRow(row: Row): MemoryRecord {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    topic: row.topic,
    text: row.text,
    speechAct: row.speech_act as SpeechAct,
    status: row.status as MemoryStatus,
    carry: row.carry === 1,
    sensitive: row.sensitive === 1,
    confidence: row.confidence as MemoryConfidence,
    origin: row.origin as MemoryOrigin,
    sourceSessionId: row.source_session_id,
    sourceMessageIds: parseIds(row.source_message_ids),
    saidAt: row.said_at,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    dueAt: row.due_at,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fail(reason: MemoryWriteFailure["reason"], message: string): MemoryWriteFailure {
  return { ok: false, reason, message };
}

function clean(value: string, max: number): string {
  return scrubSecrets(value.replace(/\s+/g, " ").trim()).slice(0, max);
}

function summaryOf(record: MemoryRecord): string {
  return record.text.length > 200 ? `${record.text.slice(0, 197)}...` : record.text;
}

export type MemorySearchHit = { record: MemoryRecord; score: number };

/**
 * The memory archive. Every write is one transaction, and every result is read
 * back from the database: a caller may only tell Niko "done" from a result
 * this class returned, never from what it asked for.
 */
export class MemoryArchive {
  private readonly listeners = new Set<(change: MemoryChange) => void>();

  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  subscribe(listener: (change: MemoryChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(change: MemoryChange): void {
    for (const listener of this.listeners) {
      try { listener(change); } catch { /* a listener never breaks a memory write */ }
    }
  }

  /** Runs one write transaction, then tells listeners what changed (after commit, never before). */
  private write<T>(fn: () => { result: T; changes: MemoryChange[] }): T {
    const { result, changes } = this.db.transaction(fn)();
    for (const change of changes) this.emit(change);
    return result;
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM memory_records WHERE id = ?").get(id) as Row | undefined;
  }

  get(id: string): MemoryRecord | null {
    const row = this.row(id);
    return row ? mapRow(row) : null;
  }

  /** Current records, oldest first so a rendered Brief stays byte-stable. */
  current(opts: { kinds?: readonly MemoryKind[]; carriedOnly?: boolean } = {}): MemoryRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM memory_records WHERE status = 'active' ORDER BY said_at, seq",
    ).all() as Row[];
    return rows.map(mapRow).filter((record) =>
      (!opts.kinds || opts.kinds.includes(record.kind)) && (!opts.carriedOnly || record.carry));
  }

  unconfirmed(): MemoryRecord[] {
    return (this.db.prepare("SELECT * FROM memory_records WHERE status = 'unconfirmed' ORDER BY said_at, seq")
      .all() as Row[]).map(mapRow);
  }

  /** Records that stopped being current at or after `since`. */
  endedSince(since: number): MemoryRecord[] {
    return (this.db.prepare(
      "SELECT * FROM memory_records WHERE status = 'history' AND valid_to >= ? ORDER BY valid_to, seq",
    ).all(since) as Row[]).map(mapRow);
  }

  /** The record's whole version chain, oldest first. */
  chain(id: string): MemoryRecord[] {
    return this.chainRows(id).map(mapRow).sort((a, b) => a.validFrom - b.validFrom || a.createdAt - b.createdAt);
  }

  private chainRows(id: string): Row[] {
    const seen = new Map<string, Row>();
    const queue = [id];
    while (queue.length) {
      const next = queue.pop()!;
      if (seen.has(next)) continue;
      const row = this.row(next);
      if (!row) continue;
      seen.set(next, row);
      if (row.supersedes_id) queue.push(row.supersedes_id);
      if (row.superseded_by_id) queue.push(row.superseded_by_id);
      const children = this.db.prepare("SELECT id FROM memory_records WHERE supersedes_id = ? OR superseded_by_id = ?")
        .all(next, next) as Array<{ id: string }>;
      for (const child of children) queue.push(child.id);
    }
    return [...seen.values()];
  }

  /** Whether any version of a record on this topic is stored (forget reads this back). */
  topicExists(kind: MemoryKind, topic: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM memory_records WHERE kind = ? AND topic_fingerprint = ? LIMIT 1")
      .get(kind, topicFingerprint(topic));
  }

  counts(): { active: number; history: number; unconfirmed: number; forgotten: number } {
    const rows = this.db.prepare("SELECT status, count(*) AS n FROM memory_records GROUP BY status")
      .all() as Array<{ status: string; n: number }>;
    const by = Object.fromEntries(rows.map((row) => [row.status, row.n]));
    const forgotten = (this.db.prepare("SELECT count(*) AS n FROM memory_tombstones").get() as { n: number }).n;
    return { active: by.active ?? 0, history: by.history ?? 0, unconfirmed: by.unconfirmed ?? 0, forgotten };
  }

  /** True when a candidate would bring back something Niko had forgotten. */
  isForgotten(candidate: { kind: MemoryKind; topic: string; text: string; sourceMessageIds?: readonly number[] }): boolean {
    return this.blockedByTombstone(
      candidate.kind,
      textFingerprint(candidate.text),
      topicFingerprint(candidate.topic),
      uniqueIds(candidate.sourceMessageIds),
    );
  }

  private blockedByTombstone(kind: MemoryKind, textFp: string, topicFp: string, messageIds: number[]): boolean {
    if (this.db.prepare("SELECT 1 FROM memory_tombstones WHERE text_fingerprint = ? LIMIT 1").get(textFp)) return true;
    if (this.db.prepare("SELECT 1 FROM memory_tombstones WHERE topic_fingerprint = ? AND kind = ? LIMIT 1")
      .get(topicFp, kind)) return true;
    if (!messageIds.length) return false;
    const marks = messageIds.map(() => "?").join(",");
    // A seeded index-entry tombstone has no kind: everything from those messages stays forgotten.
    return !!this.db.prepare(`
      SELECT 1 FROM memory_tombstone_messages tm JOIN memory_tombstones t ON t.id = tm.tombstone_id
      WHERE tm.message_id IN (${marks}) AND (t.kind = ? OR t.reason = 'forgotten_index_entry') LIMIT 1
    `).get(...messageIds, kind);
  }

  /** Message ids recall must not quote, because what they said was forgotten. */
  forgottenMessageIds(ids: readonly number[]): Set<number> {
    const clean = uniqueIds(ids);
    if (!clean.length) return new Set();
    const marks = clean.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT DISTINCT message_id FROM memory_tombstone_messages WHERE message_id IN (${marks})`)
      .all(...clean) as Array<{ message_id: number }>;
    return new Set(rows.map((row) => row.message_id));
  }

  /**
   * Honors a forget made in the older memory index, before any backfill reads
   * those messages again. Stores message ids only, never content.
   */
  tombstoneMessages(messageIds: readonly number[], reason: "forgotten_index_entry"): number {
    const ids = uniqueIds(messageIds);
    if (!ids.length) return 0;
    const already = this.forgottenMessageIds(ids);
    const fresh = ids.filter((id) => !already.has(id));
    if (!fresh.length) return 0;
    const tombstoneId = `tomb_${nanoid(14)}`;
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO memory_tombstones (id, kind, text_fingerprint, topic_fingerprint, reason, created_at)
        VALUES (?, '*', ?, ?, ?, ?)`).run(tombstoneId, sha(`messages:${tombstoneId}`), sha(`messages:${tombstoneId}`), reason, this.now());
      const insert = this.db.prepare("INSERT OR IGNORE INTO memory_tombstone_messages (message_id, tombstone_id) VALUES (?, ?)");
      for (const id of fresh) insert.run(id, tombstoneId);
    })();
    return fresh.length;
  }

  private validate(input: NewMemory): MemoryWriteFailure | null {
    if (!MEMORY_KINDS.includes(input.kind)) return fail("invalid", `Unknown memory kind: ${String(input.kind)}`);
    if (!SPEECH_ACTS.includes(input.speechAct)) return fail("invalid", `Unknown speech act: ${String(input.speechAct)}`);
    if (!MEMORY_CONFIDENCE.includes(input.confidence)) return fail("invalid", `Unknown confidence: ${String(input.confidence)}`);
    if (!clean(input.text, MAX_TEXT)) return fail("invalid", "A memory needs text.");
    if (!clean(input.topic, MAX_TOPIC)) return fail("invalid", "A memory needs a topic.");
    if (!Number.isFinite(input.saidAt) || input.saidAt <= 0) return fail("invalid", "A memory needs the time it was said.");
    return null;
  }

  private logEvent(change: MemoryChange): void {
    this.db.prepare(`INSERT INTO memory_record_events (record_id, action, actor, summary, session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      change.recordId, change.action, change.actor,
      change.record ? summaryOf(change.record) : null, change.sessionId, this.now(),
    );
  }

  private retire(row: Row, at: number, replacementId: string | null): void {
    this.db.prepare(`UPDATE memory_records SET status = 'history', valid_to = ?, superseded_by_id = ?,
      version = version + 1, updated_at = ? WHERE id = ?`).run(Math.max(at, row.valid_from), replacementId, this.now(), row.id);
  }

  private activeRivals(kind: MemoryKind, topicFp: string, exceptId?: string): Row[] {
    return (this.db.prepare(`SELECT * FROM memory_records WHERE kind = ? AND topic_fingerprint = ? AND status = 'active'
      ORDER BY said_at DESC, seq DESC`).all(kind, topicFp) as Row[]).filter((row) => row.id !== exceptId);
  }

  /**
   * Adds a record. Newer beats older on the same topic: current records it
   * replaces become history. Older news that arrives late (a backfill reading
   * sessions out of order) is stored straight into history.
   */
  add(input: NewMemory, actor: MemoryActor, sessionId: string | null = null): MemoryWriteResult {
    const invalid = this.validate(input);
    if (invalid) return invalid;
    const text = clean(input.text, MAX_TEXT);
    const topic = clean(input.topic, MAX_TOPIC);
    const textFp = textFingerprint(text);
    const topicFp = topicFingerprint(topic);
    const sourceIds = uniqueIds(input.sourceMessageIds);
    return this.write((): { result: MemoryWriteResult; changes: MemoryChange[] } => {
      // Niko asking again, in his own words, overrides an earlier forget.
      if (input.origin !== "explicit" && this.blockedByTombstone(input.kind, textFp, topicFp, sourceIds)) {
        return { result: fail("forgotten", "Niko asked AVA to forget this; it will not be stored again."), changes: [] };
      }
      const same = this.db.prepare(`SELECT * FROM memory_records WHERE text_fingerprint = ? AND kind = ?
        AND status IN ('active', 'unconfirmed') ORDER BY seq DESC LIMIT 1`).get(textFp, input.kind) as Row | undefined;
      if (same) {
        if (same.status === "unconfirmed" && input.origin === "explicit") {
          const confirmed = this.confirmRow(same, actor, sessionId);
          return { result: confirmed.result, changes: [confirmed.change] };
        }
        const unchanged: MemoryWriteResult = { ok: true, record: mapRow(same), outcome: "unchanged", replaced: [] };
        return { result: unchanged, changes: [] };
      }
      const id = `mem_${nanoid(14)}`;
      const now = this.now();
      let status: MemoryStatus = input.status ?? "active";
      let validTo: number | null = null;
      let supersededById: string | null = null;
      let supersedesId: string | null = null;
      const replaced: MemoryRecord[] = [];
      if (status === "active") {
        const rivals = this.activeRivals(input.kind, topicFp);
        // What Niko asked AVA to remember is never replaced by the background
        // writer's paraphrase of that same moment, only by something newer.
        const explicit = input.origin === "explicit"
          ? undefined
          : rivals.find((row) => row.origin === "explicit" && row.said_at >= input.saidAt);
        if (explicit) {
          return { result: { ok: true, record: mapRow(explicit), outcome: "unchanged", replaced: [] }, changes: [] };
        }
        const newer = rivals.filter((row) => row.said_at > input.saidAt);
        if (newer.length) {
          const next = newer[newer.length - 1]!;
          status = "history";
          validTo = next.valid_from;
          supersededById = next.id;
        } else {
          for (const rival of rivals) {
            this.retire(rival, input.saidAt, id);
            replaced.push(mapRow(this.row(rival.id)!));
          }
          supersedesId = rivals[0]?.id ?? null;
        }
      }
      this.db.prepare(`INSERT INTO memory_records (
          id, kind, topic, text, speech_act, status, carry, sensitive, confidence, origin,
          source_session_id, source_message_ids, said_at, valid_from, valid_to, due_at,
          supersedes_id, superseded_by_id, text_fingerprint, topic_fingerprint, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        id, input.kind, topic, text, input.speechAct, status, input.sensitive ? 1 : 0, input.confidence, input.origin,
        input.sourceSessionId ?? null, JSON.stringify(sourceIds), input.saidAt, input.saidAt, validTo,
        input.dueAt ?? null, supersedesId, supersededById, textFp, topicFp, now, now,
      );
      const record = mapRow(this.row(id)!);
      const change: MemoryChange = { action: replaced.length ? "updated" : "added", actor, record, recordId: id, sessionId };
      this.logEvent(change);
      const added: MemoryWriteResult = { ok: true, record, outcome: replaced.length ? "replaced" : "added", replaced };
      return { result: added, changes: [change] };
    });
  }

  private confirmRow(row: Row, actor: MemoryActor, sessionId: string | null): { result: MemoryWriteResult; change: MemoryChange } {
    const replaced: MemoryRecord[] = [];
    for (const rival of this.activeRivals(row.kind as MemoryKind, row.topic_fingerprint, row.id)) {
      if (rival.said_at > row.said_at) continue;
      this.retire(rival, row.said_at, row.id);
      replaced.push(mapRow(this.row(rival.id)!));
    }
    this.db.prepare(`UPDATE memory_records SET status = 'active', confidence = 'high', version = version + 1,
      updated_at = ?, supersedes_id = COALESCE(supersedes_id, ?) WHERE id = ?`).run(this.now(), replaced[0]?.id ?? null, row.id);
    const record = mapRow(this.row(row.id)!);
    const change: MemoryChange = { action: "confirmed", actor, record, recordId: row.id, sessionId };
    this.logEvent(change);
    return { result: { ok: true, record, outcome: "confirmed", replaced }, change };
  }

  private target(id: string, expectedVersion: number | undefined, allowed: readonly MemoryStatus[]): Row | MemoryWriteFailure {
    const row = this.row(id);
    if (!row) return fail("not_found", `No memory with id ${id}.`);
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      return fail("stale", `Memory ${id} changed; its current version is ${row.version}.`);
    }
    if (!allowed.includes(row.status as MemoryStatus)) {
      const current = row.superseded_by_id ? ` The current version is ${row.superseded_by_id}.` : "";
      return fail("wrong_state", `Memory ${id} is ${row.status}.${current}`);
    }
    return row;
  }

  /** Replaces a current record with a corrected one; the old version becomes history. */
  correct(
    id: string,
    input: {
      text: string;
      saidAt: number;
      origin: MemoryOrigin;
      topic?: string;
      speechAct?: SpeechAct;
      confidence?: MemoryConfidence;
      sourceSessionId?: string | null;
      sourceMessageIds?: number[];
      dueAt?: number | null;
      expectedVersion?: number;
    },
    actor: MemoryActor,
    sessionId: string | null = null,
  ): MemoryWriteResult {
    return this.write((): { result: MemoryWriteResult; changes: MemoryChange[] } => {
      const target = this.target(id, input.expectedVersion, ["active", "unconfirmed"]);
      if ("ok" in target) return { result: target, changes: [] };
      const next: NewMemory = {
        kind: target.kind as MemoryKind,
        topic: input.topic ?? target.topic,
        text: input.text,
        speechAct: input.speechAct ?? "stated",
        confidence: input.confidence ?? "high",
        origin: input.origin,
        saidAt: Math.max(input.saidAt, target.said_at),
        sensitive: target.sensitive === 1,
        sourceSessionId: input.sourceSessionId ?? null,
        sourceMessageIds: input.sourceMessageIds ?? [],
        dueAt: input.dueAt === undefined ? target.due_at : input.dueAt,
      };
      const invalid = this.validate(next);
      if (invalid) return { result: invalid, changes: [] };
      const text = clean(next.text, MAX_TEXT);
      const topic = clean(next.topic, MAX_TOPIC);
      const textFp = textFingerprint(text);
      if (textFp === target.text_fingerprint && topicFingerprint(topic) === target.topic_fingerprint) {
        return { result: { ok: true, record: mapRow(target), outcome: "unchanged", replaced: [] }, changes: [] };
      }
      if (next.origin !== "explicit" && this.blockedByTombstone(next.kind, textFp, topicFingerprint(topic), uniqueIds(next.sourceMessageIds))) {
        return { result: fail("forgotten", "Niko asked AVA to forget this; it will not be stored again."), changes: [] };
      }
      const newId = `mem_${nanoid(14)}`;
      const now = this.now();
      this.retire(target, next.saidAt, newId);
      this.db.prepare(`INSERT INTO memory_records (
          id, kind, topic, text, speech_act, status, carry, sensitive, confidence, origin,
          source_session_id, source_message_ids, said_at, valid_from, valid_to, due_at,
          supersedes_id, superseded_by_id, text_fingerprint, topic_fingerprint, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, 1, ?, ?)`).run(
        newId, next.kind, topic, text, next.speechAct, target.carry, next.sensitive ? 1 : 0, next.confidence, next.origin,
        next.sourceSessionId ?? null, JSON.stringify(uniqueIds(next.sourceMessageIds)), next.saidAt, next.saidAt,
        next.dueAt ?? null, target.id, textFp, topicFingerprint(topic), now, now,
      );
      const record = mapRow(this.row(newId)!);
      const change: MemoryChange = { action: "updated", actor, record, recordId: newId, sessionId };
      this.logEvent(change);
      return {
        result: { ok: true, record, outcome: "replaced", replaced: [mapRow(this.row(target.id)!)] },
        changes: [change],
      };
    });
  }

  /** No longer true or relevant: the record becomes dated history. */
  end(id: string, at: number, actor: MemoryActor, opts: { expectedVersion?: number; sessionId?: string | null } = {}): MemoryWriteResult {
    return this.write((): { result: MemoryWriteResult; changes: MemoryChange[] } => {
      const target = this.target(id, opts.expectedVersion, ["active", "unconfirmed"]);
      if ("ok" in target) return { result: target, changes: [] };
      this.retire(target, at, null);
      const record = mapRow(this.row(id)!);
      const change: MemoryChange = { action: "ended", actor, record, recordId: id, sessionId: opts.sessionId ?? null };
      this.logEvent(change);
      return { result: { ok: true, record, outcome: "replaced", replaced: [record] }, changes: [change] };
    });
  }

  /** Keep it, but leave it out of the Brief ("stop bringing that up"), or bring it back. */
  setCarry(id: string, carry: boolean, actor: MemoryActor, opts: { expectedVersion?: number; sessionId?: string | null } = {}): MemoryWriteResult {
    return this.write((): { result: MemoryWriteResult; changes: MemoryChange[] } => {
      const target = this.target(id, opts.expectedVersion, ["active", "unconfirmed", "history"]);
      if ("ok" in target) return { result: target, changes: [] };
      if ((target.carry === 1) === carry) {
        return { result: { ok: true, record: mapRow(target), outcome: "unchanged", replaced: [] }, changes: [] };
      }
      this.db.prepare("UPDATE memory_records SET carry = ?, version = version + 1, updated_at = ? WHERE id = ?")
        .run(carry ? 1 : 0, this.now(), id);
      const record = mapRow(this.row(id)!);
      const change: MemoryChange = { action: carry ? "carried" : "stopped_carrying", actor, record, recordId: id, sessionId: opts.sessionId ?? null };
      this.logEvent(change);
      return { result: { ok: true, record, outcome: "unchanged", replaced: [] }, changes: [change] };
    });
  }

  /** Niko confirmed a record that was waiting for him. */
  confirm(id: string, actor: MemoryActor, sessionId: string | null = null): MemoryWriteResult {
    return this.write((): { result: MemoryWriteResult; changes: MemoryChange[] } => {
      const target = this.target(id, undefined, ["unconfirmed"]);
      if ("ok" in target) return { result: target, changes: [] };
      const confirmed = this.confirmRow(target, actor, sessionId);
      return { result: confirmed.result, changes: [confirmed.change] };
    });
  }

  /**
   * Erases the record with every version of it and every record on the same
   * topic, leaving only tombstones (fingerprints and message ids). Rejecting a
   * record that was waiting for confirmation is the same operation.
   */
  forget(
    id: string,
    actor: MemoryActor,
    opts: { reason?: "forgotten" | "rejected"; sessionId?: string | null } = {},
  ): { ok: true; forgotten: number } | MemoryWriteFailure {
    return this.write((): { result: { ok: true; forgotten: number } | MemoryWriteFailure; changes: MemoryChange[] } => {
      const changes: MemoryChange[] = [];
      const target = this.row(id);
      if (!target) return { result: fail("not_found", `No memory with id ${id}.`), changes };
      const rows = new Map<string, Row>();
      for (const row of this.chainRows(id)) rows.set(row.id, row);
      const sameTopic = this.db.prepare("SELECT * FROM memory_records WHERE kind = ? AND topic_fingerprint = ?")
        .all(target.kind, target.topic_fingerprint) as Row[];
      for (const row of sameTopic) {
        for (const linked of this.chainRows(row.id)) rows.set(linked.id, linked);
      }
      const now = this.now();
      const insertTombstone = this.db.prepare(`INSERT INTO memory_tombstones
        (id, kind, text_fingerprint, topic_fingerprint, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
      const insertMessage = this.db.prepare(
        "INSERT OR IGNORE INTO memory_tombstone_messages (message_id, tombstone_id) VALUES (?, ?)",
      );
      for (const row of rows.values()) {
        const tombstoneId = `tomb_${nanoid(14)}`;
        insertTombstone.run(tombstoneId, row.kind, row.text_fingerprint, row.topic_fingerprint, opts.reason ?? "forgotten", now);
        for (const messageId of parseIds(row.source_message_ids)) insertMessage.run(messageId, tombstoneId);
        this.db.prepare("DELETE FROM memory_records WHERE id = ?").run(row.id);
        // The feed keeps that something was forgotten, never what.
        this.db.prepare("UPDATE memory_record_events SET summary = NULL WHERE record_id = ?").run(row.id);
        const change: MemoryChange = { action: "forgotten", actor, record: null, recordId: row.id, sessionId: opts.sessionId ?? null };
        this.logEvent(change);
        changes.push(change);
      }
      return { result: { ok: true, forgotten: rows.size }, changes };
    });
  }

  /**
   * Keyword search over current and past records (SQLite FTS5 with BM25).
   * Current records rank above history, and recent above old.
   */
  search(query: string, opts: {
    limit?: number;
    includeHistory?: boolean;
    includeUnconfirmed?: boolean;
    kinds?: readonly MemoryKind[];
    from?: number;
    to?: number;
  } = {}): MemorySearchHit[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const statuses = ["active", ...(opts.includeHistory ? ["history"] : []), ...(opts.includeUnconfirmed ? ["unconfirmed"] : [])];
    const rows = this.db.prepare(`
      SELECT m.*, bm25(memory_records_fts, 2.0, 1.0) AS rank
      FROM memory_records_fts JOIN memory_records m ON m.seq = memory_records_fts.rowid
      WHERE memory_records_fts MATCH ? AND m.status IN (${statuses.map(() => "?").join(",")})
      ORDER BY rank LIMIT 60
    `).all(match, ...statuses) as Array<Row & { rank: number }>;
    const now = this.now();
    return rows
      .map((row) => ({ row, record: mapRow(row) }))
      .filter(({ record }) => (!opts.kinds || opts.kinds.includes(record.kind))
        && (opts.from === undefined || (record.validTo ?? Number.MAX_SAFE_INTEGER) >= opts.from)
        && (opts.to === undefined || record.validFrom <= opts.to))
      .map(({ row, record }) => {
        const relevance = Math.max(-row.rank, 0.000_001);
        const recency = Math.exp(-Math.max(now - record.saidAt, 0) / (45 * DAY_MS));
        const standing = record.status === "active" ? 1 : record.status === "history" ? 0.7 : 0.5;
        return { record, score: relevance * standing * (1 + 0.25 * recency) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(opts.limit ?? 8, 50)));
  }

  /** The newest changes first: the "just learned" feed. */
  events(opts: { limit?: number; afterSeq?: number } = {}): Array<{
    seq: number; recordId: string; action: MemoryChange["action"]; actor: MemoryActor; summary: string | null;
    sessionId: string | null; createdAt: number;
  }> {
    const rows = this.db.prepare(`SELECT * FROM memory_record_events WHERE seq > ? ORDER BY seq DESC LIMIT ?`)
      .all(opts.afterSeq ?? 0, Math.max(1, Math.min(opts.limit ?? 50, 500))) as Array<{
        seq: number; record_id: string; action: string; actor: string; summary: string | null; session_id: string | null; created_at: number;
      }>;
    return rows.map((row) => ({
      seq: row.seq, recordId: row.record_id, action: row.action as MemoryChange["action"], actor: row.actor as MemoryActor,
      summary: row.summary, sessionId: row.session_id, createdAt: row.created_at,
    }));
  }
}
