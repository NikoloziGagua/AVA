import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
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
import { buildSelfImproveTool } from "../tools/self-improve-mcp.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { buildMemoryTools } from "../tools/memory-mcp.js";
import { getReasoningLevel } from "../state/reasoning-pref.js";
import { mapReasoning } from "../orchestrator/reasoning.js";
import { detectCorrection, formatCorrection } from "../orchestrator/correction-detector.js";
import { rememberObservation } from "../memory/remember.js";
import { maybeCapture } from "../playbooks/capture.js";
import { matchPlaybook } from "../playbooks/match.js";
import { loadPlaybookIndex, readPlaybook } from "../playbooks/store.js";
import { bumpUse } from "../playbooks/mutate.js";
import type { RunStep } from "../playbooks/distill.js";

const Body = z.object({
  sessionId: z.string().nullish(),
  text: z.string().min(1).max(10_000),
});

// Upper bound on how long pre-run playbook recall may block a turn. Recall is a
// best-effort optimization; past this it is skipped and the agent runs without
// the playbook hint. Normal side-model matches return in ~1-2s.
const PLAYBOOK_MATCH_TIMEOUT_MS = 8_000;

export type AgentDeps = {
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  memoryDir: string;
  getChrome: () => Promise<Chrome>;
  pushDeliver?: (a: Approval) => Promise<void>;
  provider: LLMProvider | null;
  queueSelfImprove?: (goal: string) => string;
  /** Optional override; lets tests substitute a fake agent loop. Defaults to runAgent. */
  runAgentImpl?: typeof runAgent;
};

export type Metered = { anthropic: Anthropic | null; openai: OpenAI | null };

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
    // Auto-learn from corrections: if the user is pushing back on the previous
    // assistant turn within 5 minutes, capture it as a low-confidence preference
    // observation. Fire-and-forget; never blocks dispatch.
    {
      const prior = listMessages(db, sessionId).at(-1);
      const corrected = detectCorrection({
        userText: parsed.data.text,
        priorRole: (prior?.role ?? null) as "user" | "assistant" | "system" | null,
        priorAtMs: prior?.created_at ?? null,
        nowMs: Date.now(),
      });
      if (corrected) {
        const priorAssistant = prior?.role === "assistant" ? prior.content : "";
        const text = formatCorrection({ priorAssistant, userText: parsed.data.text });
        void Promise.resolve().then(() => {
          rememberObservation({
            memoryDir: agentDeps.memoryDir,
            category: "preferences",
            confidence: "low",
            text,
            today: new Date().toISOString().slice(0, 10),
          });
        }).catch(() => {});
      }
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
    // Default to "action" mode so every chat turn has the full tool stack
    // (chrome / shell / filesystem / memory). The intent classifier was too
    // conservative — casual "look up X on Google" stayed in conversation
    // mode where chrome isn't available, so Ava reported "I can't access
    // Google" even though the agent could in principle handle it.
    // Override via FORCE_INTENT=conversation env var if you want the old
    // chitchat-fast path back.
    const intent = classifyIntent(parsed.data.text);
    const mode: "conversation" | "action" =
      process.env.FORCE_INTENT === "conversation" ? "conversation" : "action";
    void intent; // kept for telemetry/future tuning

    // Recall: in action mode with saved playbooks, ask the side model to match
    // this request to a known playbook and inject its steps + a stakes rubric.
    // Chitchat (conversation mode) and a first-ever empty index never pay for it.
    //
    // Recall is a best-effort OPTIMIZATION: it must never break or stall a turn.
    // The match is wrapped in try/catch and bounded by a timeout so a slow or
    // failing side-model call (e.g. an LLM request timeout) degrades to "no
    // playbook injected" and the agent still runs.
    let playbookPrefix = "";
    if (mode === "action" && agentDeps.provider) {
      try {
        const index = loadPlaybookIndex(agentDeps.memoryDir);
        if (index.length) {
          const matchAbort = new AbortController();
          const timer = setTimeout(() => matchAbort.abort(), PLAYBOOK_MATCH_TIMEOUT_MS);
          let slug: string | null;
          try {
            slug = await matchPlaybook({
              prompt: parsed.data.text, index, provider: agentDeps.provider, abort: matchAbort.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (slug) {
            const pb = readPlaybook(agentDeps.memoryDir, slug);
            if (pb) {
              bumpUse(agentDeps.memoryDir, slug, new Date().toISOString().slice(0, 10));
              const rubric = pb.stakes === "consequential"
                ? "This is a known consequential task — follow these steps efficiently, but verify the result before reporting done."
                : "This is a known routine task — follow these steps efficiently; no recheck needed.";
              playbookPrefix = `[PLAYBOOK — ${pb.slug}]\n${rubric}\n${pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`;
            }
          }
        }
      } catch (err) {
        console.warn("[playbooks] recall match skipped:", err instanceof Error ? err.message : err);
      }
    }

    const promptForAgent = greeting.prefix + summaryHeader + playbookPrefix + latestUserText;
    const reasoningEffort = agentDeps.provider!.name === "openai"
      ? mapReasoning(getReasoningLevel(db), mode)
      : undefined;

    void (async () => {
      const sid = sessionId!;
      const runId = nanoid(12);
      // Collect the run's tool steps so a successful >=2-tool run can be
      // distilled into a reusable playbook (best-effort, fire-and-forget).
      const runSteps: RunStep[] = [];
      const emit = (e: AgentEvent) => {
        if (e.kind === "tool_call") {
          runSteps.push({ tool: e.payload.tool, args: e.payload.args, ok: true });
        } else if (e.kind === "tool_result") {
          const s = runSteps[runSteps.length - 1];
          if (s && s.tool === e.payload.tool) s.ok = e.payload.ok;
        } else if (e.kind === "final") {
          const prov = agentDeps.provider;
          if (prov) {
            void maybeCapture({
              memoryDir: agentDeps.memoryDir,
              provider: prov,
              goal: parsed.data.text,
              steps: runSteps,
              outcome: e.payload.text,
              succeeded: true,
              today: new Date().toISOString().slice(0, 10),
            });
          }
        }
        const id = buffer.append({ kind: e.kind, payload: e.payload });
        if (e.kind === "final") {
          appendMessage(db, { sessionId: sid, role: "assistant", content: e.payload.text });
        }
        return id;
      };
      try {
        const impl = agentDeps.runAgentImpl ?? runAgent;
        const provider = agentDeps.provider!;  // null-check happened earlier (503)
        // The agent loop emits tool_call/tool_result centrally via the ToolRegistry,
        // so we pass noop emits to legacy builders. Phase 2 cleanup removes
        // the `emit` parameters from these builders entirely.
        const noop = () => {};
        // Conversation mode skips the Chromium boot wait and the heavy tool
        // builders, but memory tools stay available so the agent can still
        // record observations or recall facts mid-conversation.
        const memoryTools = buildMemoryTools({ memoryDir: agentDeps.memoryDir });
        let tools: ToolDef[];
        if (mode === "action") {
          // Chromium is NOT booted here. The chrome/computer_use builders close
          // over the lazy getChrome accessor and only launch the browser when a
          // browsing tool is actually dispatched — so a turn that never browses
          // (a greeting, a question answered from memory) pays no launch cost.
          const fs = buildFilesystem({ roots: agentDeps.fsRoots });
          const cc = buildClaudeCode({
            pidfiles: agentDeps.pidfiles,
            check: buildPathAllowlist({ roots: agentDeps.fsRoots }),
          });
          tools = [
            buildShellTool({ signal: abort.signal }),
            ...(buildFilesystemTools({ fs, emit: noop }) as ToolDef[]),
            buildClaudeCodeTool({ cc, emit: noop }) as ToolDef,
            ...(buildChromeTools({ getChrome: agentDeps.getChrome, emit: noop }) as ToolDef[]),
            // computer_use is provider-agnostic: prefers Anthropic when configured,
            // falls back to OpenAI computer-use-preview, otherwise reports unavailable.
            buildComputerUseTool({
              anthropic: metered.anthropic,
              openai: metered.openai,
              getChrome: agentDeps.getChrome,
              emit: noop,
            }) as ToolDef,
            ...(agentDeps.queueSelfImprove ? [buildSelfImproveTool({ queue: agentDeps.queueSelfImprove })] : []),
            ...memoryTools,
          ];
        } else {
          tools = memoryTools;
        }
        await impl({
          prompt: promptForAgent,
          priorMessages,
          abort,
          emit,
          runId,
          db,
          sessionId: sid,
          mode,
          reasoningEffort,
          deps: {
            // The orchestrator never reads chrome directly; tools carry their own
            // lazy accessor. Kept null so the browser stays unbooted until used.
            chrome: null,
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
