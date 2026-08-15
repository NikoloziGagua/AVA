#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;
const MAX_BYTES = 128 * 1024;
const POLL_MS = 250;
const WAIT_MS = Math.max(0, Math.min(600_000, Number(process.env.AVA_CODEX_WATCH_WAIT_MS ?? 360_000)));
const inboxDir = resolve(process.argv[2] ?? join(process.cwd(), "server", "data", "codex-watch-inbox"));

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function samePath(left, right) {
  return typeof left === "string" && typeof right === "string"
    && resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function readJson(path) {
  try {
    const text = readFileSync(path, "utf8");
    if (text.length > MAX_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeAtomic(path, value) {
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

function activePath(threadId) {
  return join(inboxDir, "active", `${threadId}.json`);
}

function validPending(record, input, parentWatchId = undefined) {
  return record
    && record.schemaVersion === SCHEMA_VERSION
    && safeId(record.watchId)
    && record.threadId === input.session_id
    && samePath(record.cwd, input.cwd)
    && typeof record.prompt === "string"
    && record.prompt.length > 0
    && record.prompt.length <= 64 * 1024
    && (parentWatchId === undefined || record.parentWatchId === parentWatchId);
}

function claimOne(input, parentWatchId = undefined) {
  const pendingDir = join(inboxDir, "pending");
  let names = [];
  try { names = readdirSync(pendingDir).filter((name) => name.endsWith(".json")).sort(); } catch { return null; }
  const candidates = names
    .map((name) => ({ name, record: readJson(join(pendingDir, name)) }))
    .filter(({ record }) => validPending(record, input, parentWatchId))
    .sort((a, b) => (a.record.createdAt ?? 0) - (b.record.createdAt ?? 0) || a.name.localeCompare(b.name));

  for (const candidate of candidates) {
    const from = join(pendingDir, candidate.name);
    const to = join(inboxDir, "claimed", candidate.name);
    mkdirSync(dirname(to), { recursive: true });
    try {
      renameSync(from, to);
      const active = { ...candidate.record, turnId: input.turn_id, claimedAt: Date.now() };
      writeAtomic(activePath(input.session_id), active);
      return active;
    } catch {
      // Another hook invocation claimed it first.
    }
  }
  return null;
}

function completeActive(input, active) {
  const path = join(inboxDir, "completed", `${active.watchId}.json`);
  if (!existsSync(path)) {
    try {
      writeAtomic(path, {
        schemaVersion: SCHEMA_VERSION,
        watchId: active.watchId,
        threadId: input.session_id,
        turnId: input.turn_id,
        completedAt: Date.now(),
      });
    } catch {
      // An idempotent parallel/replayed hook may have won the write.
    }
  }
}

function outputPrompt(record) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason: record.prompt })}\n`);
}

function sleep(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > MAX_BYTES) return;
  }
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (input?.hook_event_name !== "Stop" || !safeId(input.session_id) || !safeId(input.turn_id) || typeof input.cwd !== "string") return;

  const activeFile = activePath(input.session_id);
  const active = readJson(activeFile);
  if (input.stop_hook_active && validPending(active, input) && active.turnId === input.turn_id) {
    completeActive(input, active);
    if (active.continueCycle) {
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        const successor = claimOne(input, active.watchId);
        if (successor) {
          outputPrompt(successor);
          return;
        }
        await sleep(POLL_MS);
      }
    }
    rmSync(activeFile, { force: true });
    return;
  }

  const pending = claimOne(input);
  if (pending) outputPrompt(pending);
}

await main();
