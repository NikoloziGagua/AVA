import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";
import { scrubSecrets } from "../security/scrub.js";
import type {
  MemoryCorrection,
  MemoryGovernanceActor,
  MemoryGovernanceEvent,
  MemoryGovernanceEventKind,
  MemoryGovernanceRetrievalState,
  MemoryIndexEntry,
} from "./types.js";

type StateRow = {
  thread_id: string;
  version: number;
  pinned: number;
  current_entry_id: string | null;
  superseded_by_thread_id: string | null;
  conflict_status: string;
  conflict_with: string;
  updated_at: number;
};

type EventRow = {
  id: string;
  thread_id: string;
  entry_id: string | null;
  kind: string;
  actor: string;
  reason: string;
  target_thread_id: string | null;
  payload: string;
  request_key: string;
  resulting_version: number;
  created_at: number;
};

type ScopeRow = {
  id: string;
  privacy_level: string;
  project_key: string | null;
  status: string;
};

export type GovernanceView = {
  entry: MemoryIndexEntry;
  originalEntry: MemoryIndexEntry;
  threadVersion: number;
  pinned: boolean;
  state: MemoryGovernanceRetrievalState;
  retrievalEligible: boolean;
  corrected: boolean;
  correctionEventId: string | null;
  correctionReason: string | null;
  supersededByThreadId: string | null;
  conflictWithThreadIds: string[];
  updatedAt: number;
  events: MemoryGovernanceEvent[];
};

export type GovernanceWriteResult = {
  ok: true;
  event: MemoryGovernanceEvent;
  currentEntryId: string;
} | {
  ok: false;
  reason: "not_found" | "privacy_scope" | "version_conflict" | "invalid_state";
  currentVersion: number | null;
  message: string;
};

export type GovernanceWriteBase = {
  threadId: string;
  expectedVersion: number;
  actor: MemoryGovernanceActor;
  reason: string;
  requestKey: string;
  project?: string | null;
};

const MAX_EVENTS = 24;

function cleanInline(value: string | null | undefined, max: number): string {
  return scrubSecrets(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanText(value: string | null | undefined, max: number): string {
  return scrubSecrets(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function cleanList(values: readonly string[] | undefined, maxItems: number, maxLength: number): string[] | undefined {
  if (values === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanInline(raw, maxLength);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function projectKey(value: string | null | undefined): string | null {
  const clean = cleanInline(value, 80);
  return clean ? clean.toLocaleLowerCase() : null;
}

function eventFromRow(row: EventRow): MemoryGovernanceEvent {
  return {
    id: row.id,
    threadId: row.thread_id,
    entryId: row.entry_id,
    kind: row.kind as MemoryGovernanceEventKind,
    actor: row.actor as MemoryGovernanceActor,
    reason: scrubSecrets(row.reason),
    targetThreadId: row.target_thread_id,
    resultingVersion: row.resulting_version,
    createdAt: row.created_at,
  };
}

function correctionFromRow(row: EventRow | null): MemoryCorrection | null {
  if (!row) return null;
  try {
    const value = JSON.parse(row.payload) as Record<string, unknown>;
    return {
      ...(typeof value.title === "string" ? { title: scrubSecrets(value.title) } : {}),
      ...(typeof value.summary === "string" ? { summary: scrubSecrets(value.summary) } : {}),
      ...(Array.isArray(value.conclusions) ? { conclusions: value.conclusions.filter((item): item is string => typeof item === "string").map(scrubSecrets) } : {}),
      ...(Array.isArray(value.openQuestions) ? { openQuestions: value.openQuestions.filter((item): item is string => typeof item === "string").map(scrubSecrets) } : {}),
      ...(Array.isArray(value.nextSteps) ? { nextSteps: value.nextSteps.filter((item): item is string => typeof item === "string").map(scrubSecrets) } : {}),
      ...(Array.isArray(value.tags) ? { tags: value.tags.filter((item): item is string => typeof item === "string").map(scrubSecrets) } : {}),
    };
  } catch {
    return null;
  }
}

function cleanCorrection(value: MemoryCorrection): MemoryCorrection {
  return {
    ...(value.title !== undefined ? { title: cleanInline(value.title, 160) } : {}),
    ...(value.summary !== undefined ? { summary: cleanText(value.summary, 6_000) } : {}),
    ...(value.conclusions !== undefined ? { conclusions: cleanList(value.conclusions, 12, 600) ?? [] } : {}),
    ...(value.openQuestions !== undefined ? { openQuestions: cleanList(value.openQuestions, 12, 600) ?? [] } : {}),
    ...(value.nextSteps !== undefined ? { nextSteps: cleanList(value.nextSteps, 12, 600) ?? [] } : {}),
    ...(value.tags !== undefined ? { tags: cleanList(value.tags, 16, 48) ?? [] } : {}),
  };
}

function hasCorrection(value: MemoryCorrection): boolean {
  return Object.keys(value).some((key) => {
    const item = value[key as keyof MemoryCorrection];
    return Array.isArray(item) ? true : typeof item === "string" && item.length > 0;
  });
}

export class MemoryGovernanceStore {
  constructor(private readonly db: Db) {}

  private state(threadId: string): StateRow | null {
    return (this.db.prepare("SELECT * FROM memory_index_thread_state WHERE thread_id = ?")
      .get(threadId) as StateRow | undefined) ?? null;
  }

  currentEntryId(threadId: string, project?: string | null): string | null {
    const state = this.state(threadId);
    return state?.current_entry_id && this.inScope(threadId, project) ? state.current_entry_id : null;
  }

  private currentScope(threadId: string): ScopeRow | null {
    return (this.db.prepare(`
      SELECT e.id, e.privacy_level, e.project_key, e.status
      FROM memory_index_thread_state s
      JOIN memory_index_entries e ON e.id = s.current_entry_id
      WHERE s.thread_id = ?
    `).get(threadId) as ScopeRow | undefined) ?? null;
  }

  private inScope(threadId: string, project: string | null | undefined): boolean {
    const row = this.currentScope(threadId);
    if (!row || row.status !== "active") return false;
    return row.privacy_level !== "project" || row.project_key === projectKey(project);
  }

  private sameScope(leftThreadId: string, rightThreadId: string): boolean {
    const left = this.currentScope(leftThreadId);
    const right = this.currentScope(rightThreadId);
    return Boolean(left && right
      && left.privacy_level === right.privacy_level
      && left.project_key === right.project_key);
  }

  private eventByRequest(requestKey: string): EventRow | null {
    return (this.db.prepare("SELECT * FROM memory_index_governance_events WHERE request_key = ?")
      .get(requestKey) as EventRow | undefined) ?? null;
  }

  private fail(
    reason: Exclude<GovernanceWriteResult, { ok: true }>["reason"],
    state: StateRow | null,
    message: string,
  ): GovernanceWriteResult {
    return { ok: false, reason, currentVersion: state?.version ?? null, message };
  }

  private validatedBase(input: GovernanceWriteBase): { state: StateRow; reason: string; requestKey: string } | GovernanceWriteResult {
    const state = this.state(input.threadId);
    if (!state) return this.fail("not_found", null, "Memory thread not found.");
    if (!this.inScope(input.threadId, input.project)) return this.fail("privacy_scope", state, "Memory thread is outside this privacy scope.");
    const requestKey = cleanInline(input.requestKey, 180);
    const reason = cleanInline(input.reason, 500);
    if (!requestKey || !reason) return this.fail("invalid_state", state, "A stable request key and reason are required.");
    if (!Number.isInteger(input.expectedVersion) || state.version !== input.expectedVersion) {
      return this.fail("version_conflict", state, "Memory governance changed. Refresh and try again.");
    }
    return { state, reason, requestKey };
  }

  private existingResult(requestKey: string, expectedThreadId: string, project?: string | null): GovernanceWriteResult | null {
    const existing = this.eventByRequest(cleanInline(requestKey, 180));
    if (!existing) return null;
    // A replay key is scoped to its original memory thread. Reusing it against
    // another thread must not disclose or mutate that thread.
    if (existing.thread_id !== expectedThreadId || !this.inScope(existing.thread_id, project)) {
      return this.fail("invalid_state", this.state(expectedThreadId), "This request key belongs to another memory operation.");
    }
    const state = this.state(existing.thread_id);
    if (!state?.current_entry_id) return this.fail("not_found", state, "The replayed governance target is no longer available.");
    return { ok: true, event: eventFromRow(existing), currentEntryId: state.current_entry_id };
  }

  private insertEvent(input: {
    threadId: string;
    entryId: string | null;
    kind: MemoryGovernanceEventKind;
    actor: MemoryGovernanceActor;
    reason: string;
    targetThreadId?: string | null;
    payload?: Record<string, unknown>;
    requestKey: string;
    resultingVersion: number;
    now: number;
  }): EventRow {
    const id = `memory_governance_${nanoid(14)}`;
    this.db.prepare(`
      INSERT INTO memory_index_governance_events (
        id, thread_id, entry_id, kind, actor, reason, target_thread_id,
        payload, request_key, resulting_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.threadId, input.entryId, input.kind, input.actor,
      input.reason, input.targetThreadId ?? null,
      JSON.stringify(input.payload ?? {}), input.requestKey,
      input.resultingVersion, input.now,
    );
    return this.db.prepare("SELECT * FROM memory_index_governance_events WHERE id = ?").get(id) as EventRow;
  }

  ensureCurrent(threadId: string, entryId: string, now = Date.now()): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_index_thread_state (
        thread_id, version, pinned, current_entry_id, superseded_by_thread_id,
        conflict_status, conflict_with, updated_at
      ) VALUES (?, 1, 0, ?, NULL, 'none', '[]', ?)
    `).run(threadId, entryId, now);
    this.db.prepare(`
      UPDATE memory_index_thread_state
      SET current_entry_id = ?, version = version + 1, updated_at = ?
      WHERE thread_id = ? AND current_entry_id IS NOT ?
    `).run(entryId, now, threadId, entryId);
  }

  reconcileAfterForget(threadId: string, now = Date.now()): void {
    const latest = this.db.prepare(`
      SELECT id FROM memory_index_entries
      WHERE status = 'active' AND COALESCE(thread_id, id) = ?
      ORDER BY checkpoint_sequence DESC, created_at DESC, id ASC LIMIT 1
    `).get(threadId) as { id: string } | undefined;
    this.db.prepare(`
      UPDATE memory_index_thread_state
      SET current_entry_id = ?, version = version + 1, updated_at = ?
      WHERE thread_id = ? AND current_entry_id IS NOT ?
    `).run(latest?.id ?? null, now, threadId, latest?.id ?? null);
  }

  view(originalEntry: MemoryIndexEntry): GovernanceView {
    const threadId = originalEntry.threadId || originalEntry.id;
    const state = this.state(threadId) ?? {
      thread_id: threadId,
      version: 1,
      pinned: 0,
      current_entry_id: originalEntry.id,
      superseded_by_thread_id: null,
      conflict_status: "none",
      conflict_with: "[]",
      updated_at: originalEntry.updatedAt,
    };
    const corrections = this.db.prepare(`
      SELECT * FROM memory_index_governance_events
      WHERE thread_id = ? AND entry_id = ? AND kind = 'corrected'
      ORDER BY resulting_version ASC, created_at ASC, id ASC
    `).all(threadId, originalEntry.id) as EventRow[];
    // Corrections are immutable partial overlays. Compose them in version order
    // so a later correction to (for example) tags does not erase an earlier
    // corrected summary. The checkpoint itself remains untouched.
    const overlay = corrections.reduce<MemoryCorrection | null>((current, row) => {
      const next = correctionFromRow(row);
      return next ? { ...(current ?? {}), ...next } : current;
    }, null);
    const correction = corrections[corrections.length - 1];
    const entry: MemoryIndexEntry = overlay ? {
      ...originalEntry,
      ...(overlay.title !== undefined ? { title: overlay.title } : {}),
      ...(overlay.summary !== undefined ? { summary: overlay.summary } : {}),
      ...(overlay.conclusions !== undefined ? { conclusions: overlay.conclusions } : {}),
      ...(overlay.openQuestions !== undefined ? { openQuestions: overlay.openQuestions } : {}),
      ...(overlay.nextSteps !== undefined ? { nextSteps: overlay.nextSteps } : {}),
      ...(overlay.tags !== undefined ? { tags: overlay.tags } : {}),
    } : originalEntry;
    const conflicts = parseArray(state.conflict_with);
    const isCurrent = state.current_entry_id === originalEntry.id;
    const retrievalState: MemoryGovernanceRetrievalState = state.superseded_by_thread_id
      ? "superseded"
      : state.conflict_status === "unresolved"
        ? "conflicted"
        : isCurrent ? "current" : "history";
    const events = this.db.prepare(`
      SELECT * FROM memory_index_governance_events
      WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(threadId, MAX_EVENTS) as EventRow[];
    return {
      entry,
      originalEntry,
      threadVersion: state.version,
      pinned: state.pinned === 1,
      state: retrievalState,
      retrievalEligible: retrievalState === "current",
      corrected: corrections.length > 0,
      correctionEventId: correction?.id ?? null,
      correctionReason: correction ? scrubSecrets(correction.reason) : null,
      supersededByThreadId: state.superseded_by_thread_id,
      conflictWithThreadIds: conflicts,
      updatedAt: state.updated_at,
      events: events.map(eventFromRow),
    };
  }

  correct(input: GovernanceWriteBase & { entryId: string; correction: MemoryCorrection }): GovernanceWriteResult {
    const replay = this.existingResult(input.requestKey, input.threadId, input.project);
    if (replay) return replay;
    const checked = this.validatedBase(input);
    if (!("state" in checked)) return checked;
    if (checked.state.current_entry_id !== input.entryId) {
      return this.fail("version_conflict", checked.state, "The selected checkpoint is no longer current.");
    }
    if (checked.state.superseded_by_thread_id || checked.state.conflict_status === "unresolved") {
      return this.fail("invalid_state", checked.state, "Resolve supersession or conflict before correcting this thread.");
    }
    const correction = cleanCorrection(input.correction);
    if (!hasCorrection(correction)) return this.fail("invalid_state", checked.state, "At least one non-empty correction field is required.");
    const now = Date.now();
    const resultingVersion = checked.state.version + 1;
    const row = this.db.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE memory_index_thread_state SET version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ? AND current_entry_id = ?
      `).run(resultingVersion, now, input.threadId, input.expectedVersion, input.entryId);
      if (changed.changes !== 1) throw new Error("stale_governance_write");
      return this.insertEvent({
        threadId: input.threadId,
        entryId: input.entryId,
        kind: "corrected",
        actor: input.actor,
        reason: checked.reason,
        payload: correction as Record<string, unknown>,
        requestKey: checked.requestKey,
        resultingVersion,
        now,
      });
    })();
    return { ok: true, event: eventFromRow(row), currentEntryId: input.entryId };
  }

  setPinned(input: GovernanceWriteBase & { pinned: boolean }): GovernanceWriteResult {
    const replay = this.existingResult(input.requestKey, input.threadId, input.project);
    if (replay) return replay;
    const checked = this.validatedBase(input);
    if (!("state" in checked)) return checked;
    if (!checked.state.current_entry_id) return this.fail("not_found", checked.state, "Memory thread has no current checkpoint.");
    if (checked.state.superseded_by_thread_id || checked.state.conflict_status === "unresolved") {
      return this.fail("invalid_state", checked.state, "Only a current, non-conflicted thread can be pinned.");
    }
    const now = Date.now();
    const resultingVersion = checked.state.version + 1;
    const row = this.db.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE memory_index_thread_state SET pinned = ?, version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ?
      `).run(input.pinned ? 1 : 0, resultingVersion, now, input.threadId, input.expectedVersion);
      if (changed.changes !== 1) throw new Error("stale_governance_write");
      return this.insertEvent({
        threadId: input.threadId,
        entryId: checked.state.current_entry_id,
        kind: input.pinned ? "pinned" : "unpinned",
        actor: input.actor,
        reason: checked.reason,
        requestKey: checked.requestKey,
        resultingVersion,
        now,
      });
    })();
    return { ok: true, event: eventFromRow(row), currentEntryId: checked.state.current_entry_id };
  }

  supersede(input: GovernanceWriteBase & {
    replacementThreadId: string;
    replacementExpectedVersion: number;
  }): GovernanceWriteResult {
    const replay = this.existingResult(input.requestKey, input.threadId, input.project);
    if (replay) return replay;
    const checked = this.validatedBase(input);
    if (!("state" in checked)) return checked;
    const replacement = this.state(input.replacementThreadId);
    if (!replacement?.current_entry_id) return this.fail("not_found", checked.state, "Replacement memory thread not found.");
    if (!this.inScope(input.replacementThreadId, input.project) || !this.sameScope(input.threadId, input.replacementThreadId)) {
      return this.fail("privacy_scope", checked.state, "Replacement memory is outside the matching privacy scope.");
    }
    if (input.threadId === input.replacementThreadId || replacement.version !== input.replacementExpectedVersion
      || replacement.superseded_by_thread_id || replacement.conflict_status === "unresolved") {
      return this.fail("invalid_state", checked.state, "Replacement memory is stale, conflicted, superseded, or identical to the source thread.");
    }
    const now = Date.now();
    const resultingVersion = checked.state.version + 1;
    const row = this.db.transaction(() => {
      const changed = this.db.prepare(`
        UPDATE memory_index_thread_state
        SET superseded_by_thread_id = ?, pinned = 0, conflict_status = 'none',
            conflict_with = '[]', version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ?
      `).run(input.replacementThreadId, resultingVersion, now, input.threadId, input.expectedVersion);
      if (changed.changes !== 1) throw new Error("stale_governance_write");
      return this.insertEvent({
        threadId: input.threadId,
        entryId: checked.state.current_entry_id,
        kind: "superseded",
        actor: input.actor,
        reason: checked.reason,
        targetThreadId: input.replacementThreadId,
        requestKey: checked.requestKey,
        resultingVersion,
        now,
      });
    })();
    return { ok: true, event: eventFromRow(row), currentEntryId: checked.state.current_entry_id! };
  }

  openConflict(input: GovernanceWriteBase & {
    otherThreadId: string;
    otherExpectedVersion: number;
  }): GovernanceWriteResult {
    const replay = this.existingResult(input.requestKey, input.threadId, input.project);
    if (replay) return replay;
    const checked = this.validatedBase(input);
    if (!("state" in checked)) return checked;
    const other = this.state(input.otherThreadId);
    if (!other?.current_entry_id) return this.fail("not_found", checked.state, "Conflicting memory thread not found.");
    if (!this.inScope(input.otherThreadId, input.project) || !this.sameScope(input.threadId, input.otherThreadId)) {
      return this.fail("privacy_scope", checked.state, "Conflicting memory is outside the matching privacy scope.");
    }
    if (input.threadId === input.otherThreadId || checked.state.superseded_by_thread_id || other.superseded_by_thread_id
      || checked.state.conflict_status === "unresolved" || other.conflict_status === "unresolved"
      || other.version !== input.otherExpectedVersion) {
      return this.fail("invalid_state", checked.state, "Conflict target is stale, already conflicted, superseded, or identical to this thread.");
    }
    const leftConflicts = [...new Set([...parseArray(checked.state.conflict_with), input.otherThreadId])];
    const rightConflicts = [...new Set([...parseArray(other.conflict_with), input.threadId])];
    const now = Date.now();
    const leftVersion = checked.state.version + 1;
    const rightVersion = other.version + 1;
    const row = this.db.transaction(() => {
      const left = this.db.prepare(`UPDATE memory_index_thread_state
        SET conflict_status = 'unresolved', conflict_with = ?, version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ?`)
        .run(JSON.stringify(leftConflicts), leftVersion, now, input.threadId, input.expectedVersion);
      const right = this.db.prepare(`UPDATE memory_index_thread_state
        SET conflict_status = 'unresolved', conflict_with = ?, version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ?`)
        .run(JSON.stringify(rightConflicts), rightVersion, now, input.otherThreadId, input.otherExpectedVersion);
      if (left.changes !== 1 || right.changes !== 1) throw new Error("stale_governance_write");
      const root = this.insertEvent({
        threadId: input.threadId, entryId: checked.state.current_entry_id,
        kind: "conflict_opened", actor: input.actor, reason: checked.reason,
        targetThreadId: input.otherThreadId, requestKey: checked.requestKey,
        resultingVersion: leftVersion, now,
      });
      this.insertEvent({
        threadId: input.otherThreadId, entryId: other.current_entry_id,
        kind: "conflict_opened", actor: input.actor, reason: checked.reason,
        targetThreadId: input.threadId, requestKey: `${checked.requestKey}:peer`,
        resultingVersion: rightVersion, now,
      });
      return root;
    })();
    return { ok: true, event: eventFromRow(row), currentEntryId: checked.state.current_entry_id! };
  }

  resolveConflict(input: GovernanceWriteBase & {
    losingThreadId: string;
    losingExpectedVersion: number;
  }): GovernanceWriteResult {
    const replay = this.existingResult(input.requestKey, input.threadId, input.project);
    if (replay) return replay;
    const checked = this.validatedBase(input);
    if (!("state" in checked)) return checked;
    const loser = this.state(input.losingThreadId);
    if (!loser?.current_entry_id) return this.fail("not_found", checked.state, "Losing memory thread not found.");
    if (!this.inScope(input.losingThreadId, input.project) || !this.sameScope(input.threadId, input.losingThreadId)) {
      return this.fail("privacy_scope", checked.state, "Conflict resolution crosses a privacy boundary.");
    }
    const winnerConflicts = parseArray(checked.state.conflict_with);
    const loserConflicts = parseArray(loser.conflict_with);
    if (!winnerConflicts.includes(input.losingThreadId) || !loserConflicts.includes(input.threadId)
      || checked.state.conflict_status !== "unresolved" || loser.conflict_status !== "unresolved"
      || loser.version !== input.losingExpectedVersion) {
      return this.fail("invalid_state", checked.state, "These threads do not have the expected unresolved conflict state.");
    }
    const remaining = winnerConflicts.filter((id) => id !== input.losingThreadId);
    const now = Date.now();
    const winnerVersion = checked.state.version + 1;
    const loserVersion = loser.version + 1;
    const row = this.db.transaction(() => {
      const winner = this.db.prepare(`UPDATE memory_index_thread_state
        SET conflict_status = ?, conflict_with = ?, version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ?`)
        .run(remaining.length ? "unresolved" : "none", JSON.stringify(remaining), winnerVersion, now, input.threadId, input.expectedVersion);
      const losing = this.db.prepare(`UPDATE memory_index_thread_state
        SET superseded_by_thread_id = ?, pinned = 0, conflict_status = 'none',
            conflict_with = '[]', version = ?, updated_at = ?
        WHERE thread_id = ? AND version = ?`)
        .run(input.threadId, loserVersion, now, input.losingThreadId, input.losingExpectedVersion);
      if (winner.changes !== 1 || losing.changes !== 1) throw new Error("stale_governance_write");
      const root = this.insertEvent({
        threadId: input.threadId, entryId: checked.state.current_entry_id,
        kind: "conflict_resolved", actor: input.actor, reason: checked.reason,
        targetThreadId: input.losingThreadId, requestKey: checked.requestKey,
        resultingVersion: winnerVersion, now,
      });
      this.insertEvent({
        threadId: input.losingThreadId, entryId: loser.current_entry_id,
        kind: "conflict_resolved", actor: input.actor, reason: checked.reason,
        targetThreadId: input.threadId, requestKey: `${checked.requestKey}:peer`,
        resultingVersion: loserVersion, now,
      });
      return root;
    })();
    return { ok: true, event: eventFromRow(row), currentEntryId: checked.state.current_entry_id! };
  }
}
