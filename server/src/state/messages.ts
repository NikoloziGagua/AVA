import type { Db } from "./db.js";

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

export type MessageMetadata = {
  visualMessages?: MessageVisualReference[];
  visualContext?: MessageVisualContext;
  /** The owner typed this wording inside voice mode because exact characters mattered. */
  inputSource?: "voice_exact_text";
};

type MessageRow = Omit<Message, "metadata"> & { metadata: string };
const VISUAL_ID = /^visual_[A-Za-z0-9_-]{8,32}$/;
const STABLE_ID = /^[A-Za-z][A-Za-z0-9_-]{1,63}$/;

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
  const metadata = opts.metadata ?? {};
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
