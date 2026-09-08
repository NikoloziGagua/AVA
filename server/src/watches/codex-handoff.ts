import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { scrubSecrets } from "../security/scrub.js";

export const CODEX_HANDOFF_SCHEMA_VERSION = 1 as const;
export const CODEX_HANDOFF_PROMPT_LIMIT = 64 * 1024;

export type CodexHandoffRecord = {
  schemaVersion: typeof CODEX_HANDOFF_SCHEMA_VERSION;
  watchId: string;
  parentWatchId: string | null;
  threadId: string;
  cwd: string;
  marker: string;
  dispatchOffset: number;
  continueCycle: boolean;
  prompt: string;
  createdAt: number;
};

export type CodexHandoffCompletion = {
  schemaVersion: typeof CODEX_HANDOFF_SCHEMA_VERSION;
  watchId: string;
  threadId: string;
  turnId: string;
  completedAt: number;
};

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function recordPath(inboxDir: string, state: "pending" | "claimed" | "completed", watchId: string): string {
  return join(inboxDir, state, `${safeId(watchId, "watch id")}.json`);
}

function readJson<T>(path: string): T | null {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length > CODEX_HANDOFF_PROMPT_LIMIT * 2) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function writeAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function validExisting(record: CodexHandoffRecord | null, expected: Pick<CodexHandoffRecord, "watchId" | "threadId" | "marker">): record is CodexHandoffRecord {
  return Boolean(
    record
    && record.schemaVersion === CODEX_HANDOFF_SCHEMA_VERSION
    && record.watchId === expected.watchId
    && record.threadId === expected.threadId
    && record.marker === expected.marker,
  );
}

/**
 * Persist one bounded instruction for the Stop hook that already runs inside
 * the pinned Codex writer. The file is the async boundary: AVA never starts a
 * second writer for a TUI-owned thread.
 */
export function stageCodexHandoff(
  inboxDir: string,
  input: Omit<CodexHandoffRecord, "schemaVersion" | "prompt" | "createdAt"> & { prompt: string; createdAt?: number },
): { record: CodexHandoffRecord; existing: boolean } {
  safeId(input.watchId, "watch id");
  safeId(input.threadId, "thread id");
  const prompt = scrubSecrets(input.prompt).slice(0, CODEX_HANDOFF_PROMPT_LIMIT);
  if (!prompt.trim()) throw new Error("Codex handoff prompt is empty");
  const record: CodexHandoffRecord = {
    schemaVersion: CODEX_HANDOFF_SCHEMA_VERSION,
    watchId: input.watchId,
    parentWatchId: input.parentWatchId,
    threadId: input.threadId,
    cwd: input.cwd,
    marker: input.marker,
    dispatchOffset: Math.max(0, Math.trunc(input.dispatchOffset)),
    continueCycle: input.continueCycle,
    prompt,
    createdAt: input.createdAt ?? Date.now(),
  };

  for (const state of ["pending", "claimed"] as const) {
    const existing = readJson<CodexHandoffRecord>(recordPath(inboxDir, state, input.watchId));
    if (validExisting(existing, record)) return { record: existing, existing: true };
  }
  const completed = readCodexHandoffCompletion(inboxDir, input.watchId);
  if (completed?.threadId === input.threadId) return { record, existing: true };

  const path = recordPath(inboxDir, "pending", input.watchId);
  try {
    writeAtomic(path, record);
    return { record, existing: false };
  } catch (error) {
    const raced = readJson<CodexHandoffRecord>(path);
    if (validExisting(raced, record)) return { record: raced, existing: true };
    throw error;
  }
}

export function hasCodexHandoff(inboxDir: string, watchId: string): boolean {
  safeId(watchId, "watch id");
  return ["pending", "claimed", "completed"].some((state) => existsSync(recordPath(inboxDir, state as "pending" | "claimed" | "completed", watchId)));
}

export function readCodexHandoffCompletion(inboxDir: string, watchId: string): CodexHandoffCompletion | null {
  const record = readJson<CodexHandoffCompletion>(recordPath(inboxDir, "completed", watchId));
  if (!record || record.schemaVersion !== CODEX_HANDOFF_SCHEMA_VERSION || record.watchId !== watchId) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(record.threadId) || typeof record.turnId !== "string" || !Number.isFinite(record.completedAt)) return null;
  return record;
}

export function watchIdFromMarker(marker: string | null | undefined): string | null {
  const match = /^\[AVA-WATCH:([A-Za-z0-9_-]{1,128})\]$/.exec(marker?.trim() ?? "");
  return match?.[1] ?? null;
}
