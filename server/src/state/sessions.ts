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
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
  return row ?? null;
}

export function listSessions(db: Db): Session[] {
  return db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Session[];
}

export function touchSession(db: Db, id: string): void {
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
}
