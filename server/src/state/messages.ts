import type { Db } from "./db.js";

export type Role = "user" | "assistant" | "system";

export type Message = {
  id: number;
  session_id: string;
  role: Role;
  content: string;
  created_at: number;
};

export function appendMessage(
  db: Db,
  opts: { sessionId: string; role: Role; content: string }
): Message {
  const now = Date.now();
  const info = db
    .prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(opts.sessionId, opts.role, opts.content, now);
  return {
    id: Number(info.lastInsertRowid),
    session_id: opts.sessionId,
    role: opts.role,
    content: opts.content,
    created_at: now,
  };
}

export function listMessages(db: Db, sessionId: string): Message[] {
  return db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId) as Message[];
}

export function listMessagesAfterId(db: Db, sessionId: string, afterId: number): Message[] {
  return db
    .prepare("SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC")
    .all(sessionId, afterId) as Message[];
}

export function countMessages(db: Db, sessionId: string): number {
  const r = db.prepare("SELECT COUNT(*) as n FROM messages WHERE session_id = ?").get(sessionId) as { n: number };
  return r.n;
}
