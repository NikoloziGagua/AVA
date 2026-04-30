import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export type Session = {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  status: "active" | "idle" | "archived";
};

export function createSession(db: Db, opts: { title?: string | null }): Session {
  const id = nanoid(12);
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?)"
  ).run(id, opts.title ?? null, now, now, "active");
  return { id, title: opts.title ?? null, created_at: now, updated_at: now, status: "active" };
}

export function getSession(db: Db, id: string): Session | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(id) as Session | undefined;
  return row ?? null;
}

export function softDeleteSession(db: Db, id: string): void {
  const now = Date.now();
  db.prepare("UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
}

export function purgeDeletedSessions(db: Db, olderThanMs: number): number {
  const r = db.prepare("DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(olderThanMs);
  return r.changes;
}

export type SessionWithSummary = Session & {
  summary: string | null;
  summary_through_message_id: number | null;
};

export function getSessionFull(db: Db, id: string): SessionWithSummary | null {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionWithSummary | undefined;
  return row ?? null;
}

export function updateSummary(db: Db, id: string, summary: string, throughMessageId: number): void {
  db.prepare(
    "UPDATE sessions SET summary = ?, summary_through_message_id = ?, updated_at = ? WHERE id = ?",
  ).run(summary, throughMessageId, Date.now(), id);
}

export function listSessions(db: Db): Session[] {
  return db.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC").all() as Session[];
}

export function touchSession(db: Db, id: string): void {
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}

export function updateTitle(db: Db, id: string, title: string): void {
  db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(
    title,
    Date.now(),
    id,
  );
}

export function setStatus(db: Db, id: string, status: string): void {
  db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function listByStatus(db: Db, status: string): Session[] {
  return db.prepare("SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC").all(status) as Session[];
}
