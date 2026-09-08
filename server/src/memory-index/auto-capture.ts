import type { Db } from "../state/db.js";
import { listMessages, type Message } from "../state/messages.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { scrubSecrets } from "../security/scrub.js";
import {
  MEMORY_CHECKPOINT_KINDS,
  type MemoryCheckpointKind,
  type MemoryIndexKind,
  type MemoryIndexResult,
} from "./types.js";
import { MemoryIndexService } from "./store.js";

export type AutoMemoryChannel = "chat" | "voice";

export type AutoMemoryCaptureInput = {
  sessionId: string;
  userMessageId: number;
  assistantMessageId: number;
  channel: AutoMemoryChannel;
};

export type AutoMemoryCaptureResult = {
  status: "captured" | "skipped" | "failed" | "in_progress";
  reason: string;
  entryId: string | null;
};

export type AutoMemoryCapture = (input: AutoMemoryCaptureInput) => Promise<AutoMemoryCaptureResult>;

type Candidate = {
  kind: Extract<MemoryIndexKind, "research" | "idea">;
  fromMessageId: number;
  throughMessageId: number;
  messages: Message[];
  reason: string;
  previous: MemoryIndexResult | null;
};

type AutoEventRow = {
  status: string;
  reason: string;
  entry_id: string | null;
};

type GeneratedRecord = {
  capture: boolean;
  title: string;
  summary: string;
  conclusions: string[];
  openQuestions: string[];
  nextSteps: string[];
  tags: string[];
  reason: string;
  relationship: "continue" | "new_thread";
  checkpointKind: MemoryCheckpointKind;
};

const RESEARCH_REQUEST = /^(?:(?:please|can you|could you|would you|i want you to|let's)\s+)?(?:research|investigate|deep[ -]?dive|look into|find (?:reliable )?sources?|browse (?:the )?web|search (?:the )?(?:web|internet)|conduct (?:a )?(?:literature|evidence) review|compare (?:the )?sources?)\b/i;
const IDEA_SIGNAL = /\b(?:ideas?|brainstorm|concept|proposal|product vision|feature design|design (?:a|the|this)|what if|could we|should we (?:build|make|add)|approach|architecture|workflow design)\b/i;
const CHECKPOINT_SIGNAL = /\b(?:add|change|remove|instead|refin(?:e|ement)|revis(?:e|ion)|decid(?:e|ed|ing)|decision|agree(?:d)?|settled|conclu(?:de|ded|sion)|open question|unresolved|next step|priority|requirement|constraint|trade[- ]?off|scope|phase|focus|direction|topic|approach|architecture|workflow|must|should)\b/i;
const MAX_CONTEXT_MESSAGES = 24;
const MAX_PROVIDER_CHARS = 20_000;

const SYSTEM = `You are AVA's conservative durable-memory editor.
Return one JSON object and nothing else, with exactly these keys:
{"capture":boolean,"title":string,"summary":string,"conclusions":string[],"openQuestions":string[],"nextSteps":string[],"tags":string[],"reason":string,"relationship":"continue"|"new_thread","checkpointKind":"initial"|"revision"|"decision"|"conclusion"|"topic_shift"|"open_question"|"next_step"}

Capture only substantial completed research or an idea meaningfully developed by both Niko and AVA. For a later idea turn, capture only a material decision, conclusion, topic shift, open question, next step, or substantive revision. Superficial restatement, thanks, or unchanged discussion must return capture=false. When a previous checkpoint is supplied, return relationship=continue only when the new material belongs to that idea; use new_thread only for a distinct idea that has itself been developed over at least two user and two assistant turns. A continuation summary must be a compact standalone current-state snapshot, merging the prior checkpoint with supported new material. Do not capture greetings, routine execution, reminders, watcher instructions, transient status, failed work, credentials, private authentication data, or unsupported guesses. Use only the supplied previous checkpoint and conversation range. The summary is a compact discovery record, not a transcript. Preserve important decisions, disagreements, limitations, and unresolved questions. If the range is not genuinely durable, return capture=false with empty content arrays.`;

function cleanInline(value: unknown, max: number): string {
  return scrubSecrets(String(value ?? "")).replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const item = cleanInline(raw, maxLength);
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
}

function parseGenerated(raw: string): GeneratedRecord | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof value.capture !== "boolean") return null;
  const title = cleanInline(value.title, 160);
  const summary = scrubSecrets(String(value.summary ?? "")).replace(/\r\n/g, "\n").trim().slice(0, 6_000);
  const record: GeneratedRecord = {
    capture: value.capture,
    title,
    summary,
    conclusions: cleanList(value.conclusions, 12, 600),
    openQuestions: cleanList(value.openQuestions, 12, 600),
    nextSteps: cleanList(value.nextSteps, 12, 600),
    tags: cleanList(value.tags, 16, 48),
    reason: cleanInline(value.reason, 240),
    relationship: value.relationship === "new_thread" ? "new_thread" : "continue",
    checkpointKind: typeof value.checkpointKind === "string"
      && (MEMORY_CHECKPOINT_KINDS as readonly string[]).includes(value.checkpointKind)
      ? value.checkpointKind as MemoryCheckpointKind
      : "revision",
  };
  if (record.capture && (!record.title || record.summary.length < 80)) return null;
  return record;
}

function boundedMessages(messages: Message[], fromMessageId: number, throughMessageId: number): Message[] {
  const range = messages.filter((message) =>
    message.id >= fromMessageId
    && message.id <= throughMessageId
    && (message.role === "user" || message.role === "assistant"));
  if (range.length <= MAX_CONTEXT_MESSAGES) return range;
  const tail = range.slice(-MAX_CONTEXT_MESSAGES);
  const firstUser = tail.findIndex((message) => message.role === "user");
  return firstUser >= 0 ? tail.slice(firstUser) : tail;
}

function detectCandidate(
  messages: Message[],
  userMessageId: number,
  assistantMessageId: number,
  previous: MemoryIndexResult | null,
): Candidate | null {
  const user = messages.find((message) => message.id === userMessageId);
  const assistant = messages.find((message) => message.id === assistantMessageId);
  if (!user || user.role !== "user" || !assistant || assistant.role !== "assistant" || user.id >= assistant.id) return null;
  if (assistant.content.trim().length < 180 || /^(?:that didn't work|error\b|cancelled\b|stopped\b)/i.test(assistant.content.trim())) return null;

  if (RESEARCH_REQUEST.test(user.content.trim())) {
    const range = boundedMessages(messages, user.id, assistant.id);
    return {
      kind: "research",
      fromMessageId: range[0]?.id ?? user.id,
      throughMessageId: assistant.id,
      messages: range,
      reason: "The completed user turn explicitly requested research or source investigation.",
      previous: null,
    };
  }

  if (previous?.usable && previous.entry.kind === "idea" && previous.source.sessionId) {
    const delta = messages.filter((message) =>
      message.id > previous.source.throughMessageId
      && message.id <= assistant.id
      && (message.role === "user" || message.role === "assistant"));
    if (
      delta.some((message) => message.id === user.id)
      && delta.some((message) => message.id === assistant.id)
      && CHECKPOINT_SIGNAL.test(user.content)
    ) {
      return {
        kind: "idea",
        fromMessageId: delta[0]?.id ?? user.id,
        throughMessageId: assistant.id,
        messages: boundedMessages(delta, delta[0]?.id ?? user.id, assistant.id),
        reason: "A later turn in a developed idea contains a deterministic checkpoint-change signal.",
        previous,
      };
    }
  }
  // Once a session already has a verified idea checkpoint, only an explicit
  // deterministic change signal may ask the editor for a later checkpoint.
  // Falling through to the initial multi-turn detector would recapture the
  // entire old idea after a simple "thanks" turn.
  if (previous) return null;

  const eligible = messages
    .filter((message) => message.id <= assistant.id && (message.role === "user" || message.role === "assistant"))
    .slice(-MAX_CONTEXT_MESSAGES);
  let ideaStart = -1;
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index]!;
    if (message.role === "user" && IDEA_SIGNAL.test(message.content)) ideaStart = index;
  }
  if (ideaStart < 0) return null;
  const range = eligible.slice(ideaStart);
  const userTurns = range.filter((message) => message.role === "user").length;
  const assistantTurns = range.filter((message) => message.role === "assistant").length;
  const characters = range.reduce((total, message) => total + message.content.trim().length, 0);
  if (userTurns < 2 || assistantTurns < 2 || characters < 700) return null;
  return {
    kind: "idea",
    fromMessageId: range[0]!.id,
    throughMessageId: assistant.id,
    messages: range,
    reason: "The range contains a multi-turn idea developed by both Niko and AVA.",
    previous: null,
  };
}

function generatedPrompt(candidate: Candidate): string {
  const transcript = candidate.messages.map((message) =>
    `[message ${message.id}] ${message.role.toUpperCase()}: ${scrubSecrets(message.content)}`)
    .join("\n\n")
    .slice(0, MAX_PROVIDER_CHARS);
  const previous = candidate.previous ? [
    "Previous verified compact checkpoint:",
    JSON.stringify({
      id: candidate.previous.entry.id,
      threadId: candidate.previous.entry.threadId,
      checkpointSequence: candidate.previous.entry.checkpointSequence,
      title: candidate.previous.entry.title,
      summary: candidate.previous.entry.summary,
      conclusions: candidate.previous.entry.conclusions,
      openQuestions: candidate.previous.entry.openQuestions,
      nextSteps: candidate.previous.entry.nextSteps,
    }),
  ] : [];
  return [
    `Candidate kind: ${candidate.kind}`,
    `Deterministic gate: ${candidate.reason}`,
    `Authoritative range: ${candidate.fromMessageId}-${candidate.throughMessageId}`,
    ...previous,
    "Conversation:",
    transcript,
  ].join("\n\n");
}

export class AutoMemoryCaptureCoordinator {
  constructor(
    private readonly db: Db,
    private readonly provider: LLMProvider,
    private readonly index: MemoryIndexService,
  ) {}

  private latestIdeaCheckpoint(
    sessionId: string,
    beforeMessageId: number,
    threadId: string | null = null,
  ): MemoryIndexResult | null {
    const row = this.db.prepare(`
      SELECT e.id
      FROM memory_index_entries e
      JOIN memory_index_sources s ON s.entry_id = e.id
      WHERE e.status = 'active' AND e.capture_mode = 'automatic'
        AND e.kind = 'idea' AND s.session_id = ?
        AND s.through_message_id < ?
        AND (? IS NULL OR COALESCE(e.thread_id, e.id) = ?)
      ORDER BY s.through_message_id DESC, e.checkpoint_sequence DESC, e.created_at DESC
      LIMIT 1
    `).get(sessionId, beforeMessageId, threadId, threadId) as { id: string } | undefined;
    return row ? this.index.get(row.id) : null;
  }

  readonly consider: AutoMemoryCapture = async (input) => {
    const all = listMessages(this.db, input.sessionId);
    const previous = this.latestIdeaCheckpoint(input.sessionId, input.assistantMessageId);
    const candidate = detectCandidate(all, input.userMessageId, input.assistantMessageId, previous);
    if (!candidate) {
      return { status: "skipped", reason: "No completed durable research or developed-idea signal was present.", entryId: null };
    }

    const now = Date.now();
    const claimed = this.db.prepare(`
      INSERT OR IGNORE INTO memory_index_auto_events (
        assistant_message_id, session_id, status, candidate_kind, reason,
        entry_id, created_at, updated_at
      ) VALUES (?, ?, 'processing', ?, ?, NULL, ?, ?)
    `).run(input.assistantMessageId, input.sessionId, candidate.kind, candidate.reason, now, now);
    if (claimed.changes !== 1) {
      const existing = this.db.prepare(`
        SELECT status, reason, entry_id FROM memory_index_auto_events
        WHERE assistant_message_id = ?
      `).get(input.assistantMessageId) as AutoEventRow | undefined;
      if (!existing) return { status: "failed", reason: "Automatic memory claim could not be verified.", entryId: null };
      return {
        status: existing.status === "captured" ? "captured"
          : existing.status === "processing" ? "in_progress"
            : existing.status === "failed" ? "failed" : "skipped",
        reason: scrubSecrets(existing.reason),
        entryId: existing.entry_id,
      };
    }

    try {
      const generated = parseGenerated(await this.provider.complete({
        model: this.provider.defaultSideModel,
        system: SYSTEM,
        user: generatedPrompt(candidate),
        maxTokens: 1_200,
      }));
      if (!generated) throw new Error("memory editor returned invalid structured output");
      if (!generated.capture) {
        const reason = generated.reason || "The conservative memory editor rejected this candidate as not durable.";
        this.db.prepare(`
          UPDATE memory_index_auto_events
          SET status = 'skipped', reason = ?, updated_at = ?
          WHERE assistant_message_id = ? AND status = 'processing'
        `).run(reason, Date.now(), input.assistantMessageId);
        return { status: "skipped", reason, entryId: null };
      }
      let lineageParent = candidate.previous;
      if (candidate.previous && generated.relationship === "continue") {
        // The provider call is asynchronous. Re-read the latest parent so two
        // simultaneous completed turns either chain or the broader later range
        // subsumes an older completion; they must never fork the same sequence.
        const latest = this.latestIdeaCheckpoint(
          input.sessionId,
          Number.MAX_SAFE_INTEGER,
          candidate.previous.entry.threadId,
        );
        if (!latest?.usable) {
          throw new Error("the prior idea checkpoint became unavailable before capture");
        }
        if (latest.source.throughMessageId >= candidate.throughMessageId) {
          const reason = "A later checkpoint already covers this completed turn.";
          this.db.prepare(`
            UPDATE memory_index_auto_events
            SET status = 'skipped', reason = ?, entry_id = ?, updated_at = ?
            WHERE assistant_message_id = ? AND status = 'processing'
          `).run(reason, latest.entry.id, Date.now(), input.assistantMessageId);
          return { status: "skipped", reason, entryId: latest.entry.id };
        }
        lineageParent = latest;
      }
      if (candidate.previous && generated.relationship === "new_thread") {
        const userTurns = candidate.messages.filter((message) => message.role === "user").length;
        const assistantTurns = candidate.messages.filter((message) => message.role === "assistant").length;
        const characters = candidate.messages.reduce((sum, message) => sum + message.content.trim().length, 0);
        if (userTurns < 2 || assistantTurns < 2 || characters < 700) {
          const reason = "The distinct idea has not yet been developed across enough turns for a durable checkpoint.";
          this.db.prepare(`
            UPDATE memory_index_auto_events
            SET status = 'skipped', reason = ?, updated_at = ?
            WHERE assistant_message_id = ? AND status = 'processing'
          `).run(reason, Date.now(), input.assistantMessageId);
          return { status: "skipped", reason, entryId: null };
        }
        lineageParent = null;
      }
      const continuing = candidate.kind === "idea" && generated.relationship === "continue" && lineageParent !== null;
      const checkpointKind: MemoryCheckpointKind = continuing
        ? generated.checkpointKind === "initial" ? "revision" : generated.checkpointKind
        : "initial";
      const sourceFromMessageId = continuing
        ? lineageParent!.source.fromMessageId
        : candidate.fromMessageId;
      const captureReason = candidate.kind === "research"
        ? `Automatically indexed completed research from an AVA ${input.channel} turn.`
        : continuing
          ? `Automatically indexed ${checkpointKind.replace("_", " ")} checkpoint ${lineageParent!.entry.checkpointSequence + 1} for a developing idea from AVA ${input.channel}.`
          : `Automatically indexed a meaningfully developed idea from AVA ${input.channel}.`;
      const captured = await this.index.capture({
        sessionId: input.sessionId,
        fromMessageId: sourceFromMessageId,
        throughMessageId: candidate.throughMessageId,
        kind: candidate.kind,
        title: generated.title,
        summary: generated.summary,
        conclusions: generated.conclusions,
        openQuestions: generated.openQuestions,
        nextSteps: generated.nextSteps,
        tags: generated.tags,
        privacyLevel: "personal",
        captureMode: "automatic",
        captureReason,
        parentEntryId: continuing ? lineageParent!.entry.id : null,
        expectedParentVersion: continuing ? lineageParent!.entry.version : undefined,
        checkpointKind,
        checkpointReason: generated.reason,
      });
      this.db.prepare(`
        UPDATE memory_index_auto_events
        SET status = 'captured', reason = ?, entry_id = ?, updated_at = ?
        WHERE assistant_message_id = ? AND status = 'processing'
      `).run(captureReason, captured.result.entry.id, Date.now(), input.assistantMessageId);
      return { status: "captured", reason: captureReason, entryId: captured.result.entry.id };
    } catch (error) {
      const detail = cleanInline(error instanceof Error ? error.message : String(error), 240)
        || "automatic memory capture failed without diagnostic detail";
      this.db.prepare(`
        UPDATE memory_index_auto_events
        SET status = 'failed', reason = ?, updated_at = ?
        WHERE assistant_message_id = ? AND status = 'processing'
      `).run(detail, Date.now(), input.assistantMessageId);
      return { status: "failed", reason: detail, entryId: null };
    }
  };
}
