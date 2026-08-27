import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { Db } from "../state/db.js";
import { createSession, getSession, getSessionFull, touchSession, updateTitle } from "../state/sessions.js";
import {
  appendMessage,
  listMessages,
  listMessagesAfterId,
  type Message,
  type MessageVisualContext,
  type MessageVisualReference,
} from "../state/messages.js";
import { getVisualExplanation } from "../state/visual-explanations.js";
import { researchEntityRecords } from "../visual-explanations/research-model.js";
import { SseBuffer } from "../sse/buffer.js";
import { createSink } from "../sse/stream.js";
import { runAgent, type AgentEvent } from "../orchestrator/agent.js";
import { classifyIntent, classifyTypedIntent } from "../orchestrator/intent-classifier.js";
import { decideGreeting } from "../orchestrator/greeting.js";
import { ActiveRuns, type ActiveRun } from "../orchestrator/active-runs.js";
import { autoTitle } from "../orchestrator/auto-title.js";
import { maybeSummarize } from "../orchestrator/auto-summary.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { killTree } from "../process/kill-tree.js";
import { cancelAllImprovements } from "../self/improver.js";
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
import { buildLookAtScreenTool } from "../tools/screenshot/look-mcp.js";
import { buildWatchTools } from "../tools/watches-mcp.js";
import { buildInstagramTools, buildPeopleTools } from "../apps/instagram-mcp.js";
import { buildWhatsappTools } from "../apps/whatsapp-mcp.js";
import { buildReadLogsTool } from "../tools/activity-log-mcp.js";
import { buildSelfImproveTool, buildSelfImproveStatusTool, type IntentStatusSummary } from "../tools/self-improve-mcp.js";
import { buildDiscussTools } from "../tools/discuss-mcp.js";
import type { Discussion } from "../state/discussions.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { buildMemoryTools } from "../tools/memory-mcp.js";
import { buildNotesTools } from "../tools/notes-mcp.js";
import { buildStrategyRoomTools } from "../tools/strategy-room-mcp.js";
import { buildVisualExplanationTools } from "../tools/visual-explanations-mcp.js";
import type { StrategyChatHandoffResult } from "../strategy/coordinator.js";
import { buildUpdateLogTools } from "../tools/update-log-mcp.js";
import { buildShopifyTools } from "../tools/shopify-mcp.js";
import { buildPlacesTools } from "../tools/places-mcp.js";
import type { CodexWatchTarget } from "../watches/codex-dispatch.js";
import { getReasoningLevel } from "../state/reasoning-pref.js";
import { mapReasoning } from "../orchestrator/reasoning.js";
import { detectCorrection, formatCorrection } from "../orchestrator/correction-detector.js";
import { rememberObservation } from "../memory/remember.js";
import { maybeCapture } from "../playbooks/capture.js";
import { matchPlaybook } from "../playbooks/match.js";
import { loadPlaybookIndex, readPlaybook } from "../playbooks/store.js";
import { bumpUse, recordOutcome } from "../playbooks/mutate.js";
import type { RunStep } from "../playbooks/distill.js";
import { learningEvidenceFromReceipt, learningOutcomeFromReceipt } from "../playbooks/learning.js";
import {
  cancelExplorerTaskIfRunning,
  createExplorerTask,
  failExplorerTaskIfRunning,
  recordExplorerAgentEvent,
} from "../explorer/store.js";
import { AgentObservabilityRecorder } from "../observability/agent-adapter.js";
import type { ObservabilityService } from "../observability/store.js";
import { TERMINAL_RUN_STATUSES } from "../observability/types.js";
import { TaskReceiptBuilder, type TaskReceipt } from "../receipts/task-receipt.js";
import { resolveRunObjective } from "../orchestrator/objective-lineage.js";
import { getTaskReceipt, pruneTaskReceipts, saveTaskReceipt } from "../state/task-receipts.js";

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
  // Only explicit visual-card actions or composer attachments send this. Zoom,
  // pan, hover, animation and unsubmitted selection remain browser-local.
  visualContext: z.object({
    visualMessageId: z.string().regex(/^visual_[A-Za-z0-9_-]{8,32}$/),
    revision: z.number().int().positive(),
    action: z.enum(["explain", "branch", "attach"]),
    sceneId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/),
    selectedElementIds: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,63}$/)).max(14),
  }).strict().optional(),
  // An internal handoff may attach this run beneath a voice/Forge/Codex span.
  // It carries identifiers only; AVA still owns dispatch and policy.
  observability: z.object({
    traceId: z.string().min(1).max(160),
    parentRunId: z.string().min(1).max(160),
    parentSpanId: z.string().min(1).max(160).nullish(),
    causationEventId: z.string().min(1).max(160).nullish(),
  }).optional(),
});

function validateVisualContext(
  db: Db,
  context: MessageVisualContext | undefined,
): { context: MessageVisualContext; prompt: string } | null {
  if (!context) return null;
  const current = getVisualExplanation(db, context.visualMessageId);
  if (!current) throw Object.assign(new Error("visual message not found"), { code: "visual_message_not_found", status: 404 });
  if (current.revision !== context.revision) {
    throw Object.assign(new Error("visual revision is stale"), {
      code: "stale_visual_revision",
      status: 409,
      currentRevision: current.revision,
    });
  }
  const scene = current.storyboard.scenes.find((item) => item.id === context.sceneId);
  if (!scene) throw Object.assign(new Error("visual scene is invalid"), { code: "invalid_visual_context", status: 400 });
  const records = current.schemaVersion === "1.0"
    ? current.semanticModel.elements.map((element) => ({ id: element.id, label: element.label, claimIds: [] as string[], sourceIds: [] as string[] }))
    : researchEntityRecords(current.semanticModel);
  const elements = new Map(records.map((element) => [element.id, element]));
  const sceneEntityIds = "nodeIds" in scene ? scene.nodeIds : scene.entityIds;
  const selected = [...new Set(context.selectedElementIds)];
  if (selected.some((id) => !sceneEntityIds.includes(id) || !elements.has(id))) {
    throw Object.assign(new Error("selected visual elements are invalid"), { code: "invalid_visual_context", status: 400 });
  }
  const safeContext: MessageVisualContext = { ...context, selectedElementIds: selected };
  const selectedLabels = selected.map((id) => {
    const element = elements.get(id)!;
    if (current.schemaVersion === "1.0") return `${id}: ${element.label}`;
    const claimText = element.claimIds.map((claimId) => current.claims.find((claim) => claim.id === claimId)?.text).filter(Boolean);
    const sourceText = element.sourceIds.map((sourceId) => current.sources.find((source) => source.id === sourceId)).filter(Boolean)
      .map((source) => `${source!.title} (${source!.url})`);
    return `${id}: ${element.label}${claimText.length ? `\n  claims: ${claimText.join(" | ")}` : ""}${sourceText.length ? `\n  sources: ${sourceText.join(" | ")}` : ""}`;
  });
  const prompt = [
    "[EXPLICIT VISUAL CONTEXT — server validated]",
    `visualMessageId: ${current.visualMessageId}`,
    `revision: ${current.revision}`,
    `action: ${context.action}`,
    `scene: ${scene.id} — ${scene.title}`,
    `scene caption: ${scene.caption}`,
    selectedLabels.length ? `selected elements:\n${selectedLabels.map((line) => `- ${line}`).join("\n")}` : "selected elements: none (use the current scene)",
    "[/EXPLICIT VISUAL CONTEXT]",
  ].join("\n");
  return { context: safeContext, prompt };
}

function messageContentForAgent(db: Db, message: Message): string {
  if (message.role !== "user" || !message.metadata?.visualContext) return message.content;
  try {
    const resolved = validateVisualContext(db, message.metadata.visualContext);
    return resolved ? `${resolved.prompt}\n\n${message.content}` : message.content;
  } catch {
    // Never substitute a newer visual revision into immutable chat history.
    return message.content;
  }
}


// Shown/persisted in place of a blank assistant turn when the model produces an
// empty final (it acted but wrote no closing text). Never store an empty reply —
// the chat would render a silent bubble and the turn would look broken.
const GRACEFUL_FINAL =
  "Done, Sir — though I didn't have anything further to add.";

export type AgentDeps = {
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  memoryDir: string;
  dataDir: string;
  getChrome: () => Promise<Chrome>;
  pushDeliver?: (a: Approval) => Promise<void>;
  notifyDone?: (summary: string) => void;
  provider: LLMProvider | null;
  queueSelfImprove?: (goal: string) => string | Promise<string>;
  listSelfImprovements?: () => IntentStatusSummary[];
  /** Discuss-with-Claude: queue a background, read-only consult and recount past ones. */
  queueDiscussion?: (topic: string, sessionId: string | null) => string;
  listDiscussions?: () => Discussion[];
  getDiscussion?: (id: string) => Discussion | null;
  /** Move the authoritative current chat snapshot into AVA's Strategy Room. */
  openStrategyRoomFromSession?: (sessionId: string) => StrategyChatHandoffResult;
  logsDir?: string;
  /** Shopify Admin API creds — when present, the shopify_* product tools are offered. */
  shopify?: { store: string; token: string } | null;
  /** Google Places API key — when present, the find_places tool is offered. */
  googlePlacesApiKey?: string | null;
  /** Pins watcher delivery to one concrete Codex TUI thread for this repo. */
  resolveCodexWatchTarget?: () => CodexWatchTarget | null;
  /** Optional override; lets tests substitute a fake agent loop. Defaults to runAgent. */
  runAgentImpl?: typeof runAgent;
  /** Shared Mission Control stream. Optional keeps isolated route tests simple. */
  observability?: ObservabilityService;
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
  // A just-finished fast run can unregister before the browser opens its SSE
  // stream. Keep the latest sanitized receipt per session in memory for five
  // minutes as the fast path; SQLite provides restart-safe replay for 30 days.
  // Mission Control remains the richer technical record.
  const recentReceipts = new Map<string, { receipt: TaskReceipt; expiresAt: number }>();
  const RECEIPT_REPLAY_TTL_MS = 5 * 60_000;
  const pruneRecentReceipts = (now = Date.now()) => {
    for (const [sid, value] of recentReceipts) {
      if (value.expiresAt <= now) recentReceipts.delete(sid);
    }
  };

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
    let resolvedVisualContext: ReturnType<typeof validateVisualContext> = null;
    try {
      resolvedVisualContext = validateVisualContext(db, parsed.data.visualContext);
    } catch (error) {
      const failure = error as Error & { code?: string; status?: number; currentRevision?: number };
      res.status(failure.status ?? 400).json({
        error: failure.code ?? "invalid_visual_context",
        message: failure.message,
        ...(failure.currentRevision ? { currentRevision: failure.currentRevision } : {}),
      });
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
      appendMessage(db, {
        sessionId,
        role: "user",
        content: parsed.data.text,
        ...(resolvedVisualContext ? { metadata: { visualContext: resolvedVisualContext.context } } : {}),
      });
    }

    // Fire-and-forget: summarization must NOT block the response. Awaiting it
    // here added latency before the client could open the stream, widening the
    // fast-finish/connect race. It already guards duplicate work via
    // summary_through_message_id, and the current turn built its context from
    // existing state below — so a late summary only affects FUTURE turns.
    if (agentDeps.provider) {
      void maybeSummarize({ db, sessionId, provider: agentDeps.provider }).catch(() => {});
    }

    // maxEvents raised 500 → 2000 → 6000: streamed replies now ride coalesced
    // `delta` events through this same replay buffer. Coalescing keeps a long
    // reply to tens-to-low-hundreds of deltas, but a pathologically long reply
    // (~2000+ coalesced deltas plus tool events) could exceed a 2000 cap and
    // EVICT this run's early tool_call/tool_result events, so a client that
    // reconnects mid-very-long-reply would miss them (a gap). 6000 is cheap
    // headroom; the 5MB byte cap still bounds memory.
    //
    // Note: deltas are TRANSIENT. The `final` event carries the complete text,
    // so even if early deltas are evicted, a reconnecting client still gets the
    // full reply via `final` — only the live word-by-word reveal of the prefix
    // is lost on reconnect, never the message content.
    const buffer = new SseBuffer({ maxEvents: 6000, maxBytes: 5 * 1024 * 1024 });
    const abort = new AbortController();
    // Generate the runId HERE (before register) so it's stored on the ActiveRun.
    // The same id keys the agent run, the tool ctx, and the pidfiles — letting
    // the kill endpoint find this run's child PIDs and kill the whole subtree.
    const runId = nanoid(12);
    const activeRun: ActiveRun = { sessionId, runId, abort, buffer };
    runs.register(activeRun);
    pruneRecentReceipts();
    recentReceipts.delete(sessionId);

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
    const objectiveForRun = resolveRunObjective(parsed.data.text, priorRows);
    const priorMessages: LLMMessage[] = priorRows
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: messageContentForAgent(db, m),
      }));
    // A persist:false voice handoff deliberately does not append its generated
    // computer-action instruction to chat history. The latest stored row is the
    // owner's spoken transcript that caused that handoff, so using it here would
    // silently discard the more precise action instruction (for example, a
    // generated "focus Codex and run /resume" task became the fragment "You are").
    // Keep the earlier rows as history, but make the transient request itself the
    // final user prompt that the tool-capable agent executes.
    const latestUserText =
      parsed.data.persist === false
        ? parsed.data.text
        : latestRow?.content ?? parsed.data.text;
    // TEXT defaults to "action" mode so every typed turn has the full tool stack
    // (the classifier was too conservative — casual "look up X" stayed in
    // conversation mode and Ava said "I can't access Google"). VOICE, however,
    // needs to be fast: a spoken "hi Ava" must not pay for the big orchestrator
    // model + whole tool prompt + playbook recall. So for voice we trust the
    // classifier — greetings/chitchat take the fast side-model conversation path,
    // and only genuine action requests spin up the full agent.
    // Override via FORCE_INTENT=conversation to force the chitchat path for text.
    // Voice: conversation-biased classifier (misheard speech must not
    // auto-execute). Typed: action-biased classifier — only unmistakable
    // chitchat skips the tool agent (a task in conversation mode would
    // silently lose its tools; chitchat in action mode only loses a second).
    const intent = parsed.data.voice
      ? classifyIntent(parsed.data.text)
      : classifyTypedIntent(parsed.data.text);
    const mode: "conversation" | "action" =
      process.env.FORCE_INTENT === "conversation" ? "conversation" : intent;

    // Recall: in action mode with saved playbooks, match this request to a known
    // playbook locally and inject its steps + a stakes rubric. This used to be a
    // BLOCKING side-model LLM call — measured live at 1.7-2.8s of pre-roll on
    // every typed turn. Local token-overlap scoring is ~0ms and free; the trade
    // (documented in match.test.ts) is that pure paraphrases with no lexical
    // overlap no longer recall — the agent then simply runs without the hint.
    let playbookPrefix = "";
    // Which playbook steered this run, if any — its typed evidence record and
    // verified-duration trend are updated from the terminal receipt.
    let recalledSlug: string | null = null;
    if (mode === "action" && !parsed.data.voice) {
      try {
        const index = loadPlaybookIndex(agentDeps.memoryDir);
        if (index.length) {
          const slug = matchPlaybook({ prompt: parsed.data.text, index });
          if (slug) {
            const pb = readPlaybook(agentDeps.memoryDir, slug);
            if (pb) {
              recalledSlug = slug;
              bumpUse(agentDeps.memoryDir, slug, new Date().toISOString().slice(0, 10));
              const rubric = pb.stakes === "consequential"
                ? "This is a known consequential task — follow these steps efficiently, but verify the result before reporting done."
                : "This is a known routine task — follow these steps efficiently; no recheck needed.";
              const lessons = pb.lessons.length
                ? `\nLessons from past runs (don't repeat these mistakes):\n${pb.lessons.map((l) => `- ${l}`).join("\n")}`
                : "";
              playbookPrefix = `[PLAYBOOK — ${pb.slug}]\n${rubric}${lessons}\n${pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`;
            }
          }
        }
      } catch (err) {
        console.warn("[playbooks] recall match skipped:", err instanceof Error ? err.message : err);
      }
    }

    const promptForAgent = greeting.prefix + summaryHeader + playbookPrefix
      + (resolvedVisualContext ? `${resolvedVisualContext.prompt}\n\n` : "")
      + latestUserText;
    const reasoningEffort = agentDeps.provider!.name === "openai"
      ? (parsed.data.voice ? "none" : mapReasoning(getReasoningLevel(db), mode))
      : undefined;

    const runStartMs = Date.now();
    const receiptBuilder = new TaskReceiptBuilder({
      taskId: runId,
      objective: objectiveForRun,
      mode,
      startedAt: runStartMs,
    });
    let explorerTraceReady = false;
    try {
      createExplorerTask(db, {
        id: runId,
        sessionId,
        originalRequest: parsed.data.text,
        mode,
        startedAt: runStartMs,
      });
      explorerTraceReady = true;
    } catch (err) {
      // Observability must never prevent the requested task from running.
      console.warn("[explorer] task start record failed:", err instanceof Error ? err.message : err);
    }

    let missionRecorder: AgentObservabilityRecorder | null = null;
    let unregisterMissionStop = () => {};
    if (agentDeps.observability) {
      try {
        const parentContext = parsed.data.observability;
        const parentRun = parentContext
          ? agentDeps.observability.getRun(parentContext.parentRunId)
          : null;
        agentDeps.observability.startRun({
          id: runId,
          traceId: parentContext?.traceId,
          parentRunId: parentContext?.parentRunId ?? null,
          rootTaskId: parentRun?.rootTaskId ?? parentRun?.id ?? runId,
          sessionId,
          runKind: parsed.data.persist === false ? "voice_action" : "chat_agent",
          runtimeId: "ava:agent",
          runtimeType: "ava",
          hostRuntimeId: parentContext ? "ava:voice" : null,
          ownerType: "ava",
          ownerId: "agent-runtime",
          ownerRole: mode === "action" ? "tool-agent" : "conversation-agent",
          title: parsed.data.persist === false
            ? "Voice delegated an action"
            : "AVA chat request",
          objective: objectiveForRun,
          privacyLevel: "personal",
          staleAfterMs: 90_000,
          startedAt: runStartMs,
        });
        missionRecorder = new AgentObservabilityRecorder(
          agentDeps.observability,
          runId,
          parentContext?.parentSpanId ?? null,
          parentContext?.causationEventId ?? null,
        );
        const observedSessionId = sessionId;
        unregisterMissionStop = agentDeps.observability.registerStopHandler(
          runId,
          async () => {
            if (runs.get(observedSessionId) !== activeRun) return false;
            abort.abort();
            activeRun.cancel?.();
            for (const pid of agentDeps.pidfiles.listForRun(runId)) {
              try { await killTree(pid); } catch { /* already exited */ }
            }
            if (explorerTraceReady) {
              try { cancelExplorerTaskIfRunning(db, runId); } catch { /* best effort */ }
            }
            return true;
          },
        );
      } catch (err) {
        // The observed work always wins over its telemetry.
        console.warn("[mission-control] run start failed:", err instanceof Error ? err.message : err);
      }
    }

    void (async () => {
      const sid = sessionId!;
      // Collect the run's tool steps so a successful >=2-tool run can be
      // distilled into a reusable playbook (best-effort, fire-and-forget).
      const runSteps: RunStep[] = [];
      const runVisualReferences = new Map<string, MessageVisualReference>();
      const toolStartedAt = new Map<string, number[]>();
      let terminalReceiptPublished = false;
      let finalTextForLearning: string | null = null;
      let playbookLearningSettled = false;
      const publishReceipt = (at: number, remember: boolean): TaskReceipt => {
        const receipt = receiptBuilder.snapshot(at);
        buffer.append({ kind: "receipt", payload: receipt });
        if (remember) {
          recentReceipts.set(sid, {
            receipt,
            expiresAt: at + RECEIPT_REPLAY_TTL_MS,
          });
          try {
            saveTaskReceipt(db, sid, receipt, at);
            pruneTaskReceipts(db, at);
          } catch (err) {
            console.warn("[receipt] durable snapshot failed:", err instanceof Error ? err.message : err);
          }
        }
        return receipt;
      };
      const settlePlaybookLearning = (at: number) => {
        if (playbookLearningSettled) return;
        playbookLearningSettled = true;
        const receipt = receiptBuilder.snapshot(at);
        const learningOutcome = learningOutcomeFromReceipt(receipt);
        const evidence = learningEvidenceFromReceipt(receipt);
        const durationSecs = Math.max(0, (at - runStartMs) / 1000);
        if (finalTextForLearning && agentDeps.provider) {
          void maybeCapture({
            memoryDir: agentDeps.memoryDir,
            provider: agentDeps.provider,
            goal: objectiveForRun,
            steps: runSteps,
            resultText: finalTextForLearning,
            learningOutcome,
            evidence,
            durationSecs,
            today: new Date(at).toISOString().slice(0, 10),
          });
        }
        if (recalledSlug) {
          try {
            recordOutcome(agentDeps.memoryDir, recalledSlug, {
              outcome: learningOutcome,
              secs: durationSecs,
              evidence,
            });
          } catch (err) {
            console.warn("[playbooks] outcome record failed:", err instanceof Error ? err.message : err);
          }
          recalledSlug = null;
        }
      };
      const emit = (e: AgentEvent) => {
        // Stop publishes `killed` immediately through activeRun.cancel below.
        // Ignore the agent's later cooperative cancellation/done so one run has
        // exactly one terminal receipt and one terminal stream event.
        if (receiptBuilder.terminal &&
            (e.kind === "error" || e.kind === "killed" || e.kind === "done")) {
          return 0;
        }
        if (e.kind === "tool_call") {
          runSteps.push({ tool: e.payload.tool, args: e.payload.args, ok: true });
        } else if (e.kind === "tool_result") {
          const s = runSteps[runSteps.length - 1];
          if (s && s.tool === e.payload.tool) s.ok = e.payload.ok;
          if (e.payload.ok && (e.payload.tool === "visual_explanation_create" || e.payload.tool === "research_visual_create")) {
            try {
              const result = JSON.parse(e.payload.result) as {
                visualMessageId?: unknown;
                visualExplanationId?: unknown;
                revision?: unknown;
              };
              const id = typeof result.visualMessageId === "string"
                ? result.visualMessageId
                : typeof result.visualExplanationId === "string" ? result.visualExplanationId : "";
              const requestedRevision = typeof result.revision === "number" ? result.revision : null;
              const visual = /^visual_[A-Za-z0-9_-]{8,32}$/.test(id)
                ? getVisualExplanation(db, id, requestedRevision)
                : null;
              if (visual && visual.sourceSessionId === sid) {
                const reference = { visualMessageId: visual.visualMessageId, revision: visual.revision };
                runVisualReferences.set(`${reference.visualMessageId}:${reference.revision}`, reference);
              }
            } catch { /* malformed output cannot become a trusted attachment */ }
          }
        }
        // Normalize an empty/whitespace final to a graceful message so we never
        // stream or persist a blank assistant turn (the run did something — the
        // model just produced no closing text).
        if (e.kind === "final" && !e.payload.text.trim()) {
          e = { kind: "final", payload: { text: GRACEFUL_FINAL } };
        }
        // This is the one complete operational event seam shared by all tools.
        // Explorer omits model thought/delta events and applies its own broader
        // secret scrub before committing anything to the execution history.
        const eventAt = Date.now();
        receiptBuilder.observe(e);
        if (e.kind === "final") finalTextForLearning = e.payload.text;
        let toolDurationMs: number | null = null;
        if (e.kind === "tool_call") {
          const starts = toolStartedAt.get(e.payload.tool) ?? [];
          starts.push(eventAt);
          toolStartedAt.set(e.payload.tool, starts);
        } else if (e.kind === "tool_result") {
          const starts = toolStartedAt.get(e.payload.tool);
          const started = starts?.shift();
          if (started !== undefined) toolDurationMs = Math.max(0, eventAt - started);
          if (starts?.length === 0) toolStartedAt.delete(e.payload.tool);
        }
        if (explorerTraceReady) {
          try {
            recordExplorerAgentEvent(db, runId, e, {
              at: eventAt,
              durationMs: toolDurationMs,
            });
          } catch (err) {
            console.warn("[explorer] event record failed:", err instanceof Error ? err.message : err);
          }
        }
        if (missionRecorder) {
          try {
            missionRecorder.record(e, {
              at: eventAt,
              durationMs: toolDurationMs,
            });
          } catch (err) {
            console.warn("[mission-control] event record failed:", err instanceof Error ? err.message : err);
          }
        }
        // A terminal receipt must precede error/killed/done: the browser closes
        // its EventSource as soon as it sees one of those terminal events.
        if ((e.kind === "error" || e.kind === "killed" || e.kind === "done") &&
            !terminalReceiptPublished) {
          settlePlaybookLearning(eventAt);
          publishReceipt(eventAt, true);
          terminalReceiptPublished = true;
        }
        const id = buffer.append({ kind: e.kind, payload: e.payload });
        // Approval is a live lifecycle boundary, not a terminal outcome. Emit a
        // replaceable snapshot after the approval event so the card and receipt
        // describe the same current state. A later snapshot supersedes it.
        if (e.kind === "approval_required" || e.kind === "approval_resolved") {
          publishReceipt(eventAt, false);
        }
        // persist:false (HYBRID voice handoff) still streams final/error over SSE
        // so the proxy can speak the result — but it stores NO assistant message
        // here; the realtime proxy persists the spoken turn instead (no double-store).
        if (parsed.data.persist !== false) {
          if (e.kind === "final") {
            const visualMessages = [...runVisualReferences.values()];
            appendMessage(db, {
              sessionId: sid,
              role: "assistant",
              content: e.payload.text,
              ...(visualMessages.length ? { metadata: { visualMessages } } : {}),
            });
          } else if (e.kind === "error") {
            // Surface a run-ending error (LLM quota/timeout, stream failure) in the
            // transcript instead of leaving the chat silent — the run otherwise
            // returns with no persisted message and the user sees nothing.
            appendMessage(db, {
              sessionId: sid, role: "assistant",
              content: `That didn't work, Sir — ${e.payload.message}`,
              ...([...runVisualReferences.values()].length
                ? { metadata: { visualMessages: [...runVisualReferences.values()] } }
                : {}),
            });
          }
        }
        return id;
      };
      activeRun.cancel = () => {
        if (!receiptBuilder.terminal) emit({ kind: "killed", payload: { reason: "manual" } });
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
        // Notes stay available in both routing modes: "put this in Notes" is a
        // lightweight conversational instruction, but it must still persist a
        // structured visible record. Voice records the same source lineage.
        const notesTools = buildNotesTools({
          db,
          sessionId: sid,
          source: parsed.data.voice ? "ava_voice" : "ava_chat",
          queueSelfImprove: agentDeps.queueSelfImprove,
        });
        const strategyRoomTools = agentDeps.openStrategyRoomFromSession
          ? buildStrategyRoomTools({
              sessionId: sid,
              openFromSession: agentDeps.openStrategyRoomFromSession,
            })
          : [];
        const visualExplanationTools = buildVisualExplanationTools({
          db,
          sessionId: sid,
          source: parsed.data.voice ? "ava_voice" : "ava_chat",
          observability: agentDeps.observability,
          request: parsed.data.text,
        });
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
            buildShellTool({ signal: abort.signal, pidfiles: agentDeps.pidfiles }),
            buildControlAppTool({ signal: abort.signal, pidfiles: agentDeps.pidfiles }),
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
            // Honest screen-sight: capture + ONE vision call on a standard
            // multimodal model. Covers describe/verify when computer_use's
            // gated computer-use-preview model is unavailable.
            ...(metered.openai ? [buildLookAtScreenTool({ openai: metered.openai }) as ToolDef] : []),
            ...(agentDeps.queueSelfImprove ? [buildSelfImproveTool({ queue: agentDeps.queueSelfImprove })] : []),
            ...(agentDeps.listSelfImprovements ? [buildSelfImproveStatusTool({ list: agentDeps.listSelfImprovements })] : []),
            ...(agentDeps.logsDir ? [buildReadLogsTool({ logsDir: agentDeps.logsDir })] : []),
            // Reliable API integrations — offered only when their credentials are set.
            // These edit/query directly over HTTP instead of driving the browser.
            ...(agentDeps.shopify ? buildShopifyTools(agentDeps.shopify) : []),
            ...(agentDeps.googlePlacesApiKey ? buildPlacesTools({ apiKey: agentDeps.googlePlacesApiKey }) : []),
            ...discussTools,
            ...memoryTools,
            ...notesTools,
            ...strategyRoomTools,
            ...visualExplanationTools,
            ...buildUpdateLogTools({ dataDir: agentDeps.dataDir }),
            // Standing background checks ("notify me if/when …") — the
            // scheduler re-runs them; Ava just registers/lists/deletes here.
            ...(buildWatchTools({ db, resolveCodexTarget: agentDeps.resolveCodexWatchTarget }) as ToolDef[]),
            // App modules: deterministic Instagram workflows + the people map
            // (saved usernames are authoritative; sends re-verify the profile).
            ...(buildInstagramTools({ getChrome: agentDeps.getChrome, memoryDir: agentDeps.memoryDir }) as ToolDef[]),
            ...(buildWhatsappTools({ getChrome: agentDeps.getChrome, memoryDir: agentDeps.memoryDir }) as ToolDef[]),
            ...(buildPeopleTools({ memoryDir: agentDeps.memoryDir }) as ToolDef[]),
          ];
        } else {
          // Voice/conversation must also reach the update log, since Sir asks
          // "what's happening" by voice — and can confer with Claude by voice.
          // control_app is included so Sir can drive native apps by voice (focus
          // a window, type, hotkeys) — local PowerShell, no API cost.
          tools = [
            buildControlAppTool({ signal: abort.signal, pidfiles: agentDeps.pidfiles }),
            ...discussTools,
            ...memoryTools,
            ...notesTools,
            ...strategyRoomTools,
            ...visualExplanationTools,
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
          recordUsage: (usage) => {
            if (!missionRecorder) return;
            try { missionRecorder.recordUsage(usage); }
            catch (err) {
              // Accounting must never become a failure in the work it observes.
              console.warn("[mission-control] usage record failed:", err instanceof Error ? err.message : err);
            }
          },
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
        // Test adapters and future runtimes are allowed to return after a final
        // without emitting the bookkeeping `done` event. Close that seam here
        // so the stream always receives one terminal receipt and one terminator.
        if (!receiptBuilder.terminal) emit({ kind: "done", payload: {} });
      } catch (err) {
        // Last-resort guard: an exception escaping the agent loop (e.g. a SQLite
        // write failing inside emit) must end THIS run — not become an unhandled
        // rejection that crashes the whole server mid-task.
        const msg = err instanceof Error ? err.message : String(err);
        try {
          const eventAt = Date.now();
          receiptBuilder.observe({ kind: "error", payload: { message: msg } });
          settlePlaybookLearning(eventAt);
          if (!terminalReceiptPublished) {
            const receipt = receiptBuilder.snapshot(eventAt);
            buffer.append({ kind: "receipt", payload: receipt });
            recentReceipts.set(sid, {
              receipt,
              expiresAt: eventAt + RECEIPT_REPLAY_TTL_MS,
            });
            try { saveTaskReceipt(db, sid, receipt, eventAt); }
            catch { /* the run-ending error must still reach the stream */ }
            terminalReceiptPublished = true;
          }
          buffer.append({ kind: "error", payload: { message: msg } });
          buffer.append({ kind: "done", payload: {} });
          if (explorerTraceReady) {
            recordExplorerAgentEvent(db, runId, {
              kind: "error",
              payload: { message: msg },
            });
          }
          missionRecorder?.record({
            kind: "error",
            payload: { message: msg },
          });
          if (parsed.data.persist !== false) {
            appendMessage(db, { sessionId: sid, role: "assistant", content: `That didn't work, Sir — ${msg}` });
          }
        } catch { /* even the error path failed; finally still unregisters */ }
        console.error("[chat] run crashed:", msg);
      } finally {
        unregisterMissionStop();
        if (agentDeps.observability) {
          try {
            const missionRun = agentDeps.observability.getRun(runId);
            if (missionRun && !TERMINAL_RUN_STATUSES.has(missionRun.status)) {
              agentDeps.observability.record(runId, {
                producerId: "ava:agent",
                type: "agent.runtime.orphan_closed",
                status: "error",
                title: "Agent runtime ended without a terminal event",
                summary: "AVA closed the run conservatively because its worker exited without a final outcome.",
                terminal: true,
                runStatus: "failed",
                outcome: "runtime_ended_without_terminal_event",
                verificationStatus: "not_verified",
              });
            }
          } catch (err) {
            console.warn("[mission-control] run close failed:", err instanceof Error ? err.message : err);
          }
        }
        if (explorerTraceReady) {
          try {
            failExplorerTaskIfRunning(db, runId);
          } catch (err) {
            console.warn("[explorer] task close failed:", err instanceof Error ? err.message : err);
          }
        }
        runs.unregister(sid, activeRun);
      }
    })();

    res.json({ sessionId, taskId: runId });
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
      // No active run for this session. A fast turn can finish + unregister
      // BEFORE the client opens this stream (POST returns first, the EventSource
      // connects after). 404-ing here makes the browser EventSource retry
      // forever and `busy` never clears. Instead, terminate cleanly: replay the
      // session's latest assistant reply as a `final`, then `done`, then end —
      // exactly the shape the live loop emits, so the client finishes the turn.
      const sink = createSink(res);
      // Ids just need to be > what the client already has so they aren't deduped.
      let id = lastEventId;
      const latest = latestAssistantAfterLastUser(db, sessionId);
      if (latest) {
        sink.write({ id: ++id, kind: "final", payload: { text: latest }, bytes: 0, ts: Date.now() });
      }
      pruneRecentReceipts();
      const requestedTaskId = typeof req.query.taskId === "string" ? req.query.taskId : null;
      const memoryReceipt = recentReceipts.get(sessionId)?.receipt;
      const recent = memoryReceipt && (!requestedTaskId || requestedTaskId === memoryReceipt.taskId)
        ? memoryReceipt
        : getTaskReceipt(db, { sessionId, taskId: requestedTaskId });
      if (recent) {
        sink.write({ id: ++id, kind: "receipt", payload: recent, bytes: 0, ts: Date.now() });
      }
      // Always emit `done` so the EventSource finishes (sets finished, clears
      // busy) even when there is no assistant message yet.
      sink.write({ id: ++id, kind: "done", payload: {}, bytes: 0, ts: Date.now() });
      sink.close();
      return;
    }
    const sink = createSink(res);
    const replay = run.buffer.since(lastEventId);
    if (replay.gap && replay.oldestBuffered != null) {
      sink.writeGap(lastEventId + 1, replay.oldestBuffered);
    }
    for (const ev of replay.events) sink.write(ev);

    let lastSeen = replay.events.at(-1)?.id ?? lastEventId;
    // Heartbeat: a long single-tool turn (claude_code, computer_use) can emit
    // zero events for minutes, and idle intermediaries drop a silent connection.
    // If a tick flushes nothing, send a comment ping ~every 15s to keep it open.
    // Comments carry no event id, so replay/dedup is undisturbed.
    const HEARTBEAT_MS = 15_000;
    let lastWriteAt = Date.now();
    const interval = setInterval(() => {
      if (sink.closed) { clearInterval(interval); return; }
      const more = run.buffer.since(lastSeen);
      for (const ev of more.events) sink.write(ev);
      if (more.events.length > 0) {
        lastSeen = more.events.at(-1)!.id;
        lastWriteAt = Date.now();
      } else if (Date.now() - lastWriteAt >= HEARTBEAT_MS) {
        sink.comment("ping");
        lastWriteAt = Date.now();
      }
      if (!runs.get(sessionId)) {
        clearInterval(interval);
        sink.close();
      }
    }, 100);

    req.on("close", () => clearInterval(interval));
  });

  const stopSession = (includeSelfImprovements: boolean): RequestHandler => async (req, res) => {
    const sessionId = req.params.sessionId;
    if (typeof sessionId !== "string") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    // Look up the run's id BEFORE unregistering so we can find its child PIDs.
    const activeRun = runs.get(sessionId);
    const runId = activeRun?.runId ?? null;
    // 1. Abort the model read-loop and signal in-flight tools (computer_use's
    //    GUI loop, claude_code's child via its abort listener).
    const ok = runs.abort(sessionId);
    if (ok) activeRun?.cancel?.();
    if (runId) {
      try {
        cancelExplorerTaskIfRunning(db, runId);
      } catch (err) {
        console.warn("[explorer] cancellation record failed:", err instanceof Error ? err.message : err);
      }
    }
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
    // 3. The deliberate global Stop also halts detached self-development. A
    //    session-only interrupt (including voice barge-in) leaves it alone.
    const cancelledImprovements = includeSelfImprovements
      ? cancelAllImprovements(db, "global_stop")
      : 0;
    res.json({ aborted: ok, cancelledImprovements });
  };

  // Voice barge-in/new-turn cancellation is session-scoped. The explicit red
  // Stop uses kill-all so it can still halt detached self-development.
  r.post("/:sessionId/kill", auth, stopSession(false));
  r.post("/:sessionId/kill-all", auth, stopSession(true));

  return r;
}

/**
 * The text of the most recent assistant message that follows the last user
 * message in this session, or null. Used by the stream endpoint when a fast turn
 * finished and unregistered before the client connected: we replay this as the
 * `final` so a late connect still terminates with the answer instead of looping
 * on 404. Requiring it to come AFTER the last user turn avoids replaying a stale
 * reply from a previous exchange when the new turn produced nothing yet.
 */
function latestAssistantAfterLastUser(db: Db, sessionId: string): string | null {
  const msgs = listMessages(db, sessionId);
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.role === "user") { lastUserIdx = i; break; }
  }
  for (let i = msgs.length - 1; i > lastUserIdx; i--) {
    const m = msgs[i]!;
    if (m.role === "assistant" && m.content.trim()) return m.content;
  }
  return null;
}
