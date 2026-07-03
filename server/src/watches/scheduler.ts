import type { Db } from "../state/db.js";
import { dueWatches, recordWatchRun, setWatchEnabled, type Watch } from "../state/watches.js";

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

export function parseWatchMarker(finalText: string): { status: "triggered" | "ok" | "unclear"; detail: string } {
  const m = /^WATCH:\s*(TRIGGERED|OK)\s*(?:[—–-]+\s*(.*))?$/im.exec(finalText);
  if (!m) return { status: "unclear", detail: finalText.replace(/\s+/g, " ").slice(0, 200) };
  return {
    status: m[1]!.toUpperCase() === "TRIGGERED" ? "triggered" : "ok",
    detail: (m[2] ?? "").trim() || finalText.replace(/\s+/g, " ").slice(0, 200),
  };
}

/** Production check runner: POST the prompt, then follow the SSE stream to the final. */
export async function runCheckViaHttp(w: Watch, deps: SchedulerDeps): Promise<WatchCheckResult> {
  const timeoutMs = deps.checkTimeoutMs ?? 240_000;
  const auth = { authorization: `Bearer ${deps.token()}` };
  const res = await fetch(`${deps.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(w.session_id
      ? { text: buildCheckPrompt(w), sessionId: w.session_id }
      : { text: buildCheckPrompt(w) }),
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

/** One scheduler pass — exported for tests; the interval driver just calls it. */
export async function tickOnce(deps: SchedulerDeps): Promise<void> {
  const due = dueWatches(deps.db);
  const run = deps.runCheck ?? runCheckViaHttp;
  for (const w of due) {
    try {
      const r = await run(w, deps);
      if (r.kind === "error") {
        recordWatchRun(deps.db, w.id, { status: "error", result: r.message });
        deps.log.warn({ watch: w.id, err: r.message }, "watch check failed");
        continue;
      }
      const { status, detail } = parseWatchMarker(r.text);
      recordWatchRun(deps.db, w.id, { status, result: detail, sessionId: r.sessionId });
      if (status === "triggered") {
        deps.notify(`Watch triggered: ${detail.slice(0, 180)}`);
        if (w.once) setWatchEnabled(deps.db, w.id, false);
      }
    } catch (e) {
      recordWatchRun(deps.db, w.id, { status: "error", result: e instanceof Error ? e.message : String(e) });
      deps.log.warn({ watch: w.id, err: e instanceof Error ? e.message : String(e) }, "watch check crashed");
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
