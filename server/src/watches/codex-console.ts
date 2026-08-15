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

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RECORD_BYTES = 128 * 1024;

type HandoffRecord = {
  schemaVersion: 1;
  watchId: string;
  threadId: string;
  cwd: string;
  marker: string;
  prompt: string;
};

type ConsoleReceipt = {
  schemaVersion: 1;
  watchId: string;
  threadId: string;
  promptSha256: string;
  transport: "standalone-tui-console";
  processId: number | null;
  injectedAt: string;
};

export type CodexConsoleInjectionResult =
  | { status: "injected" | "already_injected"; detail: string; processId: number | null }
  | { status: "unavailable"; detail: string }
  | { status: "ambiguous"; detail: string; processId: number | null };

export type RunConsoleInjector = (input: {
  scriptPath: string;
  handoffPath: string;
}) => CodexConsoleInjectionResult;

function recordPath(root: string, state: "pending" | "claimed" | "console-injected", watchId: string): string {
  if (!SAFE_ID.test(watchId)) throw new Error("invalid Codex watcher ID");
  return join(root, state, `${watchId}.json`);
}

function readJson<T>(path: string): T | null {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length > MAX_RECORD_BYTES) return null;
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

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function validHandoff(record: HandoffRecord | null, watchId: string, threadId: string): record is HandoffRecord {
  return Boolean(
    record
    && record.schemaVersion === 1
    && record.watchId === watchId
    && record.threadId === threadId
    && SAFE_ID.test(record.watchId)
    && SAFE_ID.test(record.threadId)
    && typeof record.cwd === "string"
    && typeof record.marker === "string"
    && typeof record.prompt === "string"
    && record.prompt.length > 0,
  );
}

function validReceipt(receipt: ConsoleReceipt | null, watchId: string, threadId: string, hash: string): receipt is ConsoleReceipt {
  return Boolean(
    receipt
    && receipt.schemaVersion === 1
    && receipt.watchId === watchId
    && receipt.threadId === threadId
    && receipt.promptSha256 === hash
    && receipt.transport === "standalone-tui-console",
  );
}

export const productionRunConsoleInjector: RunConsoleInjector = ({ scriptPath, handoffPath }) => {
  if (process.platform !== "win32") {
    return { status: "unavailable", detail: "standalone Codex TUI console delivery is Windows-only" };
  }
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-HandoffPath",
    handoffPath,
  ], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  const output = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  try {
    const parsed = JSON.parse(output) as { status?: string; detail?: string; processId?: number };
    const detail = typeof parsed.detail === "string" ? parsed.detail : "Codex TUI console delivery returned no detail";
    if (parsed.status === "injected" && result.status === 0) {
      return { status: "injected", detail, processId: Number.isInteger(parsed.processId) ? parsed.processId! : null };
    }
    if (parsed.status === "ambiguous") {
      return { status: "ambiguous", detail, processId: Number.isInteger(parsed.processId) ? parsed.processId! : null };
    }
    return { status: "unavailable", detail };
  } catch {
    return {
      status: result.status === 20 ? "ambiguous" : "unavailable",
      detail: result.error?.message || result.stderr.trim() || `Codex TUI console injector exited ${result.status ?? "without status"}`,
      ...(result.status === 20 ? { processId: null } : {}),
    } as CodexConsoleInjectionResult;
  }
};

/**
 * Claims a Stop-hook handoff before writing it into the standalone TUI's own
 * console. A successful, content-free receipt prevents replay. Pre-write
 * failures return the claim to pending so the trusted Stop hook remains a safe
 * fallback; partial writes stay claimed and fail closed as ambiguous.
 */
export function injectCodexConsoleHandoff(input: {
  inboxDir: string;
  scriptPath: string;
  watchId: string;
  threadId: string;
  run?: RunConsoleInjector;
}): CodexConsoleInjectionResult {
  const pending = recordPath(input.inboxDir, "pending", input.watchId);
  const claimed = recordPath(input.inboxDir, "claimed", input.watchId);
  const receiptPath = recordPath(input.inboxDir, "console-injected", input.watchId);
  const pendingRecord = readJson<HandoffRecord>(pending);
  const claimedRecord = readJson<HandoffRecord>(claimed);
  const record = pendingRecord ?? claimedRecord;
  if (!validHandoff(record, input.watchId, input.threadId)) {
    return { status: "unavailable", detail: "no valid staged handoff exists for the pinned Codex thread" };
  }
  const hash = promptHash(record.prompt);
  const receipt = readJson<ConsoleReceipt>(receiptPath);
  if (validReceipt(receipt, input.watchId, input.threadId, hash)) {
    return {
      status: "already_injected",
      detail: "the standalone TUI input handoff is already recorded; no duplicate was sent",
      processId: receipt.processId,
    };
  }
  if (claimedRecord) {
    return {
      status: "ambiguous",
      detail: "the console handoff was previously claimed without a completion receipt; automatic replay is disabled",
      processId: null,
    };
  }

  mkdirSync(dirname(claimed), { recursive: true });
  try {
    renameSync(pending, claimed);
  } catch {
    const racedReceipt = readJson<ConsoleReceipt>(receiptPath);
    if (validReceipt(racedReceipt, input.watchId, input.threadId, hash)) {
      return {
        status: "already_injected",
        detail: "a concurrent console handoff already completed; no duplicate was sent",
        processId: racedReceipt.processId,
      };
    }
    return { status: "ambiguous", detail: "the console handoff claim raced with another consumer; automatic replay is disabled", processId: null };
  }

  const run = input.run ?? productionRunConsoleInjector;
  const result = run({ scriptPath: input.scriptPath, handoffPath: claimed });
  if (result.status === "injected") {
    writeAtomic(receiptPath, {
      schemaVersion: 1,
      watchId: input.watchId,
      threadId: input.threadId,
      promptSha256: hash,
      transport: "standalone-tui-console",
      processId: result.processId,
      injectedAt: new Date().toISOString(),
    } satisfies ConsoleReceipt);
    return result;
  }
  if (result.status === "unavailable") {
    try { renameSync(claimed, pending); } catch { /* preserve the claimed ambiguity instead of overwriting */ }
  }
  return result;
}
