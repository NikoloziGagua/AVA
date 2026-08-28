import type { Db } from "../state/db.js";
import { listMessages, type Message } from "../state/messages.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { scrubSecrets } from "../security/scrub.js";
import type { MemoryIndexKind } from "./types.js";
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
};

const RESEARCH_REQUEST = /^(?:(?:please|can you|could you|would you|i want you to|let's)\s+)?(?:research|investigate|deep[ -]?dive|look into|find (?:reliable )?sources?|browse (?:the )?web|search (?:the )?(?:web|internet)|conduct (?:a )?(?:literature|evidence) review|compare (?:the )?sources?)\b/i;
const IDEA_SIGNAL = /\b(?:ideas?|brainstorm|concept|proposal|product vision|feature design|design (?:a|the|this)|what if|could we|should we (?:build|make|add)|approach|architecture|workflow design)\b/i;
const MAX_CONTEXT_MESSAGES = 24;
const MAX_PROVIDER_CHARS = 20_000;

const SYSTEM = `You are AVA's conservative durable-memory editor.
Return one JSON object and nothing else, with exactly these keys:
{"capture":boolean,"title":string,"summary":string,"conclusions":string[],"openQuestions":string[],"nextSteps":string[],"tags":string[],"reason":string}

Capture only substantial completed research or an idea meaningfully developed by both Niko and AVA. Do not capture greetings, routine execution, reminders, watcher instructions, transient status, failed work, credentials, private authentication data, or unsupported guesses. Use only the supplied conversation range. The summary is a compact discovery record, not a transcript. Preserve important decisions, disagreements, limitations, and unresolved questions. If the range is not genuinely durable, return capture=false with empty content arrays.`;

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
    };
  }

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
  };
}

function generatedPrompt(candidate: Candidate): string {
  const transcript = candidate.messages.map((message) =>
    `[message ${message.id}] ${message.role.toUpperCase()}: ${scrubSecrets(message.content)}`)
    .join("\n\n")
    .slice(0, MAX_PROVIDER_CHARS);
  return [
    `Candidate kind: ${candidate.kind}`,
    `Deterministic gate: ${candidate.reason}`,
    `Authoritative range: ${candidate.fromMessageId}-${candidate.throughMessageId}`,
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

  readonly consider: AutoMemoryCapture = async (input) => {
    const all = listMessages(this.db, input.sessionId);
    const candidate = detectCandidate(all, input.userMessageId, input.assistantMessageId);
    if (!candidate) {
      return { status: "skipped", reason: "No completed durable research or developed-idea signal was present.", entryId: null };
    }

    // Phase 2 captures the first completed version of a developed idea. Later
    // linked revisions/checkpoints are intentionally owned by Phase 3.
    if (candidate.kind === "idea") {
      const overlapping = this.db.prepare(`
        SELECT e.id
        FROM memory_index_entries e
        JOIN memory_index_sources s ON s.entry_id = e.id
        WHERE e.status = 'active' AND e.capture_mode = 'automatic'
          AND e.kind = 'idea' AND s.session_id = ?
          AND s.through_message_id >= ?
        LIMIT 1
      `).get(input.sessionId, candidate.fromMessageId) as { id: string } | undefined;
      if (overlapping) {
        return { status: "skipped", reason: "This developed idea range already has an automatic checkpoint; linked revisions are deferred to Phase 3.", entryId: overlapping.id };
      }
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
      const captureReason = candidate.kind === "research"
        ? `Automatically indexed completed research from an AVA ${input.channel} turn.`
        : `Automatically indexed a meaningfully developed idea from AVA ${input.channel}.`;
      const captured = await this.index.capture({
        sessionId: input.sessionId,
        fromMessageId: candidate.fromMessageId,
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
