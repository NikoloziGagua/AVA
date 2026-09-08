import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION_PREFIX = "board-v1";
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_LOCK_STALE_MS = 30_000;
const DEFAULT_RETRY_MS = 20;
const MAX_ENTRY_BYTES = 128 * 1024;

export const CANONICAL_BOARD_PATH = fileURLToPath(
  new URL("../coord/BOARD.md", import.meta.url),
);

export class BoardAppendError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BoardAppendError";
    this.code = code;
    this.details = details;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function versionForBytes(bytes) {
  return `${VERSION_PREFIX}:${bytes.length}:${sha256(bytes)}`;
}

export async function readBoardSnapshot(boardPath = CANONICAL_BOARD_PATH) {
  const canonicalPath = await realpath(resolve(boardPath));
  const bytes = await readFile(canonicalPath);
  return {
    canonicalPath,
    byteLength: bytes.length,
    version: versionForBytes(bytes),
  };
}

function dominantEol(bytes) {
  let lf = 0;
  let crlf = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0x0a) continue;
    lf += 1;
    if (i > 0 && bytes[i - 1] === 0x0d) crlf += 1;
  }
  return lf > 0 && crlf * 2 >= lf ? "\r\n" : "\n";
}

function countTrailingEols(bytes, eol) {
  const marker = Buffer.from(eol);
  let count = 0;
  let cursor = bytes.length;
  while (cursor >= marker.length
    && bytes.subarray(cursor - marker.length, cursor).equals(marker)) {
    count += 1;
    cursor -= marker.length;
  }
  return count;
}

function prepareEntry(existing, entry) {
  if (typeof entry !== "string") {
    throw new BoardAppendError("INVALID_ENTRY", "board entry must be UTF-8 text");
  }
  if (entry.includes("\0") || entry.startsWith("\uFEFF")) {
    throw new BoardAppendError("INVALID_ENTRY", "board entry contains a forbidden NUL or BOM");
  }

  const normalized = entry.replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
  if (!normalized.trim()) {
    throw new BoardAppendError("INVALID_ENTRY", "board entry cannot be blank");
  }
  if (!/(?:^|\n)NEEDS:\s*(?:niko|codex|claude|nobody)(?:[^\n]*)$/.test(normalized)) {
    throw new BoardAppendError("INVALID_ENTRY", "board entry must end with a NEEDS handoff line");
  }

  const eol = dominantEol(existing);
  const body = normalized.replace(/\n/g, eol);
  const trailing = countTrailingEols(existing, eol);
  const prefix = existing.length === 0 ? "" : trailing >= 2 ? "" : eol.repeat(2 - trailing);
  const appended = Buffer.from(`${prefix}${body}${eol}`, "utf8");
  if (appended.length > MAX_ENTRY_BYTES) {
    throw new BoardAppendError(
      "ENTRY_TOO_LARGE",
      `board entry exceeds the ${MAX_ENTRY_BYTES}-byte limit`,
      { maxBytes: MAX_ENTRY_BYTES, actualBytes: appended.length },
    );
  }
  return appended;
}

function lockPathFor(boardPath) {
  return resolve(dirname(boardPath), `.${basename(boardPath)}.append.lock`);
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function removeStaleLock(lockPath, staleMs) {
  let firstRaw;
  let firstStat;
  try {
    [firstRaw, firstStat] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
  } catch {
    return false;
  }
  if (Date.now() - firstStat.mtimeMs < staleMs) return false;

  let owner = null;
  try { owner = JSON.parse(firstRaw); } catch { /* malformed old locks are stale */ }
  if (owner?.host && owner.host !== hostname()) return false;
  if (owner?.host === hostname() && processIsAlive(owner.pid)) return false;

  try {
    const [secondRaw, secondStat] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    if (secondRaw !== firstRaw
      || secondStat.size !== firstStat.size
      || secondStat.mtimeMs !== firstStat.mtimeMs) return false;
    await unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function acquireLock(boardPath, options) {
  const lockPath = lockPathFor(boardPath);
  const token = randomUUID();
  const deadline = Date.now() + options.lockTimeoutMs;
  while (true) {
    let handle;
    try {
      handle = await open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, host: hostname(), createdAt: Date.now() }), "utf8");
      await handle.sync();
      return { handle, lockPath, token };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        if (handle) {
          try { await handle.close(); } catch { /* best effort */ }
          try { await unlink(lockPath); } catch { /* best effort */ }
        }
        throw error;
      }
      await removeStaleLock(lockPath, options.lockStaleMs);
      if (Date.now() >= deadline) {
        throw new BoardAppendError(
          "LOCK_TIMEOUT",
          "coordination board is busy; re-read its physical tail and retry",
          { lockTimeoutMs: options.lockTimeoutMs },
        );
      }
      await delay(options.retryMs);
    }
  }
}

async function releaseLock(lock) {
  try { await lock.handle.close(); } catch { /* best effort */ }
  try {
    const raw = await readFile(lock.lockPath, "utf8");
    const owner = JSON.parse(raw);
    if (owner?.token === lock.token) await unlink(lock.lockPath);
  } catch { /* another process already cleaned an expired lock */ }
}

export async function appendBoardEntry({
  boardPath = CANONICAL_BOARD_PATH,
  expectedVersion,
  entry,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  lockStaleMs = DEFAULT_LOCK_STALE_MS,
  retryMs = DEFAULT_RETRY_MS,
}) {
  if (typeof expectedVersion !== "string" || !expectedVersion.startsWith(`${VERSION_PREFIX}:`)) {
    throw new BoardAppendError(
      "EXPECTED_VERSION_REQUIRED",
      "append requires the version returned after re-reading the physical board tail",
    );
  }
  const canonicalPath = await realpath(resolve(boardPath));
  const lock = await acquireLock(canonicalPath, { lockTimeoutMs, lockStaleMs, retryMs });
  try {
    const before = await readFile(canonicalPath);
    const actualVersion = versionForBytes(before);
    if (actualVersion !== expectedVersion) {
      throw new BoardAppendError(
        "STALE_BOARD",
        "coordination board changed after it was read; re-read the physical tail and retry",
        { expectedVersion, actualVersion, actualByteLength: before.length },
      );
    }

    const appendBytes = prepareEntry(before, entry);
    const file = await open(canonicalPath, fsConstants.O_WRONLY | fsConstants.O_APPEND);
    try {
      await file.writeFile(appendBytes);
      await file.sync();
    } finally {
      await file.close();
    }

    const after = await readFile(canonicalPath);
    const expectedAfter = Buffer.concat([before, appendBytes]);
    if (!after.equals(expectedAfter)) {
      throw new BoardAppendError(
        "INTEGRITY_CHECK_FAILED",
        "board changed outside the authoritative append lock; inspect the physical tail before continuing",
        { previousByteLength: before.length, actualByteLength: after.length },
      );
    }
    return {
      previousVersion: actualVersion,
      version: versionForBytes(after),
      previousByteLength: before.length,
      byteLength: after.length,
      appendedByteLength: appendBytes.length,
    };
  } finally {
    await releaseLock(lock);
  }
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function decodeEntryBase64(value) {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new BoardAppendError("INVALID_ENTRY", "--entry-base64 is not valid base64");
  }
  const bytes = Buffer.from(value, "base64");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BoardAppendError("INVALID_ENTRY", "--entry-base64 is not valid UTF-8");
  }
}

async function main(args) {
  const command = args[0];
  if (command === "status") {
    const snapshot = await readBoardSnapshot();
    if (args.includes("--json")) {
      console.log(JSON.stringify(snapshot));
    } else {
      console.log(snapshot.version);
    }
    return;
  }
  if (command !== "append") {
    throw new BoardAppendError("USAGE", "use `status` or `append --expected-version <version>`");
  }
  const expectedVersion = argValue(args, "--expected-version");
  const entryBase64 = argValue(args, "--entry-base64");
  const entryFile = argValue(args, "--entry-file");
  if (entryBase64 && entryFile) {
    throw new BoardAppendError("USAGE", "choose only one of --entry-base64 or --entry-file");
  }
  const entry = entryBase64
    ? decodeEntryBase64(entryBase64)
    : entryFile
      ? await readFile(resolve(entryFile), "utf8")
      : await readStdin();
  console.log(JSON.stringify(await appendBoardEntry({ expectedVersion, entry })));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const code = error instanceof BoardAppendError ? error.code : "UNEXPECTED_ERROR";
    console.error(JSON.stringify({ ok: false, code, message: error?.message ?? String(error), details: error?.details ?? {} }));
    process.exitCode = code === "STALE_BOARD" ? 3 : code === "LOCK_TIMEOUT" ? 4 : 2;
  });
}
