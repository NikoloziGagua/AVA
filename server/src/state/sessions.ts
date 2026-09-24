import { nanoid } from "nanoid";
import type { Db } from "./db.js";

export type SessionOrigin = "human" | "automation" | "unknown";

export type Session = {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
  status: "active" | "idle" | "archived";
  pinned: number;
  origin: SessionOrigin;
  last_human_activity_at: number | null;
};

export function createSession(db: Db, opts: { title?: string | null; origin?: SessionOrigin }): Session {
  const id = nanoid(12);
  const now = Date.now();
  const origin = opts.origin ?? "unknown";
  db.prepare(
    "INSERT INTO sessions (id, title, created_at, updated_at, status, origin) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, opts.title ?? null, now, now, "active", origin);
  return { id, title: opts.title ?? null, created_at: now, updated_at: now, status: "active", pinned: 0, origin, last_human_activity_at: null };
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
  const row = db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(id) as SessionWithSummary | undefined;
  return row ?? null;
}

export function updateSummary(db: Db, id: string, summary: string, throughMessageId: number): void {
  db.prepare(
    "UPDATE sessions SET summary = ?, summary_through_message_id = ?, updated_at = ? WHERE id = ?",
  ).run(summary, throughMessageId, Date.now(), id);
}

export function listSessions(db: Db): Session[] {
  return db.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY pinned DESC, updated_at DESC").all() as Session[];
}

/**
 * The conversation most recently used, independent of the chat-list pin order.
 * Pins are a presentation preference; using them as a recency signal made voice
 * silently resume an older pinned chat instead of the conversation Niko had just
 * been using.
 */
export function getMostRecentSession(db: Db): Session | null {
  const row = db.prepare(
    "SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY updated_at DESC, rowid DESC LIMIT 1",
  ).get() as Session | undefined;
  return row ?? null;
}

/** Only a trusted human ingress may stamp this, never a stored user-role row. */
export function markHumanActivity(db: Db, id: string, at = Date.now()): void {
  if (!Number.isSafeInteger(at) || at < 0) throw new RangeError("Invalid human activity timestamp");
  db.prepare(`
    UPDATE sessions SET last_human_activity_at = ?
    WHERE id = ? AND deleted_at IS NULL AND origin != 'automation'
      AND (last_human_activity_at IS NULL OR last_human_activity_at < ?)
  `).run(at, id, at);
}

/** Pins and background maintenance are deliberately not continuation signals. */
export function getMostRecentHumanSession(db: Db): Session | null {
  const row = db.prepare(`
    SELECT * FROM sessions WHERE deleted_at IS NULL AND status != 'archived'
      AND (origin = 'human' OR (origin = 'unknown' AND last_human_activity_at IS NOT NULL))
    ORDER BY last_human_activity_at DESC NULLS LAST, id DESC LIMIT 1
  `).get() as Session | undefined;
  return row ?? null;
}

export type SessionScope = "human" | "automation" | "legacy" | "all";
export type SessionPage = { sessions: Session[]; nextCursor: string | null };

export class SessionListError extends Error {
  readonly status = 400;
  readonly code = "bad_request";
  constructor() { super("Invalid session list request"); }
}

type SessionCursor = {
  version: 1;
  scope: SessionScope;
  order: "human_activity" | "updated";
  pinned: number;
  at: number | null;
  id: string;
};

function parseSessionCursor(value: string, scope: SessionScope): SessionCursor {
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new SessionListError();
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new SessionListError();
    const cursor = JSON.parse(decoded.toString("utf8")) as SessionCursor;
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)
      || Object.keys(cursor).sort().join(",") !== "at,id,order,pinned,scope,version"
      || cursor.version !== 1 || cursor.scope !== scope
      || cursor.order !== (scope === "human" ? "human_activity" : "updated")
      || (cursor.pinned !== 0 && cursor.pinned !== 1)
      || !(typeof cursor.at === "number" && Number.isSafeInteger(cursor.at) && cursor.at >= 0
        || scope === "human" && cursor.at === null)
      || typeof cursor.id !== "string" || !/^[\x21-\x7e]{1,128}$/.test(cursor.id)) {
      throw new SessionListError();
    }
    return cursor;
  } catch { throw new SessionListError(); }
}

/** Keyset pagination; absence from any one page never means deletion. */
export function listSessionsPage(db: Db, opts: { scope: SessionScope; limit?: number; cursor?: string }): SessionPage {
  const { scope, cursor } = opts;
  const limit = opts.limit ?? 20;
  if (!["human", "automation", "legacy", "all"].includes(scope)
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || cursor !== undefined && typeof cursor !== "string") throw new SessionListError();
  const after = cursor === undefined ? null : parseSessionCursor(cursor, scope);
  const filters: Record<SessionScope, string> = {
    // A human-origin row with no accepted human turn (New, or voice opened and
    // nothing said) has nothing to show, so it is not listed. It is never
    // deleted: exact lookup, the remembered pointer and continue still reach it.
    human: "status != 'archived' AND origin != 'automation' AND (last_human_activity_at IS NOT NULL OR pinned = 1)",
    automation: "origin = 'automation'",
    legacy: "origin = 'unknown' AND last_human_activity_at IS NULL",
    all: "1 = 1",
  };
  const column = scope === "human" ? "last_human_activity_at" : "updated_at";
  const params: Array<string | number> = [];
  let keyset = "";
  if (after) {
    // NULL is lower than every timestamp in this descending order.
    const recency = after.at === null ? `${column} IS NULL AND id < ?`
      : `(${column} < ? OR ${column} IS NULL OR (${column} = ? AND id < ?))`;
    keyset = ` AND (pinned < ? OR (pinned = ? AND (${recency})))`;
    params.push(after.pinned, after.pinned);
    if (after.at !== null) params.push(after.at, after.at);
    params.push(after.id);
  }
  const rows = db.prepare(`SELECT * FROM sessions
    WHERE deleted_at IS NULL AND (${filters[scope]})${keyset}
    ORDER BY pinned DESC, ${column} DESC NULLS LAST, id DESC LIMIT ?
  `).all(...params, limit + 1) as Session[];
  const sessions = rows.slice(0, limit);
  const last = sessions.at(-1);
  const next: SessionCursor | null = rows.length > limit && last ? {
    version: 1, scope, order: scope === "human" ? "human_activity" : "updated",
    pinned: last.pinned, at: scope === "human" ? last.last_human_activity_at : last.updated_at, id: last.id,
  } : null;
  return { sessions, nextCursor: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null };
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

export function setPinned(db: Db, id: string, pinned: boolean): void {
  db.prepare("UPDATE sessions SET pinned = ? WHERE id = ? AND deleted_at IS NULL").run(pinned ? 1 : 0, id);
}

export function setStatus(db: Db, id: string, status: string): void {
  db.prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
}

export function listByStatus(db: Db, status: string): Session[] {
  return db.prepare("SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC").all(status) as Session[];
}
