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
import { classifyIntent } from "../orchestrator/intent-classifier.js";
import { decideGreeting } from "../orchestrator/greeting.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { autoTitle } from "../orchestrator/auto-title.js";
import { maybeSummarize } from "../orchestrator/auto-summary.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import type { Approval } from "../state/approvals.js";
import type { LLMProvider, Message as LLMMessage } from "../orchestrator/llm/types.js";
import { buildShellTool } from "../tools/shell-tool.js";
import { buildFilesystem } from "../tools/filesystem.js";
import { buildFilesystemTools } from "../tools/filesystem-mcp.js";
import { buildClaudeCode } from "../tools/claude-code.js";
import { buildClaudeCodeTool } from "../tools/claude-code-mcp.js";
import { buildChromeTools } from "../tools/chrome-mcp.js";
import { buildComputerUseTool } from "../tools/computer-use-mcp.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { buildMemoryTools } from "../tools/memory-mcp.js";

const Body = z.object({
  sessionId: z.string().nullish(),
  text: z.string().min(1).max(10_000),
});

export type AgentDeps = {
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  memoryDir: string;
  getChrome: () => Promise<Chrome>;
  pushDeliver?: (a: Approval) => Promise<void>;
  provider: LLMProvider | null;
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
    if (!agentDeps.provider) {
      res.status(503).json({ error: "no_llm_provider" });
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

    if (createdNew && agentDeps.provider) {
      const sid = sessionId;
      const firstMessage = parsed.data.text;
      const provider = agentDeps.provider;
      void (async () => {
        try {
          const title = await autoTitle({ provider, firstMessage });
          updateTitle(db, sid, title);
        } catch { /* fire-and-forget; title generation is non-critical */ }
      })();
    }

    if (runs.get(sessionId)) {
      res.status(409).json({ error: "run_in_progress" });
      return;
    }

    if (agentDeps.provider) {
      await maybeSummarize({ db, sessionId, provider: agentDeps.provider });
    }

    const buffer = new SseBuffer({ maxEvents: 500, maxBytes: 5 * 1024 * 1024 });
    const abort = new AbortController();
    runs.register({ sessionId, abort, buffer });

    const full = getSessionFull(db, sessionId);
    const recent = full?.summary_through_message_id
      ? listMessagesAfterId(db, sessionId, full.summary_through_message_id)
      : listMessages(db, sessionId);

    const summaryHeader = full?.summary
      ? `[CONVERSATION SUMMARY OF EARLIER MESSAGES]\n${full.summary}\n\n`
      : "";

    const greeting = decideGreeting({ db, deviceId: req.deviceId, sessionId });

    // Split history: everything except the just-appended user turn becomes the
    // cacheable prefix; the latest turn carries the (rare) greeting/summary
    // prefix and is sent as the final user message.
    const priorRows = recent.slice(0, -1);
    const latestRow = recent.at(-1);
    const priorMessages: LLMMessage[] = priorRows
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    const latestUserText = latestRow?.content ?? parsed.data.text;
    const promptForAgent = greeting.prefix + summaryHeader + latestUserText;

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
        const provider = agentDeps.provider!;  // null-check happened earlier (503)
        // The agent loop emits tool_call/tool_result centrally via the ToolRegistry,
        // so we pass noop emits to legacy builders. Phase 2 cleanup removes
        // the `emit` parameters from these builders entirely.
        const noop = () => {};
        const fs = buildFilesystem({ roots: agentDeps.fsRoots });
        const cc = buildClaudeCode({
          pidfiles: agentDeps.pidfiles,
          check: buildPathAllowlist({ roots: agentDeps.fsRoots }),
        });
        const memoryTools = buildMemoryTools({ memoryDir: agentDeps.memoryDir });
        const tools: ToolDef[] = [
          buildShellTool({ signal: abort.signal }),
          ...(buildFilesystemTools({ fs, emit: noop }) as ToolDef[]),
          buildClaudeCodeTool({ cc, emit: noop }) as ToolDef,
          ...(buildChromeTools({ chrome, emit: noop }) as ToolDef[]),
          // TODO(M4 Phase 4): replace with OpenAI computer_use_preview when provider is openai.
          buildComputerUseTool({
            client: provider.name === "anthropic" ? metered.anthropic : null,
            chrome,
            emit: noop,
          }) as ToolDef,
          ...memoryTools,
        ];
        await impl({
          prompt: promptForAgent,
          priorMessages,
          abort,
          emit,
          runId,
          db,
          sessionId: sid,
          mode: classifyIntent(parsed.data.text),
          deps: {
            chrome,
            pidfiles: agentDeps.pidfiles,
            fsRoots: agentDeps.fsRoots,
            memoryDir: agentDeps.memoryDir,
            pushDeliver: agentDeps.pushDeliver,
            provider,
            tools,
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
