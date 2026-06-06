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
import { killTree } from "../process/kill-tree.js";
import type { Approval } from "../state/approvals.js";
import type { LLMProvider, Message as LLMMessage } from "../orchestrator/llm/types.js";
import { buildShellTool } from "../tools/shell-tool.js";
import { buildControlAppTool } from "../tools/control-app-mcp.js";
import { buildFilesystem } from "../tools/filesystem.js";
import { buildFilesystemTools } from "../tools/filesystem-mcp.js";
import { buildClaudeCode } from "../tools/claude-code.js";
import { buildClaudeCodeTool } from "../tools/claude-code-mcp.js";
import { buildChromeTools } from "../tools/chrome-mcp.js";
import { buildComputerUseTool } from "../tools/computer-use-mcp.js";
import { buildScreenshotTool } from "../tools/screenshot/screenshot-mcp.js";
import { buildReadLogsTool } from "../tools/activity-log-mcp.js";
import { buildSelfImproveTool, buildSelfImproveStatusTool, type IntentStatusSummary } from "../tools/self-improve-mcp.js";
import { buildDiscussTools } from "../tools/discuss-mcp.js";
import type { Discussion } from "../state/discussions.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { buildMemoryTools } from "../tools/memory-mcp.js";
import { buildUpdateLogTools } from "../tools/update-log-mcp.js";
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
  // Voice turns ask for minimal reasoning so spoken replies come back fast.
  // Capability is unchanged — the full tool stack still runs.
  voice: z.boolean().optional(),
  // When false, this run executes tools but persists NO messages. Used by the
  // HYBRID voice proxy's do_on_computer handoff: the realtime proxy already owns
  // the voice-turn storage (user transcript + spoken result), so the internal
  // /api/chat run must not double-store. Independent of `voice`. Defaults to true.
  persist: z.boolean().optional(),
});

// Upper bound on how long pre-run playbook recall may block a turn. Recall is a
// best-effort optimization; past this it is skipped and the agent runs without
// the playbook hint. Normal side-model matches return in ~1-2s.
const PLAYBOOK_MATCH_TIMEOUT_MS = 8_000;

export type AgentDeps = {
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  memoryDir: string;
  dataDir: string;
  getChrome: () => Promise<Chrome>;
  pushDeliver?: (a: Approval) => Promise<void>;
  notifyDone?: (summary: string) => void;
  provider: LLMProvider | null;
  queueSelfImprove?: (goal: string) => string;
  listSelfImprovements?: () => IntentStatusSummary[];
  /** Discuss-with-Claude: queue a background, read-only consult and recount past ones. */
  queueDiscussion?: (topic: string, sessionId: string | null) => string;
  listDiscussions?: () => Discussion[];
  getDiscussion?: (id: string) => Discussion | null;
  logsDir?: string;
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

    // Record the user turn only AFTER the concurrency gate. Appending before it
    // meant a rejected request still stacked an orphan user message with no
    // reply — the exact "voice session goes silent / second job won't run"
    // symptom (a stuck run 409s every later turn while history fills with
    // unanswered user lines).
    // persist:false (HYBRID voice handoff) runs the tools but stores nothing —
    // the realtime proxy is the single source of truth for voice turns.
    if (parsed.data.persist !== false) {
      appendMessage(db, { sessionId, role: "user", content: parsed.data.text });
    }

    if (agentDeps.provider) {
      await maybeSummarize({ db, sessionId, provider: agentDeps.provider });
    }

    const buffer = new SseBuffer({ maxEvents: 500, maxBytes: 5 * 1024 * 1024 });
    const abort = new AbortController();
    // Generate the runId HERE (before register) so it's stored on the ActiveRun.
    // The same id keys the agent run, the tool ctx, and the pidfiles — letting
    // the kill endpoint find this run's child PIDs and kill the whole subtree.
    const runId = nanoid(12);
    const activeRun = { sessionId, runId, abort, buffer };
    runs.register(activeRun);

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
    // TEXT defaults to "action" mode so every typed turn has the full tool stack
    // (the classifier was too conservative — casual "look up X" stayed in
    // conversation mode and Ava said "I can't access Google"). VOICE, however,
    // needs to be fast: a spoken "hi Ava" must not pay for the big orchestrator
    // model + whole tool prompt + playbook recall. So for voice we trust the
    // classifier — greetings/chitchat take the fast side-model conversation path,
    // and only genuine action requests spin up the full agent.
    // Override via FORCE_INTENT=conversation to force the chitchat path for text.
    const intent = classifyIntent(parsed.data.text);
    const mode: "conversation" | "action" =
      process.env.FORCE_INTENT === "conversation" ? "conversation"
        : parsed.data.voice ? intent
          : "action";

    // Recall: in action mode with saved playbooks, ask the side model to match
    // this request to a known playbook and inject its steps + a stakes rubric.
    // Chitchat (conversation mode) and a first-ever empty index never pay for it.
    //
    // Recall is a best-effort OPTIMIZATION: it must never break or stall a turn.
    // The match is wrapped in try/catch and bounded by a timeout so a slow or
    // failing side-model call (e.g. an LLM request timeout) degrades to "no
    // playbook injected" and the agent still runs.
    let playbookPrefix = "";
    if (mode === "action" && agentDeps.provider && !parsed.data.voice) {
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
      ? (parsed.data.voice ? "none" : mapReasoning(getReasoningLevel(db), mode))
      : undefined;

    void (async () => {
      const sid = sessionId!;
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
        // persist:false (HYBRID voice handoff) still streams final/error over SSE
        // so the proxy can speak the result — but it stores NO assistant message
        // here; the realtime proxy persists the spoken turn instead (no double-store).
        if (parsed.data.persist !== false) {
          if (e.kind === "final") {
            appendMessage(db, { sessionId: sid, role: "assistant", content: e.payload.text });
          } else if (e.kind === "error") {
            // Surface a run-ending error (LLM quota/timeout, stream failure) in the
            // transcript instead of leaving the chat silent — the run otherwise
            // returns with no persisted message and the user sees nothing.
            appendMessage(db, {
              sessionId: sid, role: "assistant",
              content: `That didn't work, Sir — ${e.payload.message}`,
            });
          }
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
        // Discuss-with-Claude is available in BOTH modes (Sir may ask by voice):
        // it queues a background, read-only consult bound to THIS session (sid),
        // returns immediately, and can recount past discussions. Only wired when
        // the deps are present (they are in production via index.ts).
        const discussTools =
          agentDeps.queueDiscussion && agentDeps.listDiscussions && agentDeps.getDiscussion
            ? buildDiscussTools({
                queue: agentDeps.queueDiscussion,
                list: agentDeps.listDiscussions,
                get: agentDeps.getDiscussion,
                sessionId: sid,
              })
            : [];
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
            buildControlAppTool({ signal: abort.signal }),
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
            // Desktop screenshot capture — saves PNGs under Downloads/Ava/screenshots.
            buildScreenshotTool({ emit: noop }) as ToolDef,
            ...(agentDeps.queueSelfImprove ? [buildSelfImproveTool({ queue: agentDeps.queueSelfImprove })] : []),
            ...(agentDeps.listSelfImprovements ? [buildSelfImproveStatusTool({ list: agentDeps.listSelfImprovements })] : []),
            ...(agentDeps.logsDir ? [buildReadLogsTool({ logsDir: agentDeps.logsDir })] : []),
            ...discussTools,
            ...memoryTools,
            ...buildUpdateLogTools({ dataDir: agentDeps.dataDir }),
          ];
        } else {
          // Voice/conversation must also reach the update log, since Sir asks
          // "what's happening" by voice — and can confer with Claude by voice.
          // control_app is included so Sir can drive native apps by voice (focus
          // a window, type, hotkeys) — local PowerShell, no API cost.
          tools = [
            buildControlAppTool({ signal: abort.signal }),
            ...discussTools,
            ...memoryTools,
            ...buildUpdateLogTools({ dataDir: agentDeps.dataDir }),
          ];
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
            notifyDone: agentDeps.notifyDone,
            provider,
            tools,
          },
        });
      } finally {
        runs.unregister(sid, activeRun);
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

  r.post("/:sessionId/kill", auth, async (req, res) => {
    const sessionId = req.params.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    // Look up the run's id BEFORE unregistering so we can find its child PIDs.
    const runId = runs.getRunId(sessionId);
    // 1. Abort the model read-loop and signal in-flight tools (computer_use's
    //    GUI loop, claude_code's child via its abort listener).
    const ok = runs.abort(sessionId);
    // 2. Kill the run's spawned process subtree — claude_code's `claude -p`
    //    child and everything it spawned — so Stop actually halts running work,
    //    not just the next model turn. Best-effort: never let a dead/missing pid
    //    fail the request. (Belt-and-suspenders with claude_code's own abort.)
    if (runId) {
      for (const pid of agentDeps.pidfiles.listForRun(runId)) {
        try { await killTree(pid); } catch { /* already gone — keep going */ }
      }
    }
    runs.unregister(sessionId); // free the slot immediately so a new turn can start (preempt)
    res.json({ aborted: ok });
  });

  return r;
}
