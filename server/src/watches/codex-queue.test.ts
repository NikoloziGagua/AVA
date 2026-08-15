import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasCodexQueueReceipt, stageCodexQueue } from "./codex-queue.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ava-codex-queue-"));
  temps.push(root);
  const queueDbPath = join(root, "queue_1.sqlite");
  const db = new Database(queueDbPath);
  db.exec(`CREATE TABLE queued_items (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    queue_order INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`);
  db.close();
  return { root, queueDbPath, receiptRoot: join(root, "receipts") };
}

describe("Codex durable watcher queue", () => {
  it("stages one typed user turn with a durable, idempotent receipt", () => {
    const f = fixture();
    const input = { queueDbPath: f.queueDbPath, receiptRoot: f.receiptRoot, watchId: "watch-1", threadId: "thread-1", prompt: "[AVA-WATCH:watch-1]\nDo bounded work" };
    const first = stageCodexQueue(input);
    const second = stageCodexQueue(input);
    expect(first).toMatchObject({ existing: false, queueItemId: "ava-watch:watch-1" });
    expect(second).toMatchObject({ existing: true, queueItemId: first.queueItemId });
    expect(hasCodexQueueReceipt(f.receiptRoot, "watch-1", "thread-1")).toBe(true);

    const db = new Database(f.queueDbPath, { readonly: true });
    const rows = db.prepare("SELECT * FROM queued_items").all() as Array<{ payload_json: string }>;
    db.close();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.payload_json)).toEqual({
      UserInput: {
        content: [{ type: "text", text: input.prompt, text_elements: [] }],
        client_id: "ava-watch:watch-1",
      },
    });
  });

  it("keeps consumed queue items idempotent through the receipt", () => {
    const f = fixture();
    const input = { queueDbPath: f.queueDbPath, receiptRoot: f.receiptRoot, watchId: "watch-2", threadId: "thread-2", prompt: "safe task" };
    stageCodexQueue(input);
    const db = new Database(f.queueDbPath);
    db.prepare("DELETE FROM queued_items WHERE id = ?").run("ava-watch:watch-2");
    db.close();
    expect(stageCodexQueue(input)).toMatchObject({ existing: true });
    const verify = new Database(f.queueDbPath, { readonly: true });
    expect(verify.prepare("SELECT COUNT(*) AS count FROM queued_items").get()).toEqual({ count: 0 });
    verify.close();
  });

  it("rejects schema mismatch and conflicting replay", () => {
    const f = fixture();
    const input = { queueDbPath: f.queueDbPath, receiptRoot: f.receiptRoot, watchId: "watch-3", threadId: "thread-3", prompt: "first" };
    stageCodexQueue(input);
    expect(() => stageCodexQueue({ ...input, prompt: "changed" })).toThrow(/conflicts/);

    const brokenRoot = mkdtempSync(join(tmpdir(), "ava-codex-queue-broken-"));
    temps.push(brokenRoot);
    const brokenPath = join(brokenRoot, "queue_1.sqlite");
    const broken = new Database(brokenPath);
    broken.exec("CREATE TABLE queued_items (id TEXT PRIMARY KEY)");
    broken.close();
    expect(() => stageCodexQueue({
      queueDbPath: brokenPath,
      receiptRoot: join(brokenRoot, "receipts"),
      watchId: "watch-4",
      threadId: "thread-4",
      prompt: "task",
    })).toThrow(/incompatible/);
  });

  it("does not put prompt content in the receipt", () => {
    const f = fixture();
    stageCodexQueue({
      queueDbPath: f.queueDbPath,
      receiptRoot: f.receiptRoot,
      watchId: "watch-private",
      threadId: "thread-private",
      prompt: "private task contents",
    });
    const receipt = readFileSync(join(f.receiptRoot, "queued", "watch-private.json"), "utf8");
    expect(receipt).not.toContain("private task contents");
    expect(receipt).toContain("promptSha256");
  });

  it("redacts secrets before they cross into Codex's durable queue", () => {
    const f = fixture();
    const secret = `sk-${"A".repeat(40)}`;
    stageCodexQueue({
      queueDbPath: f.queueDbPath,
      receiptRoot: f.receiptRoot,
      watchId: "watch-redacted",
      threadId: "thread-redacted",
      prompt: `inspect token: ${secret}`,
    });
    const db = new Database(f.queueDbPath, { readonly: true });
    const row = db.prepare("SELECT payload_json FROM queued_items").get() as { payload_json: string };
    db.close();
    expect(row.payload_json).not.toContain(secret);
    expect(row.payload_json).toContain("sk-***");
  });
});
