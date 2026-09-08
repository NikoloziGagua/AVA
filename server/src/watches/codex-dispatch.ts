import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import {
  hasCodexHandoff,
  readCodexHandoffCompletion,
  stageCodexHandoff,
  watchIdFromMarker,
} from "./codex-handoff.js";
import {
  submitCodexQueueMessage,
  type CodexQueueResult,
} from "./codex-queue.js";

export type CodexWatchTarget = {
  threadId: string;
  sessionFile: string;
  cwd: string;
};

export type CodexThreadSnapshot = {
  state: "idle" | "busy" | "unknown";
  markerSeen: boolean;
  markerTurnCompleted: boolean;
  turnId: string | null;
  fileSize: number;
  reason: string;
};

export type CodexDispatchRequest = {
  watchId: string;
  prompt: string;
  target: CodexWatchTarget;
  marker?: string | null;
  dispatchOffset?: number | null;
  dispatchPid?: number | null;
  parentWatchId?: string | null;
  continueCycle?: boolean;
};

export type CodexDispatchResult =
  | { status: "busy"; detail: string }
  | { status: "delivered"; detail: string; marker: string; turnId: string | null; dispatchOffset: number; pid: number | null }
  | { status: "already_delivered"; detail: string; marker: string; turnId: string | null; dispatchOffset: number }
  | { status: "pending"; detail: string; marker: string; dispatchOffset: number; pid: number | null }
  | { status: "error"; detail: string; retryable: boolean };

type SpawnCodex = (input: {
  command: string;
  args: string[];
  cwd: string;
  prompt: string;
  logFile: string;
}) => { pid: number | null };

type IsProcessRunning = (pid: number) => boolean;
type SubmitCodexQueue = (input: {
  inboxDir: string;
  command: string;
  watchId: string;
  threadId: string;
  cwd: string;
  prompt: string;
}) => CodexQueueResult;

export type CodexDispatcher = {
  resolveTarget: () => CodexWatchTarget | null;
  inspect: (target: CodexWatchTarget, marker?: string | null, dispatchOffset?: number | null) => CodexThreadSnapshot;
  dispatch: (request: CodexDispatchRequest) => Promise<CodexDispatchResult>;
};

type SessionMeta = {
  session_id?: string;
  id?: string;
  cwd?: string;
  originator?: string;
};

const MARKER_PREFIX = "AVA-WATCH";
const DEFAULT_VERIFY_MS = 20_000;
const TAIL_BYTES = 4 * 1024 * 1024;

function samePath(a: string, b: string): boolean {
  return normalize(resolve(a)).toLowerCase() === normalize(resolve(b)).toLowerCase();
}

function readRange(path: string, start: number): { text: string; fileSize: number } {
  const fileSize = statSync(path).size;
  const safeStart = Math.max(0, Math.min(start, fileSize));
  const length = fileSize - safeStart;
  if (length === 0) return { text: "", fileSize };
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, safeStart);
  } finally {
    closeSync(fd);
  }
  return { text: buffer.toString("utf8"), fileSize };
}

function readSessionMeta(path: string): SessionMeta | null {
  try {
    const fd = openSync(path, "r");
    const buffer = Buffer.alloc(256 * 1024);
    let bytes = 0;
    try { bytes = readSync(fd, buffer, 0, buffer.length, 0); } finally { closeSync(fd); }
    const first = buffer.subarray(0, bytes).toString("utf8").split(/\r?\n/, 1)[0];
    if (!first) return null;
    const parsed = JSON.parse(first) as { type?: string; payload?: SessionMeta };
    return parsed.type === "session_meta" ? parsed.payload ?? null : null;
  } catch {
    return null;
  }
}

function sessionFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  walk(root);
  return files;
}

export function resolveLatestCodexTarget(
  cwd: string,
  codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
): CodexWatchTarget | null {
  const candidates = sessionFiles(join(codexHome, "sessions"))
    .map((sessionFile) => ({ sessionFile, meta: readSessionMeta(sessionFile) }))
    .filter((entry): entry is { sessionFile: string; meta: SessionMeta } => Boolean(entry.meta))
    .filter(({ meta }) => Boolean(meta.cwd) && samePath(meta.cwd!, cwd))
    // A resumed task stays in its original TUI session. Exclude Strategy Room
    // and other standalone exec sessions when initially pinning the target.
    .filter(({ meta }) => !meta.originator || meta.originator === "codex-tui")
    .sort((a, b) => statSync(b.sessionFile).mtimeMs - statSync(a.sessionFile).mtimeMs);
  const selected = candidates[0];
  if (!selected) return null;
  const threadId = selected.meta.session_id ?? selected.meta.id;
  if (!threadId || !selected.meta.cwd) return null;
  return { threadId, sessionFile: selected.sessionFile, cwd: selected.meta.cwd };
}

function payloadContainsDeliveryMarker(record: unknown, marker: string): boolean {
  if (!record || typeof record !== "object") return false;
  const envelope = record as {
    type?: string;
    payload?: { type?: string; role?: string; content?: Array<{ type?: string; text?: string }> };
  };
  const payload = envelope.payload;
  // Legacy/resumed delivery is a genuine Codex user_message event. Keep that
  // supported for sessions without the active-writer handoff.
  if (envelope.type === "event_msg" && payload?.type === "user_message") {
    try { return JSON.stringify(payload).includes(marker); } catch { return false; }
  }
  if (envelope.type !== "response_item") return false;
  if (payload?.type !== "message" || payload.role !== "user" || !Array.isArray(payload.content)) return false;
  return payload.content.some((item) =>
    item?.type === "input_text"
    && typeof item.text === "string"
    && /<hook_prompt\b[^>]*\bhook_run_id=(?:"[^"]+"|'[^']+')[^>]*>/i.test(item.text)
    && item.text.includes(marker),
  );
}

export function inspectCodexThread(
  target: CodexWatchTarget,
  marker?: string | null,
  dispatchOffset?: number | null,
): CodexThreadSnapshot {
  if (!existsSync(target.sessionFile)) {
    return { state: "unknown", markerSeen: false, markerTurnCompleted: false, turnId: null, fileSize: 0, reason: "pinned Codex session file is missing" };
  }
  const meta = readSessionMeta(target.sessionFile);
  const metaId = meta?.session_id ?? meta?.id;
  if (!meta || metaId !== target.threadId || !meta.cwd || !samePath(meta.cwd, target.cwd)) {
    return { state: "unknown", markerSeen: false, markerTurnCompleted: false, turnId: null, fileSize: statSync(target.sessionFile).size, reason: "pinned Codex session identity no longer matches" };
  }

  const fileSize = statSync(target.sessionFile).size;
  const tailStart = Math.max(0, fileSize - TAIL_BYTES);
  const tail = readRange(target.sessionFile, tailStart).text;
  let lastLifecycle: "started" | "complete" | null = null;
  for (const line of tail.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { type?: string; payload?: { type?: string } };
      if (record.type !== "event_msg") continue;
      if (record.payload?.type === "task_started") lastLifecycle = "started";
      if (record.payload?.type === "task_complete") lastLifecycle = "complete";
    } catch { /* a partial first tail line is expected */ }
  }

  let markerSeen = false;
  let markerTurnCompleted = false;
  let turnId: string | null = null;
  if (marker) {
    const start = Math.max(0, (dispatchOffset ?? 0) - 4);
    const records = readRange(target.sessionFile, start).text.split(/\r?\n/);
    let markerIndex = -1;
    for (let index = 0; index < records.length; index += 1) {
      const line = records[index]!;
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { type?: string; payload?: { type?: string; turn_id?: string } };
        const payload = record.payload;
        if (payload?.type === "task_started" && markerIndex < 0) turnId = payload.turn_id ?? turnId;
        // A Stop-hook continuation is persisted as a typed hook-prompt response
        // item, not a user_message. Require that semantic envelope: arbitrary
        // diagnostic/tool text may echo the marker and is not delivery evidence.
        if (payloadContainsDeliveryMarker(record, marker)) {
          markerSeen = true;
          markerIndex = index;
        }
        if (markerIndex >= 0 && index > markerIndex && payload?.type === "task_complete") {
          markerTurnCompleted = true;
          turnId = payload.turn_id ?? turnId;
        }
      } catch { /* ignore incomplete/unrelated lines */ }
    }
  }

  const state = lastLifecycle === "started" ? "busy" : lastLifecycle === "complete" ? "idle" : "unknown";
  return {
    state,
    markerSeen,
    markerTurnCompleted,
    turnId,
    fileSize,
    reason: state === "busy" ? "the pinned Codex thread has an unfinished task" : state === "idle" ? "the pinned Codex thread is at a completed task boundary" : "no reliable Codex task boundary was found",
  };
}

function defaultCodexCommand(): string {
  const installed = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", "codex.exe")
    : "";
  return installed && existsSync(installed) ? installed : "codex";
}

function productionSpawn(input: Parameters<SpawnCodex>[0]): { pid: number | null } {
  mkdirSync(dirname(input.logFile), { recursive: true });
  const outputFd = openSync(input.logFile, "a");
  try {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      detached: true,
      windowsHide: true,
      stdio: ["pipe", outputFd, outputFd],
      env: { ...process.env, CODEX_THREAD_ID: undefined },
    });
    // Spawn failures arrive asynchronously on Windows. They are surfaced on
    // the next scheduler pass through the persisted PID/evidence check rather
    // than becoming an unhandled EventEmitter error in AVA's server.
    child.on("error", () => {});
    child.stdin?.on("error", () => {});
    child.stdin!.end(input.prompt);
    child.unref();
    return { pid: child.pid ?? null };
  } finally {
    closeSync(outputFd);
  }
}

function productionIsProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function buildCodexDispatcher(options: {
  repoRoot: string;
  logsDir: string;
  codexHome?: string;
  codexCommand?: string;
  verifyMs?: number;
  pollMs?: number;
  spawnCodex?: SpawnCodex;
  isProcessRunning?: IsProcessRunning;
  /** Durable queue receipts plus an older-Codex in-writer Stop-hook fallback. */
  handoffDir?: string | null;
  submitQueue?: SubmitCodexQueue;
}): CodexDispatcher {
  const spawnCodex = options.spawnCodex ?? productionSpawn;
  const verifyMs = options.verifyMs ?? DEFAULT_VERIFY_MS;
  const pollMs = options.pollMs ?? 250;
  const command = options.codexCommand ?? defaultCodexCommand();
  const isProcessRunning = options.isProcessRunning ?? productionIsProcessRunning;
  const submitQueue = options.submitQueue ?? submitCodexQueueMessage;
  const resolveTarget = () => resolveLatestCodexTarget(options.repoRoot, options.codexHome);
  const inspect = (target: CodexWatchTarget, marker?: string | null, offset?: number | null) => {
    const snapshot = inspectCodexThread(target, marker, offset);
    const watchId = watchIdFromMarker(marker);
    const completion = options.handoffDir && watchId
      ? readCodexHandoffCompletion(options.handoffDir, watchId)
      : null;
    if (!completion || completion.threadId !== target.threadId) return snapshot;
    return {
      ...snapshot,
      markerSeen: true,
      markerTurnCompleted: true,
      turnId: completion.turnId || snapshot.turnId,
      reason: "the in-thread Codex handoff reached a Stop-hook task boundary",
    };
  };

  return {
    resolveTarget,
    inspect,
    async dispatch(request) {
      const marker = request.marker?.trim() || `[${MARKER_PREFIX}:${request.watchId}]`;
      const before = inspect(request.target, marker, request.dispatchOffset);
      if (before.markerSeen) {
        return {
          status: "already_delivered",
          detail: before.markerTurnCompleted ? "the pinned Codex thread already completed this watcher instruction" : "the pinned Codex thread already contains this watcher instruction",
          marker,
          turnId: before.turnId,
          dispatchOffset: request.dispatchOffset ?? before.fileSize,
        };
      }
      if (options.handoffDir) {
        // Preserve the legacy dispatch ambiguity boundary. A watch that already
        // launched an external resume cannot be silently restaged through the
        // hook because the old process may have performed work before losing
        // its rollout evidence.
        if (request.marker && request.dispatchPid != null && !hasCodexHandoff(options.handoffDir, request.watchId)) {
          return request.dispatchPid && isProcessRunning(request.dispatchPid)
            ? {
                status: "pending",
                detail: "the legacy Codex delivery process is still running; no hook duplicate was staged",
                marker,
                dispatchOffset: request.dispatchOffset ?? before.fileSize,
                pid: request.dispatchPid,
              }
            : {
                status: "error",
                detail: "the legacy Codex delivery process ended before the instruction appeared; no hook duplicate was staged",
                retryable: false,
              };
        }
        if (request.marker && hasCodexHandoff(options.handoffDir, request.watchId)) {
          return {
            status: "pending",
            detail: "the instruction is staged for the pinned Codex thread's next clean task boundary",
            marker,
            dispatchOffset: request.dispatchOffset ?? before.fileSize,
            pid: null,
          };
        }
        if (before.state === "unknown") return { status: "error", detail: before.reason, retryable: true };

        const dispatchOffset = request.dispatchOffset ?? before.fileSize;
        const prompt = formatCodexWatchPrompt(marker, request.prompt);
        const queued = submitQueue({
          inboxDir: options.handoffDir,
          command,
          watchId: request.watchId,
          threadId: request.target.threadId,
          cwd: request.target.cwd,
          prompt,
        });
        if (queued.status === "accepted" || queued.status === "already_accepted") {
          return {
            status: "pending",
            detail: queued.status === "accepted"
              ? "Codex acknowledged the exact-thread queued message; awaiting its rollout marker"
              : queued.detail,
            marker,
            dispatchOffset,
            pid: null,
          };
        }
        if (queued.status === "ambiguous") {
          return { status: "error", detail: queued.detail, retryable: false };
        }
        if (queued.status !== "unavailable") {
          return { status: "error", detail: "Codex queue returned an unsupported acknowledgement state", retryable: false };
        }
        if (!queued.retryable) {
          return { status: "error", detail: queued.detail, retryable: false };
        }
        // Older Codex clients have no exact-thread queue. If the pinned writer
        // is currently busy, its already-trusted Stop hook can still inject at
        // the authoritative clean boundary. An idle thread has no future Stop
        // event, so report the unsupported wake path honestly and retry later.
        if (before.state !== "busy") {
          return {
            status: "error",
            detail: `${queued.detail}; the idle pinned thread cannot be woken through the Stop-hook fallback`,
            retryable: true,
          };
        }
        try {
          const staged = stageCodexHandoff(options.handoffDir, {
            watchId: request.watchId,
            parentWatchId: request.parentWatchId ?? null,
            threadId: request.target.threadId,
            cwd: request.target.cwd,
            marker,
            dispatchOffset,
            continueCycle: request.continueCycle === true,
            prompt,
          });
          return {
            status: "pending",
            detail: staged.existing
              ? "the existing in-thread Codex handoff remains staged; no duplicate was created"
              : "exact-thread queue was unavailable; instruction staged for the current Codex turn's trusted Stop-hook boundary",
            marker,
            dispatchOffset,
            pid: null,
          };
        } catch (error) {
          return {
            status: "error",
            detail: error instanceof Error ? error.message : String(error),
            retryable: true,
          };
        }
      }
      // A prior spawn has already been recorded but its JSONL user-message has
      // not become visible yet. Never launch a second writer into the same TUI
      // thread: report pending while it lives, or a visible failure if it died.
      if (request.marker && request.dispatchOffset != null) {
        if (request.dispatchPid && isProcessRunning(request.dispatchPid)) {
          return {
            status: "pending",
            detail: "the existing Codex delivery process is still starting; no duplicate was launched",
            marker,
            dispatchOffset: request.dispatchOffset,
            pid: request.dispatchPid,
          };
        }
        return {
          status: "error",
          detail: "the Codex delivery process ended before the instruction appeared; no duplicate was launched",
          retryable: false,
        };
      }
      if (before.state === "busy") return { status: "busy", detail: before.reason };
      if (before.state !== "idle") return { status: "error", detail: before.reason, retryable: true };

      const dispatchOffset = before.fileSize;
      const prompt = formatCodexWatchPrompt(marker, request.prompt);
      let spawned: { pid: number | null };
      try {
        spawned = spawnCodex({
          command,
          args: ["-a", "never", "-s", "danger-full-access", "exec", "resume", "--json", request.target.threadId, "-"],
          cwd: request.target.cwd,
          prompt,
          logFile: join(options.logsDir, `codex-watch-${request.watchId}.jsonl`),
        });
      } catch (error) {
        return {
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
      }

      const deadline = Date.now() + verifyMs;
      while (Date.now() < deadline) {
        const snapshot = inspect(request.target, marker, dispatchOffset);
        if (snapshot.markerSeen) {
          return {
            status: "delivered",
            detail: `instruction appeared in pinned Codex thread ${request.target.threadId}`,
            marker,
            turnId: snapshot.turnId,
            dispatchOffset,
            pid: spawned.pid,
          };
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
      }
      return {
        status: "pending",
        detail: "Codex process started but the instruction has not appeared in the pinned thread yet",
        marker,
        dispatchOffset,
        pid: spawned.pid,
      };
    },
  };
}

export function formatCodexWatchPrompt(marker: string, prompt: string): string {
  return (
    `${marker}\n` +
    `AVA delivered this scheduled instruction into the pinned Codex session. Treat it as Niko-authorized AVA repository work.\n\n` +
    `${prompt.trim()}\n\n` +
    `Do not ask Niko routine questions. Implement, test, commit, and keep coord/BOARD.md current. ` +
    `When complete, leave the thread at a clean task boundary so AVA can select the next instruction.`
  );
}
