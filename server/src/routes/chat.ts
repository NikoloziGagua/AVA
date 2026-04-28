import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../state/db.js";
import { createSession, getSession, getSessionFull, touchSession, updateTitle } from "../state/sessions.js";
import { appendMessage, listMessages, listMessagesAfterId } from "../state/messages.js";
import { SseBuffer } from "../sse/buffer.js";
import { createSink } from "../sse/stream.js";
import { runAgent, type AgentEvent } from "../orchestrator/agent.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { autoTitle } from "../orchestrator/auto-title.js";
import { maybeSummarize } from "../orchestrator/auto-summary.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import type { Approval } from "../state/approvals.js";

const Body = z.object({
  sessionId: z.string().nullish(),
  text: z.string().min(1).max(10_000),
});

export type AgentDeps = {
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  getChrome: () => Promise<Chrome>;
  pushDeliver?: (a: Approval) => Promise<void>;
  /** Optional override; lets tests substitute a fake agent loop. Defaults to runAgent. */
  runAgentImpl?: typeof runAgent;
};

export type Metered = { anthropic: Anthropic | null };

export function chatRoutes(
  db: Db,
  runs: ActiveRuns,
  auth: RequestHandler,
  agentDeps: AgentDeps,
  metered: Metered,
): Router {
  const r = Router();

  r.post("/", auth, async (req, res) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "bad_request", details: parsed.error.flatten() });
      return;
    }
    let sessionId = parsed.data.sessionId;
    let createdNew = false;
    if (!sessionId || !getSession(db, sessionId)) {
      sessionId = createSession(db, { title: parsed.data.text.slice(0, 60) }).id;
      createdNew = true;
    } else {
      touchSession(db, sessionId);
    }
    appendMessage(db, { sessionId, role: "user", content: parsed.data.text });

    if (createdNew && metered.anthropic) {
      const sid = sessionId;
      const firstMessage = parsed.data.text;
      const client = metered.anthropic;
      void (async () => {
        const title = await autoTitle({ client, firstMessage });
        updateTitle(db, sid, title);
      })();
    }

    if (runs.get(sessionId)) {
      res.status(409).json({ error: "run_in_progress" });
      return;
    }

    const buffer = new SseBuffer({ maxEvents: 500, maxBytes: 5 * 1024 * 1024 });
    const abort = new AbortController();
    runs.register({ sessionId, abort, buffer });

    if (metered.anthropic) {
      await maybeSummarize({ db, sessionId, client: metered.anthropic });
    }

    const full = getSessionFull(db, sessionId);
    const recent = full?.summary_through_message_id
      ? listMessagesAfterId(db, sessionId, full.summary_through_message_id)
      : listMessages(db, sessionId);

    const summaryHeader = full?.summary
      ? `[CONVERSATION SUMMARY OF EARLIER MESSAGES]\n${full.summary}\n\n`
      : "";

    const transcriptForAgent =
      summaryHeader +
      recent.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

    void (async () => {
      const sid = sessionId!;
      const runId = nanoid(12);
      const emit = (e: AgentEvent) => {
        const id = buffer.append({ kind: e.kind, payload: e.payload });
        if (e.kind === "final") {
          appendMessage(db, { sessionId: sid, role: "assistant", content: e.payload.text });
        }
        return id;
      };
      try {
        const impl = agentDeps.runAgentImpl ?? runAgent;
        const chrome = await agentDeps.getChrome();
        await impl({
          prompt: transcriptForAgent,
          abort,
          emit,
          runId,
          db,
          sessionId: sid,
          deps: {
            chrome,
            pidfiles: agentDeps.pidfiles,
            fsRoots: agentDeps.fsRoots,
            pushDeliver: agentDeps.pushDeliver,
            anthropic: metered.anthropic,
          },
        });
      } finally {
        runs.unregister(sid);
      }
    })();

    res.json({ sessionId });
  });

  r.get("/:sessionId/stream", auth, (req, res) => {
    const sessionId = req.params.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const lastEventId = Number(req.headers["last-event-id"] ?? req.query.lastEventId ?? 0);
    const run = runs.get(sessionId);
    if (!run) {
      res.status(404).json({ error: "no_active_run" });
      return;
    }
    const sink = createSink(res);
    const replay = run.buffer.since(lastEventId);
    if (replay.gap && replay.oldestBuffered != null) {
      sink.writeGap(lastEventId + 1, replay.oldestBuffered);
    }
    for (const ev of replay.events) sink.write(ev);

    let lastSeen = replay.events.at(-1)?.id ?? lastEventId;
    const interval = setInterval(() => {
      if (sink.closed) { clearInterval(interval); return; }
      const more = run.buffer.since(lastSeen);
      for (const ev of more.events) sink.write(ev);
      if (more.events.length > 0) lastSeen = more.events.at(-1)!.id;
      if (!runs.get(sessionId)) {
        clearInterval(interval);
        sink.close();
      }
    }, 100);

    req.on("close", () => clearInterval(interval));
  });

  r.post("/:sessionId/kill", auth, (req, res) => {
    const sessionId = req.params.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const ok = runs.abort(sessionId);
    res.json({ aborted: ok });
  });

  return r;
}
