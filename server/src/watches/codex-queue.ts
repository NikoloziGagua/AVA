import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scrubSecrets } from "../security/scrub.js";

const MAX_QUEUE_ITEMS = 100;
const MAX_USER_INPUT_TEXT_CHARS = 1 << 20;
const REQUIRED_COLUMNS = [
  "id",
  "thread_id",
  "payload_json",
  "queue_order",
  "created_at_ms",
  "updated_at_ms",
] as const;

export type CodexQueueReceipt = {
  schemaVersion: 1;
  watchId: string;
  threadId: string;
  queueItemId: string;
  promptSha256: string;
  stagedAt: string;
};

export type CodexQueueStageResult = CodexQueueReceipt & { existing: boolean };

function receiptPath(receiptRoot: string, watchId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(watchId)) throw new Error("invalid Codex watcher ID");
  return join(receiptRoot, "queued", `${watchId}.json`);
}

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function readReceipt(path: string): CodexQueueReceipt | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<CodexQueueReceipt>;
    if (
      value.schemaVersion !== 1
      || typeof value.watchId !== "string"
      || typeof value.threadId !== "string"
      || typeof value.queueItemId !== "string"
      || typeof value.promptSha256 !== "string"
      || typeof value.stagedAt !== "string"
    ) return null;
    return value as CodexQueueReceipt;
  } catch {
    return null;
  }
}

function writeReceipt(path: string, receipt: CodexQueueReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temp, path);
}

function validateQueueSchema(db: Database.Database): void {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'queued_items'").get();
  if (!table) throw new Error("Codex durable queue schema is unavailable");
  const columns = db.prepare("PRAGMA table_info(queued_items)").all() as Array<{ name?: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (REQUIRED_COLUMNS.some((column) => !names.has(column))) {
    throw new Error("Codex durable queue schema is incompatible");
  }
}

function queuePayload(prompt: string, watchId: string): string {
  const characterCount = Array.from(prompt).length;
  if (characterCount === 0) throw new Error("Codex watcher prompt is empty");
  if (characterCount > MAX_USER_INPUT_TEXT_CHARS) {
    throw new Error(`Codex watcher prompt exceeds ${MAX_USER_INPUT_TEXT_CHARS} characters`);
  }
  return JSON.stringify({
    UserInput: {
      content: [{ type: "text", text: prompt, text_elements: [] }],
      client_id: `ava-watch:${watchId}`,
    },
  });
}

/**
 * Stages one user turn in Codex's authoritative durable queue. The active Codex
 * writer consumes it at its own idle boundary; AVA never writes the rollout.
 */
export function stageCodexQueue(input: {
  queueDbPath: string;
  receiptRoot: string;
  watchId: string;
  threadId: string;
  prompt: string;
}): CodexQueueStageResult {
  if (!existsSync(input.queueDbPath)) throw new Error("Codex durable queue database is unavailable");
  const path = receiptPath(input.receiptRoot, input.watchId);
  const safePrompt = scrubSecrets(input.prompt);
  const hash = promptHash(safePrompt);
  const prior = readReceipt(path);
  if (prior) {
    if (prior.threadId !== input.threadId || prior.promptSha256 !== hash) {
      throw new Error("Codex watcher queue receipt conflicts with the requested instruction");
    }
    return { ...prior, existing: true };
  }

  const db = new Database(input.queueDbPath);
  db.pragma("busy_timeout = 5000");
  try {
    validateQueueSchema(db);
    const payload = queuePayload(safePrompt, input.watchId);
    const queueItemId = `ava-watch:${input.watchId}`;
    const stagedAt = new Date().toISOString();
    const nowMs = Date.parse(stagedAt);
    const inserted = db.transaction(() => {
      const existing = db.prepare(
        "SELECT thread_id, payload_json FROM queued_items WHERE id = ?",
      ).get(queueItemId) as { thread_id?: string; payload_json?: string } | undefined;
      if (existing) {
        if (existing.thread_id !== input.threadId || existing.payload_json !== payload) {
          throw new Error("Codex durable queue contains a conflicting watcher item");
        }
        return false;
      }
      const count = db.prepare("SELECT COUNT(*) AS count FROM queued_items WHERE thread_id = ?")
        .get(input.threadId) as { count: number };
      if (Number(count.count) >= MAX_QUEUE_ITEMS) throw new Error("Codex durable queue is full");
      db.prepare(
        `INSERT INTO queued_items (
          id, thread_id, payload_json, queue_order, created_at_ms, updated_at_ms
        ) VALUES (
          @id, @threadId, @payload,
          COALESCE((SELECT MAX(queue_order) FROM queued_items WHERE thread_id = @threadId), -1) + 1,
          @nowMs, @nowMs
        )`,
      ).run({ id: queueItemId, threadId: input.threadId, payload, nowMs });
      return true;
    })();
    const receipt: CodexQueueReceipt = {
      schemaVersion: 1,
      watchId: input.watchId,
      threadId: input.threadId,
      queueItemId,
      promptSha256: hash,
      stagedAt,
    };
    writeReceipt(path, receipt);
    return { ...receipt, existing: !inserted };
  } finally {
    db.close();
  }
}

export function hasCodexQueueReceipt(receiptRoot: string, watchId: string, threadId: string): boolean {
  const receipt = readReceipt(receiptPath(receiptRoot, watchId));
  return Boolean(receipt && receipt.threadId === threadId);
}
