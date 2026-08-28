import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitCodexQueueMessage, type RunCodexQueue } from "./codex-queue.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture() {
  const inboxDir = mkdtempSync(join(tmpdir(), "ava-codex-queue-"));
  temps.push(inboxDir);
  return {
    inboxDir,
    command: "codex",
    watchId: "probe-1",
    threadId: "019f977d-97dc-7cd1-b2ad-904631196018",
    cwd: "C:/repo/AVA",
    prompt: "[AVA-WATCH:probe-1]\nHarmless delivery probe only.",
  };
}

describe("supported Codex exact-thread queue", () => {
  it("submits once and persists only a content-free idempotency receipt", () => {
    const input = fixture();
    let calls = 0;
    const run: RunCodexQueue = (received) => {
      calls += 1;
      expect(received.threadId).toBe(input.threadId);
      expect(received.prompt).toContain("Harmless delivery probe");
      return { status: "accepted", detail: "acknowledged" };
    };

    expect(submitCodexQueueMessage({ ...input, run })).toEqual({ status: "accepted", detail: "acknowledged" });
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "already_accepted" });
    expect(calls).toBe(1);
    const receipt = readFileSync(join(input.inboxDir, "queue-receipts", "probe-1.json"), "utf8");
    expect(receipt).toContain("promptSha256");
    expect(receipt).not.toContain("Harmless delivery probe");
    expect(existsSync(join(input.inboxDir, "queue-claims", "probe-1.json"))).toBe(false);
  });

  it("does not receipt a definite pre-acceptance failure so a later tick may retry", () => {
    const input = fixture();
    let calls = 0;
    const run: RunCodexQueue = () => {
      calls += 1;
      return { status: "unavailable", detail: "daemon starting", retryable: true };
    };
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "unavailable", retryable: true });
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "unavailable", retryable: true });
    expect(calls).toBe(2);
    expect(existsSync(join(input.inboxDir, "queue-claims", "probe-1.json"))).toBe(false);
  });

  it("fails closed after an uncertain acknowledgement and never submits again", () => {
    const input = fixture();
    let calls = 0;
    const run: RunCodexQueue = () => {
      calls += 1;
      return { status: "ambiguous", detail: "timed out after write" };
    };
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "ambiguous" });
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "ambiguous" });
    expect(calls).toBe(1);
  });

  it("sanitizes the message before it reaches Codex and the receipt", () => {
    const input = { ...fixture(), prompt: "[AVA-WATCH:probe-1] sk-live-1234567890abcdefghijklmnop" };
    let queued = "";
    const run: RunCodexQueue = ({ prompt }) => {
      queued = prompt;
      return { status: "accepted", detail: "acknowledged" };
    };
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "accepted" });
    expect(queued).not.toContain("sk-live-");
    const receipt = readFileSync(join(input.inboxDir, "queue-receipts", "probe-1.json"), "utf8");
    expect(receipt).not.toContain("sk-live-");
  });

  it("rejects a receipt replayed for a different exact thread", () => {
    const input = fixture();
    const run: RunCodexQueue = () => ({ status: "accepted", detail: "acknowledged" });
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "accepted" });
    expect(submitCodexQueueMessage({ ...input, threadId: "another-thread", run })).toMatchObject({ status: "ambiguous" });
  });

  it("fails closed on an orphaned or concurrent claim instead of submitting twice", () => {
    const input = fixture();
    const claimDir = join(input.inboxDir, "queue-claims");
    mkdirSync(claimDir, { recursive: true });
    writeFileSync(join(claimDir, "probe-1.json"), JSON.stringify({
      schemaVersion: 1,
      watchId: input.watchId,
      threadId: input.threadId,
      promptSha256: createHash("sha256").update(input.prompt, "utf8").digest("hex"),
      transport: "codex-queue-cli",
      claimedAt: new Date().toISOString(),
    }));
    let calls = 0;
    const result = submitCodexQueueMessage({
      ...input,
      run: () => {
        calls += 1;
        return { status: "accepted", detail: "should not run" };
      },
    });
    expect(result).toMatchObject({ status: "ambiguous" });
    expect(result.detail).toContain("already in flight");
    expect(calls).toBe(0);
  });

  it("persists an uncertain receipt when the queue runner throws", () => {
    const input = fixture();
    let calls = 0;
    const run: RunCodexQueue = () => {
      calls += 1;
      throw new Error("transport dropped after write");
    };
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "ambiguous" });
    expect(submitCodexQueueMessage({ ...input, run })).toMatchObject({ status: "ambiguous" });
    expect(calls).toBe(1);
  });
});
