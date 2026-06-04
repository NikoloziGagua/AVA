import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Ava's persistent conversation with Claude Code. We keep ONE session id and
// reuse it forever so Ava and Claude build up continuity instead of meeting
// fresh each call. The id is created once; `resume` is false only for the very
// first use (which must create the session with --session-id) and true after.

type SessionState = { id: string; started: boolean };

const file = (memoryDir: string) => join(memoryDir, "claude-session.json");

function read(memoryDir: string): SessionState | null {
  const f = file(memoryDir);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")) as SessionState; } catch { return null; }
}

/** Get Ava's Claude session, creating+persisting a UUID on first call. */
export function getClaudeSession(memoryDir: string): { id: string; resume: boolean } {
  const existing = read(memoryDir);
  if (existing) return { id: existing.id, resume: existing.started };
  const id = randomUUID();
  writeFileSync(file(memoryDir), JSON.stringify({ id, started: false }));
  return { id, resume: false };
}

/** Mark the session as started so future calls --resume it instead of recreating. */
export function markClaudeSessionStarted(memoryDir: string): void {
  const s = read(memoryDir);
  if (s && !s.started) writeFileSync(file(memoryDir), JSON.stringify({ ...s, started: true }));
}
