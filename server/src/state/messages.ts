import type { Db } from "./db.js";
import { scrubSecrets } from "../security/scrub.js";

export type Role = "user" | "assistant" | "system";

export type Message = {
  id: number;
  session_id: string;
  role: Role;
  content: string;
  metadata?: MessageMetadata;
  created_at: number;
};

export type MessageVisualReference = {
  visualMessageId: string;
  revision: number;
};

export type MessageVisualContext = MessageVisualReference & {
  action: "explain" | "branch" | "attach";
  sceneId: string;
  selectedElementIds: string[];
};

export type MessageMemoryContextSelection = {
  entryId: string;
  title: string;
  kind: string;
  project: string | null;
  sourceStatus: "verified" | "changed" | "unavailable";
  matchMode: "recent" | "lexical" | "semantic" | "hybrid";
  matchReason: string;
  sourceTruncated: boolean;
};

/**
 * A deliberately compact receipt describing the memory gate that informed an
 * assistant reply. It contains discovery/provenance only: never the retrieval
 * query, source excerpt, generated prompt, transcript, or model reasoning.
 */
export type MessageMemoryContext = {
  schemaVersion: 1;
  status: "used" | "no_match" | "suppressed" | "unavailable" | "error";
  reason: string;
  project: string | null;
  mode: "recent" | "lexical" | "semantic" | "hybrid" | null;
  semanticAvailable: boolean;
  notice: string | null;
  selected: MessageMemoryContextSelection[];
};

export type MessageMetadata = {
  visualMessages?: MessageVisualReference[];
  visualContext?: MessageVisualContext;
  /** The owner typed this wording inside voice mode because exact characters mattered. */
  inputSource?: "voice_exact_text";
  /** Sanitized, source-aware explanation of whether durable memory informed this reply. */
  memoryContext?: MessageMemoryContext;
};

type MessageRow = Omit<Message, "metadata"> & { metadata: string };
const VISUAL_ID = /^visual_[A-Za-z0-9_-]{8,32}$/;
const STABLE_ID = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;
const MEMORY_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,159}$/;
const MEMORY_STATUS = new Set(["used", "no_match", "suppressed", "unavailable", "error"]);
const MEMORY_MODE = new Set(["recent", "lexical", "semantic", "hybrid"]);
const SOURCE_STATUS = new Set(["verified", "changed", "unavailable"]);

function cleanMemoryText(value: unknown, max: number): string {
  return typeof value === "string"
    ? scrubSecrets(value).replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

/** Validates and re-scrubs memory receipts both before persistence and on read. */
export function sanitizeMessageMemoryContext(value: unknown): MessageMemoryContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || typeof candidate.status !== "string" || !MEMORY_STATUS.has(candidate.status)) {
    return null;
  }
  const status = candidate.status as MessageMemoryContext["status"];
  const reason = cleanMemoryText(candidate.reason, 700);
  if (!reason) return null;
  const mode = candidate.mode === null
    ? null
    : typeof candidate.mode === "string" && MEMORY_MODE.has(candidate.mode)
      ? candidate.mode as MessageMemoryContext["mode"]
      : null;
  const selected: MessageMemoryContextSelection[] = [];
  if (Array.isArray(candidate.selected)) {
    for (const raw of candidate.selected.slice(0, 2)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const entryId = typeof item.entryId === "string" && MEMORY_ID.test(item.entryId) ? item.entryId : "";
      const title = cleanMemoryText(item.title, 160);
      const kind = cleanMemoryText(item.kind, 40);
      const matchReason = cleanMemoryText(item.matchReason, 700);
      if (!entryId || !title || !kind || !matchReason ||
          typeof item.sourceStatus !== "string" || !SOURCE_STATUS.has(item.sourceStatus) ||
          typeof item.matchMode !== "string" || !MEMORY_MODE.has(item.matchMode)) continue;
      selected.push({
        entryId,
        title,
        kind,
        project: cleanMemoryText(item.project, 80) || null,
        sourceStatus: item.sourceStatus as MessageMemoryContextSelection["sourceStatus"],
        matchMode: item.matchMode as MessageMemoryContextSelection["matchMode"],
        matchReason,
        sourceTruncated: item.sourceTruncated === true,
      });
    }
  }
  // A receipt may only claim memory was used when at least one validated,
  // source-addressable selection survives the boundary.
  if ((status === "used") !== (selected.length > 0)) return null;
  return {
    schemaVersion: 1,
    status,
    reason,
    project: cleanMemoryText(candidate.project, 80) || null,
    mode,
    semanticAvailable: candidate.semanticAvailable === true,
    notice: cleanMemoryText(candidate.notice, 500) || null,
    selected,
  };
}

function validReference(value: unknown): value is MessageVisualReference {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<MessageVisualReference>;
  return typeof reference.visualMessageId === "string" && VISUAL_ID.test(reference.visualMessageId) &&
    Number.isInteger(reference.revision) && (reference.revision ?? 0) > 0;
}

function parseMetadata(raw: string): MessageMetadata {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const metadata: MessageMetadata = {};
    if (Array.isArray(value.visualMessages)) {
      const visualMessages = value.visualMessages.filter(validReference).slice(0, 8);
      if (visualMessages.length) metadata.visualMessages = visualMessages;
    }
    const context = value.visualContext;
    if (validReference(context)) {
      const candidate = context as unknown as Record<string, unknown>;
      const selected = candidate.selectedElementIds;
      if (
        (candidate.action === "explain" || candidate.action === "branch" || candidate.action === "attach") &&
        typeof candidate.sceneId === "string" && STABLE_ID.test(candidate.sceneId) &&
        Array.isArray(selected) && selected.length <= 14 &&
        selected.every((id) => typeof id === "string" && STABLE_ID.test(id))
      ) metadata.visualContext = context as MessageVisualContext;
    }
    if (value.inputSource === "voice_exact_text") {
      metadata.inputSource = "voice_exact_text";
    }
    const memoryContext = sanitizeMessageMemoryContext(value.memoryContext);
    if (memoryContext) metadata.memoryContext = memoryContext;
    return metadata;
  } catch { return {}; }
}

function fromRow(row: MessageRow): Message {
  return { ...row, metadata: parseMetadata(row.metadata) };
}

export function appendMessage(
  db: Db,
  opts: { sessionId: string; role: Role; content: string; metadata?: MessageMetadata }
): Message {
  const now = Date.now();
  const metadata: MessageMetadata = { ...(opts.metadata ?? {}) };
  if (metadata.memoryContext) {
    const memoryContext = sanitizeMessageMemoryContext(metadata.memoryContext);
    if (memoryContext) metadata.memoryContext = memoryContext;
    else delete metadata.memoryContext;
  }
  const info = db
    .prepare(
      "INSERT INTO messages (session_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(opts.sessionId, opts.role, opts.content, JSON.stringify(metadata), now);
  return {
    id: Number(info.lastInsertRowid),
    session_id: opts.sessionId,
    role: opts.role,
    content: opts.content,
    metadata,
    created_at: now,
  };
}

export function listMessages(db: Db, sessionId: string): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId) as MessageRow[];
  return rows.map(fromRow);
}

export function listMessagesAfterId(db: Db, sessionId: string, afterId: number): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC")
    .all(sessionId, afterId) as MessageRow[];
  return rows.map(fromRow);
}

export function countMessages(db: Db, sessionId: string): number {
  const r = db.prepare("SELECT COUNT(*) as n FROM messages WHERE session_id = ?").get(sessionId) as { n: number };
  return r.n;
}
