import type { Db } from "../state/db.js";
import {
  dueWatches,
  getChildWatch,
  recordCodexCompleted,
  recordCodexDispatch,
  recordCodexSuccessor,
  recordWatchRun,
  setWatchEnabled,
  type Watch,
} from "../state/watches.js";
import type { CodexDispatchRequest, CodexDispatchResult, CodexThreadSnapshot, CodexWatchTarget } from "./codex-dispatch.js";

// The watch scheduler. Every tick it finds due watches and runs each check as
// a REAL agent turn through the server's own /api/chat — so a check gets the
// full toolset (browser, filesystem, playbook recall, capture) and lands in a
// persistent session Sir can open and audit. The agent ends its reply with a
// strict marker line; TRIGGERED fires a push notification.
//
// Deliberately serial: one check at a time. Watches are background hygiene —
// they must never compete with Sir's live requests for the browser.

export type WatchCheckResult =
  | { kind: "final"; text: string; sessionId: string }
  | { kind: "error"; message: string };

export type SchedulerDeps = {
  db: Db;
  baseUrl: string;                    // http://127.0.0.1:<port>
  token: () => string;                // internal bearer token
  notify: (text: string) => void;     // push notification to Sir's devices
  log: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void };
  /** Injectable check runner (tests fake this; production uses runCheckViaHttp). */
  runCheck?: (w: Watch, deps: SchedulerDeps) => Promise<WatchCheckResult>;
  dispatchCodex?: (request: CodexDispatchRequest) => Promise<CodexDispatchResult>;
  inspectCodex?: (target: CodexWatchTarget, marker?: string | null, dispatchOffset?: number | null) => CodexThreadSnapshot;
  /** Injectable cycle planner. Production asks AVA through its normal tool loop. */
  planNextCodexTask?: (w: Watch, deps: SchedulerDeps) => Promise<WatchCheckResult>;
  tickMs?: number;
  /** Cap on a single check's wall clock. */
  checkTimeoutMs?: number;
};

export function buildCheckPrompt(w: Watch): string {
  return (
    `[SCHEDULED WATCH CHECK — background run, not a live conversation]\n` +
    `Perform this check now, efficiently, without asking questions:\n${w.prompt}\n` +
    `End your reply with EXACTLY one line:\n` +
    `WATCH: TRIGGERED — <one-line reason>  (if the watched condition is met)\n` +
    `WATCH: OK — <one-line current status>  (otherwise)`
  );
}

export function buildCodexCyclePrompt(w: Watch): string {
  return (
    `[CODEX CYCLE PLANNING — Niko explicitly authorized this recurring AVA improvement loop]\n` +
    `Codex completed watcher ${w.id}. Original task:\n${w.prompt}\n\n` +
    `Inspect AVA's current board, recent commits, tests, Mission Control evidence and known failures. ` +
    `Choose exactly one highest-value bounded improvement for AVA. Do not implement it in this planning run. ` +
    `Call watch_create exactly once with kind='codex', interval_minutes=1, once=true, ` +
    `continue_cycle=true, parent_watch_id='${w.id}', and a complete implementation-and-test prompt. ` +
    `Do not choose Forge work. Do not repeat completed work. End by reporting the new watcher ID.`
  );
}

export function parseWatchMarker(finalText: string): { status: "triggered" | "ok" | "unclear"; detail: string } {
  const m = /^WATCH:\s*(TRIGGERED|OK)\s*(?:[—–-]+\s*(.*))?$/im.exec(finalText);
  if (!m) return { status: "unclear", detail: finalText.replace(/\s+/g, " ").slice(0, 200) };
  return {
    status: m[1]!.toUpperCase() === "TRIGGERED" ? "triggered" : "ok",
    detail: (m[2] ?? "").trim() || finalText.replace(/\s+/g, " ").slice(0, 200),
  };
}

/** Production background runner: POST a prompt, then follow SSE to the final. */
export async function runPromptViaHttp(prompt: string, requestedSessionId: string | null, deps: SchedulerDeps): Promise<WatchCheckResult> {
  const timeoutMs = deps.checkTimeoutMs ?? 240_000;
  const auth = { authorization: `Bearer ${deps.token()}` };
  const res = await fetch(`${deps.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(requestedSessionId ? { text: prompt, sessionId: requestedSessionId } : { text: prompt }),
  });
  if (!res.ok) return { kind: "error", message: `POST /api/chat ${res.status}` };
  const { sessionId } = await res.json() as { sessionId: string };

  const stream = await fetch(`${deps.baseUrl}/api/chat/${sessionId}/stream`, {
    headers: { accept: "text/event-stream", ...auth },
  });
  if (!stream.ok || !stream.body) return { kind: "error", message: `stream ${stream.status}` };

  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = "", pendingKind = "", finalText = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) =>
          setTimeout(() => r({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
      ]);
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (line.startsWith("event:")) { pendingKind = line.slice(6).trim(); continue; }
        if (!line.startsWith("data:")) continue;
        let payload: { text?: string; message?: string };
        try { payload = JSON.parse(line.slice(5)); } catch { continue; }
        const kind = pendingKind; pendingKind = "";
        if (kind === "final") finalText = payload.text ?? "";
        if (kind === "error") return { kind: "error", message: payload.message ?? "run error" };
        if (kind === "done") {
          return finalText
            ? { kind: "final", text: finalText, sessionId }
            : { kind: "error", message: "run finished with no final text" };
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* stream may already be closed */ }
  }
  return { kind: "error", message: `check timed out after ${Math.round(timeoutMs / 1000)}s` };
}

/** Production check runner retained as the watch-specific adapter. */
export function runCheckViaHttp(w: Watch, deps: SchedulerDeps): Promise<WatchCheckResult> {
  return runPromptViaHttp(buildCheckPrompt(w), w.session_id, deps);
}

export function planNextCodexTaskViaHttp(w: Watch, deps: SchedulerDeps): Promise<WatchCheckResult> {
  return runPromptViaHttp(buildCodexCyclePrompt(w), null, deps);
}

async function runCodexWatch(w: Watch, deps: SchedulerDeps): Promise<void> {
  if (!deps.dispatchCodex || !deps.inspectCodex) {
    recordWatchRun(deps.db, w.id, { status: "error", result: "Codex watcher dispatcher is unavailable" });
    return;
  }
  if (!w.target_thread_id || !w.target_session_file || !w.target_cwd) {
    recordWatchRun(deps.db, w.id, { status: "error", result: "Codex watcher has no pinned target" });
    setWatchEnabled(deps.db, w.id, false);
    return;
  }
  const target = { threadId: w.target_thread_id, sessionFile: w.target_session_file, cwd: w.target_cwd };

  if (!w.delivered_at) {
    const result = await deps.dispatchCodex({
      watchId: w.id,
      prompt: w.prompt,
      target,
      marker: w.delivery_marker,
      dispatchOffset: w.dispatch_offset,
      dispatchPid: w.dispatch_pid,
      parentWatchId: w.parent_watch_id,
      continueCycle: Boolean(w.continue_cycle),
    });
    if (result.status === "busy") {
      recordWatchRun(deps.db, w.id, { status: "busy", result: result.detail });
      return;
    }
    if (result.status === "error") {
      recordWatchRun(deps.db, w.id, { status: "error", result: result.detail });
      // A persisted dispatch whose process died before its marker appeared can
      // never be retried safely: blindly resuming again could duplicate a
      // consequential task whose session write was merely delayed. Keep the
      // failure evidence, but stop scheduling the same terminal error forever.
      if (!result.retryable) setWatchEnabled(deps.db, w.id, false);
      return;
    }
    recordCodexDispatch(deps.db, w.id, {
      marker: result.marker,
      offset: result.dispatchOffset,
      turnId: "turnId" in result ? result.turnId : null,
      pid: "pid" in result ? result.pid : null,
      delivered: result.status === "delivered" || result.status === "already_delivered",
    });
    if (result.status === "delivered" || result.status === "already_delivered") {
      deps.notify(`Codex received AVA watcher task: ${w.prompt.slice(0, 140)}`);
    }
    return;
  }

  const snapshot = deps.inspectCodex(target, w.delivery_marker, w.dispatch_offset);
  if (!snapshot.markerSeen) {
    // Never redispatch blindly. The stored marker/offset allows a later pass to
    // distinguish delayed session persistence from a genuinely lost process.
    recordWatchRun(deps.db, w.id, { status: "error", result: "delivery evidence disappeared from the pinned Codex thread" });
    return;
  }
  if (!snapshot.markerTurnCompleted) {
    recordWatchRun(deps.db, w.id, { status: "running", result: "Codex accepted the watcher instruction and is still working" });
    return;
  }

  recordCodexCompleted(deps.db, w.id);
  if (!w.continue_cycle) {
    setWatchEnabled(deps.db, w.id, false);
    deps.notify(`Codex completed AVA watcher task: ${w.prompt.slice(0, 140)}`);
    return;
  }

  const existingChild = getChildWatch(deps.db, w.id);
  if (existingChild) {
    recordCodexSuccessor(deps.db, w.id, {
      status: "scheduled",
      result: `AVA scheduled successor watcher ${existingChild.id}`,
    });
    setWatchEnabled(deps.db, w.id, false);
    deps.notify(`AVA scheduled Codex's next task (${existingChild.id}).`);
    return;
  }
  const plan = deps.planNextCodexTask ?? planNextCodexTaskViaHttp;
  recordCodexSuccessor(deps.db, w.id, {
    status: "planning",
    result: "AVA is selecting the next bounded Codex task.",
  });
  let planned: WatchCheckResult;
  try {
    planned = await plan(w, deps);
  } catch (cause) {
    planned = { kind: "error", message: cause instanceof Error ? cause.message : String(cause) };
  }
  if (planned.kind === "error") {
    const detail = `AVA could not select the next Codex task: ${planned.message}`;
    recordCodexSuccessor(deps.db, w.id, { status: "blocked", result: detail });
    if (w.successor_status !== "blocked" || w.successor_result !== detail) {
      deps.notify(`Codex task completed, but successor planning is blocked: ${planned.message.slice(0, 160)}`);
    }
    return;
  }
  const child = getChildWatch(deps.db, w.id);
  if (!child) {
    const detail = "AVA planning finished without creating the required successor watch";
    recordCodexSuccessor(deps.db, w.id, {
      status: "blocked",
      result: detail,
      sessionId: planned.sessionId,
    });
    if (w.successor_status !== "blocked" || w.successor_result !== detail) {
      deps.notify(`Codex task completed, but successor planning is blocked: ${detail}`);
    }
    return;
  }
  recordCodexSuccessor(deps.db, w.id, {
    status: "scheduled",
    result: `AVA scheduled successor watcher ${child.id}`,
    sessionId: planned.sessionId,
  });
  setWatchEnabled(deps.db, w.id, false);
  deps.notify(`AVA selected and scheduled Codex's next task (${child.id}).`);
}

/** One scheduler pass — exported for tests; the interval driver just calls it. */
export async function tickOnce(deps: SchedulerDeps): Promise<void> {
  const due = dueWatches(deps.db);
  const run = deps.runCheck ?? runCheckViaHttp;
  for (const w of due) {
    try {
      if (w.kind === "codex") {
        await runCodexWatch(w, deps);
        continue;
      }
      // Pure reminders skip the agent entirely: the prompt IS the message.
      // Direct push at the due moment — instant and free.
      if (w.kind === "reminder") {
        deps.notify(`Reminder: ${w.prompt.slice(0, 200)}`);
        recordWatchRun(deps.db, w.id, { status: "triggered", result: "reminder delivered" });
        if (w.run_at !== null || w.once) setWatchEnabled(deps.db, w.id, false);
        continue;
      }
      const r = await run(w, deps);
      if (r.kind === "error") {
        recordWatchRun(deps.db, w.id, { status: "error", result: r.message });
        deps.log.warn({ watch: w.id, err: r.message }, "watch check failed");
        // A one-shot must not retry forever on a broken check — one attempt.
        if (w.run_at !== null) setWatchEnabled(deps.db, w.id, false);
        continue;
      }
      const { status, detail } = parseWatchMarker(r.text);
      recordWatchRun(deps.db, w.id, { status, result: detail, sessionId: r.sessionId });
      if (status === "triggered") {
        deps.notify(`Watch triggered: ${detail.slice(0, 180)}`);
        // Interval watches honor `once`; daily briefings (daily_at) recur by
        // design and are exempt from once-disabling.
        if (w.once && !w.daily_at) setWatchEnabled(deps.db, w.id, false);
      }
      // One-shots ran their one shot, whatever the outcome.
      if (w.run_at !== null) setWatchEnabled(deps.db, w.id, false);
    } catch (e) {
      recordWatchRun(deps.db, w.id, { status: "error", result: e instanceof Error ? e.message : String(e) });
      deps.log.warn({ watch: w.id, err: e instanceof Error ? e.message : String(e) }, "watch check crashed");
      if (w.run_at !== null) setWatchEnabled(deps.db, w.id, false);
    }
  }
}

export function startWatchScheduler(deps: SchedulerDeps): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // a slow check must not stack ticks
    running = true;
    try { await tickOnce(deps); } finally { running = false; }
  }, deps.tickMs ?? 60_000);
  timer.unref?.();
  deps.log.info({}, "watch scheduler started");
  return () => clearInterval(timer);
}
