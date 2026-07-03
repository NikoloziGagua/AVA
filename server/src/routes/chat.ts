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
import { classifyIntent, classifyTypedIntent } from "../orchestrator/intent-classifier.js";
import { decideGreeting } from "../orchestrator/greeting.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
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
import { buildReadLogsTool } from "../tools/activity-log-mcp.js";
import { buildSelfImproveTool, buildSelfImproveStatusTool, type IntentStatusSummary } from "../tools/self-improve-mcp.js";
import { buildDiscussTools } from "../tools/discuss-mcp.js";
import type { Discussion } from "../state/discussions.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { buildMemoryTools } from "../tools/memory-mcp.js";
import { buildUpdateLogTools } from "../tools/update-log-mcp.js";
import { buildShopifyTools } from "../tools/shopify-mcp.js";
import { buildPlacesTools } from "../tools/places-mcp.js";
import { getReasoningLevel } from "../state/reasoning-pref.js";
import { mapReasoning } from "../orchestrator/reasoning.js";
import { detectCorrection, formatCorrection } from "../orchestrator/correction-detector.js";
import { rememberObservation } from "../memory/remember.js";
import { maybeCapture } from "../playbooks/capture.js";
import { matchPlaybook } from "../playbooks/match.js";
import { loadPlaybookIndex, readPlaybook } from "../playbooks/store.js";
import { bumpUse, recordOutcome } from "../playbooks/mutate.js";
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
  queueSelfImprove?: (goal: string) => string;
  listSelfImprovements?: () => IntentStatusSummary[];
  /** Discuss-with-Claude: queue a background, read-only consult and recount past ones. */
  queueDiscussion?: (topic: string, sessionId: string | null) => string;
  listDiscussions?: () => Discussion[];
  getDiscussion?: (id: string) => Discussion | null;
  logsDir?: string;
  /** Shopify Admin API creds — when present, the shopify_* product tools are offered. */
  shopify?: { store: string; token: string } | null;
  /** Google Places API key — when present, the find_places tool is offered. */
  googlePlacesApiKey?: string | null;
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
    // Which playbook steered this run, if any — its win/loss record and
    // rolling duration are updated when the run ends (recordOutcome below).
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

    const promptForAgent = greeting.prefix + summaryHeader + playbookPrefix + latestUserText;
    const reasoningEffort = agentDeps.provider!.name === "openai"
      ? (parsed.data.voice ? "none" : mapReasoning(getReasoningLevel(db), mode))
      : undefined;

    void (async () => {
      const sid = sessionId!;
      // Collect the run's tool steps so a successful >=2-tool run can be
      // distilled into a reusable playbook (best-effort, fire-and-forget).
      const runSteps: RunStep[] = [];
      const runStartMs = Date.now();
      const emit = (e: AgentEvent) => {
        if (e.kind === "tool_call") {
          runSteps.push({ tool: e.payload.tool, args: e.payload.args, ok: true });
        } else if (e.kind === "tool_result") {
          const s = runSteps[runSteps.length - 1];
          if (s && s.tool === e.payload.tool) s.ok = e.payload.ok;
        }
        // Normalize an empty/whitespace final to a graceful message so we never
        // stream or persist a blank assistant turn (the run did something — the
        // model just produced no closing text).
        if (e.kind === "final" && !e.payload.text.trim()) {
          e = { kind: "final", payload: { text: GRACEFUL_FINAL } };
        }
        if (e.kind === "final") {
          const prov = agentDeps.provider;
          const durationSecs = (Date.now() - runStartMs) / 1000;
          if (prov) {
            void maybeCapture({
              memoryDir: agentDeps.memoryDir,
              provider: prov,
              goal: parsed.data.text,
              steps: runSteps,
              outcome: e.payload.text,
              // "succeeded" = the run delivered a final reply. Mid-run tool
              // failures Ava recovered from are wanted material — the capture
              // gate (shouldCapture) rejects trailing failures and mostly-
              // failed runs, and distill turns recovered detours into lessons.
              succeeded: true,
              durationSecs,
              today: new Date().toISOString().slice(0, 10),
            });
          }
          // Update the steering playbook's track record: reaching a final
          // reply counts as a win for the procedure.
          if (recalledSlug) {
            try { recordOutcome(agentDeps.memoryDir, recalledSlug, { succeeded: true, secs: durationSecs }); }
            catch (err) { console.warn("[playbooks] outcome record failed:", err instanceof Error ? err.message : err); }
            recalledSlug = null; // count each run exactly once
          }
        }
        if ((e.kind === "error" || e.kind === "killed") && recalledSlug) {
          // The recalled playbook steered this run into a wall — count the loss
          // so repeat offenders get demoted out of recall (match.isDemoted).
          try { recordOutcome(agentDeps.memoryDir, recalledSlug, { succeeded: false }); }
          catch (err) { console.warn("[playbooks] outcome record failed:", err instanceof Error ? err.message : err); }
          recalledSlug = null; // a killed run can also emit error — count once
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
            ...buildUpdateLogTools({ dataDir: agentDeps.dataDir }),
            // Standing background checks ("notify me if/when …") — the
            // scheduler re-runs them; Ava just registers/lists/deletes here.
            ...(buildWatchTools({ db }) as ToolDef[]),
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
      } catch (err) {
        // Last-resort guard: an exception escaping the agent loop (e.g. a SQLite
        // write failing inside emit) must end THIS run — not become an unhandled
        // rejection that crashes the whole server mid-task.
        const msg = err instanceof Error ? err.message : String(err);
        try {
          buffer.append({ kind: "error", payload: { message: msg } });
          buffer.append({ kind: "done", payload: {} });
          if (parsed.data.persist !== false) {
            appendMessage(db, { sessionId: sid, role: "assistant", content: `That didn't work, Sir — ${msg}` });
          }
        } catch { /* even the error path failed; finally still unregisters */ }
        console.error("[chat] run crashed:", msg);
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
    // 3. Stop ALSO halts any background self-improvement — a self-improvement isn't
    //    a session run (it runs detached in a worktree), so without this the red
    //    button couldn't reach a runaway self-edit. Cancel them all here.
    const cancelledImprovements = cancelAllImprovements(db);
    res.json({ aborted: ok, cancelledImprovements });
  });

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
