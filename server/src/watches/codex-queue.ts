import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { scrubSecrets } from "../security/scrub.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_RECORD_BYTES = 32 * 1024;

type QueueReceipt = {
  schemaVersion: 1;
  watchId: string;
  threadId: string;
  promptSha256: string;
  transport: "codex-queue-cli";
  state: "accepted" | "uncertain";
  recordedAt: string;
};

type QueueClaim = {
  schemaVersion: 1;
  watchId: string;
  threadId: string;
  promptSha256: string;
  transport: "codex-queue-cli";
  claimedAt: string;
};

export type CodexQueueResult =
  | { status: "accepted" | "already_accepted"; detail: string }
  | { status: "unavailable"; detail: string; retryable: boolean }
  | { status: "ambiguous"; detail: string };

export type RunCodexQueue = (input: {
  command: string;
  cwd: string;
  threadId: string;
  prompt: string;
}) => CodexQueueResult;

function receiptPath(inboxDir: string, watchId: string): string {
  if (!SAFE_ID.test(watchId)) throw new Error("invalid Codex watcher ID");
  return join(inboxDir, "queue-receipts", `${watchId}.json`);
}

function claimPath(inboxDir: string, watchId: string): string {
  if (!SAFE_ID.test(watchId)) throw new Error("invalid Codex watcher ID");
  return join(inboxDir, "queue-claims", `${watchId}.json`);
}

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function readReceipt(path: string): QueueReceipt | null {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length > MAX_RECORD_BYTES) return null;
    return JSON.parse(text) as QueueReceipt;
  } catch {
    return null;
  }
}

function validReceipt(
  receipt: QueueReceipt | null,
  watchId: string,
  threadId: string,
  hash: string,
): receipt is QueueReceipt {
  return Boolean(
    receipt
    && receipt.schemaVersion === 1
    && receipt.watchId === watchId
    && receipt.threadId === threadId
    && receipt.promptSha256 === hash
    && receipt.transport === "codex-queue-cli"
    && (receipt.state === "accepted" || receipt.state === "uncertain"),
  );
}

function validClaim(
  claim: QueueClaim | null,
  watchId: string,
  threadId: string,
  hash: string,
): claim is QueueClaim {
  return Boolean(
    claim
    && claim.schemaVersion === 1
    && claim.watchId === watchId
    && claim.threadId === threadId
    && claim.promptSha256 === hash
    && claim.transport === "codex-queue-cli"
    && typeof claim.claimedAt === "string",
  );
}

function writeExclusive(path: string, value: QueueClaim): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
}

function writeAtomic(path: string, value: QueueReceipt): void {
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

function compactDiagnostic(value: string): string {
  return scrubSecrets(value).replace(/\s+/g, " ").trim().slice(0, 500);
}

export const productionRunCodexQueue: RunCodexQueue = ({ command, cwd, threadId, prompt }) => {
  const result = spawnSync(command, [
    "queue",
    "--thread",
    threadId,
    "--message",
    prompt,
  ], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, CODEX_THREAD_ID: undefined, CODEX_SESSION_ID: undefined },
  });

  if (result.status === 0 && !result.error) {
    return {
      status: "accepted",
      detail: `Codex acknowledged the queued message for exact thread ${threadId}`,
    };
  }

  const diagnostic = compactDiagnostic(
    result.error?.message || result.stderr || result.stdout || `Codex queue exited ${result.status ?? "without status"}`,
  );
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { status: "unavailable", detail: "the installed Codex CLI was not found", retryable: true };
  }
  if (result.signal || result.status === null) {
    return {
      status: "ambiguous",
      detail: `Codex queue did not return an acknowledgement; automatic replay is disabled${diagnostic ? ` (${diagnostic})` : ""}`,
    };
  }
  if (/no rollout found|invalid thread-store request|thread.+not found/i.test(diagnostic)) {
    return { status: "unavailable", detail: diagnostic || "the pinned Codex thread no longer exists", retryable: false };
  }
  if (/unrecognized subcommand|unexpected argument.+queue|usage:.+codex/i.test(diagnostic)) {
    return { status: "unavailable", detail: "this installed Codex CLI does not support exact-thread queue delivery", retryable: true };
  }
  return {
    status: "unavailable",
    detail: diagnostic || `Codex queue exited ${result.status}`,
    retryable: true,
  };
};

/**
 * Queue one sanitized message through Codex's supported exact-thread command.
 * A content-free receipt makes scheduler retries idempotent. An uncertain CLI
 * outcome is also persisted so AVA never risks submitting consequential work
 * twice after a timeout or acknowledgement loss.
 */
export function submitCodexQueueMessage(input: {
  inboxDir: string;
  command: string;
  watchId: string;
  threadId: string;
  cwd: string;
  prompt: string;
  run?: RunCodexQueue;
}): CodexQueueResult {
  if (!SAFE_ID.test(input.watchId)) throw new Error("invalid Codex watcher ID");
  if (!SAFE_ID.test(input.threadId)) throw new Error("invalid pinned Codex thread ID");
  const prompt = scrubSecrets(input.prompt).slice(0, MAX_PROMPT_BYTES);
  if (!prompt.trim()) return { status: "unavailable", detail: "the sanitized watcher message is empty", retryable: false };
  const hash = promptHash(prompt);
  const path = receiptPath(input.inboxDir, input.watchId);
  const claim = claimPath(input.inboxDir, input.watchId);
  const existing = readReceipt(path);
  if (validReceipt(existing, input.watchId, input.threadId, hash)) {
    return existing.state === "accepted"
      ? { status: "already_accepted", detail: "Codex already acknowledged this exact queued message; no duplicate was submitted" }
      : { status: "ambiguous", detail: "a prior Codex queue attempt ended without acknowledgement; automatic replay is disabled" };
  }
  if (existsSync(path)) {
    return { status: "ambiguous", detail: "the Codex queue receipt does not match this exact watcher message; automatic submission is disabled" };
  }

  try {
    writeExclusive(claim, {
      schemaVersion: 1,
      watchId: input.watchId,
      threadId: input.threadId,
      promptSha256: hash,
      transport: "codex-queue-cli",
      claimedAt: new Date().toISOString(),
    });
  } catch {
    // The receipt may have landed between our first read and the exclusive
    // claim attempt. Prefer its authoritative result when that happened.
    const racedReceipt = readReceipt(path);
    if (validReceipt(racedReceipt, input.watchId, input.threadId, hash)) {
      return racedReceipt.state === "accepted"
        ? { status: "already_accepted", detail: "Codex already acknowledged this exact queued message; no duplicate was submitted" }
        : { status: "ambiguous", detail: "a prior Codex queue attempt ended without acknowledgement; automatic replay is disabled" };
    }
    const racedClaim = readReceipt(claim) as QueueClaim | null;
    return validClaim(racedClaim, input.watchId, input.threadId, hash)
      ? { status: "ambiguous", detail: "this exact Codex queue attempt is already in flight or lost its acknowledgement; automatic replay is disabled" }
      : { status: "ambiguous", detail: "the Codex queue claim belongs to different content or could not be verified; automatic submission is disabled" };
  }

  let result: CodexQueueResult;
  try {
    result = (input.run ?? productionRunCodexQueue)({
      command: input.command,
      cwd: input.cwd,
      threadId: input.threadId,
      prompt,
    });
  } catch (error) {
    result = {
      status: "ambiguous",
      detail: `Codex queue threw before AVA received an acknowledgement; automatic replay is disabled (${compactDiagnostic(error instanceof Error ? error.message : String(error))})`,
    };
  }
  if (result.status !== "accepted" && result.status !== "ambiguous") {
    // These failures happened before Codex acknowledged the request, so a
    // later scheduler pass may safely retry.
    rmSync(claim, { force: true });
    return result;
  }

  try {
    writeAtomic(path, {
      schemaVersion: 1,
      watchId: input.watchId,
      threadId: input.threadId,
      promptSha256: hash,
      transport: "codex-queue-cli",
      state: result.status === "accepted" ? "accepted" : "uncertain",
      recordedAt: new Date().toISOString(),
    });
  } catch {
    return {
      status: "ambiguous",
      detail: "Codex may have accepted the queued message, but AVA could not persist its idempotency receipt; automatic replay is disabled",
    };
  }
  rmSync(claim, { force: true });
  return result;
}
