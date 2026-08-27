import { buildSystemPrompt } from "./system-prompt.js";
import { buildToolRegistry } from "./tool-registry.js";
import type { LLMProvider, Message, ProviderUsage, ToolCall } from "./llm/types.js";
import type { ReasoningEffort } from "./reasoning.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import type { ToolVerificationEvidence } from "./verification-evidence.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { buildPolicyHook, type PolicyHook } from "../policy/runtime.js";
import type { Db } from "../state/db.js";
import type { Approval } from "../state/approvals.js";
import { withTimeout, TOOL_BUDGET_MS } from "./timeout.js";
import { createStuckLoop } from "./stuck-loop.js";
import { redactSensitiveArgs } from "./redact.js";
import { loadProjectIndex, detectProject, readProjectFile, type ProjectEntry } from "../memory/project-index.js";
import {
  classifyActionResult,
  worstClass,
  buildConsistencyReminder,
  type ActionResultClass,
} from "./tool-result-consistency.js";
import type { PersonaChannel } from "../persona/runtime.js";

export type AgentEvent =
  | { kind: "thought"; payload: { text: string } }
  | { kind: "delta"; payload: { text: string } }
  | { kind: "tool_call"; payload: { tool: string; args: unknown } }
  | { kind: "tool_result"; payload: {
      tool: string;
      ok: boolean;
      result: string;
      verification?: ToolVerificationEvidence;
    } }
  | { kind: "final"; payload: { text: string } }
  | { kind: "error"; payload: { message: string } }
  | { kind: "killed"; payload: { reason?: "stuck" | "manual" } }
  | { kind: "done"; payload: Record<string, never> }
  | { kind: "approval_required"; payload: { id: string; tool: string; args: unknown; summary: string } }
  | { kind: "approval_resolved"; payload: { id: string; status: "approved" | "denied" | "expired" } };

export type AgentDeps = {
  /**
   * Null in conversation mode — the chat route skips the Chromium boot wait
   * when no tools will be dispatched. The orchestrator never reads this
   * directly; tool builders close over chrome at construction time and
   * land in `deps.tools` already bound.
   */
  chrome: Chrome | null;
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  memoryDir: string;
  pushDeliver?: (a: Approval) => Promise<void>;
  /** Fire-and-forget push when an action run that did real work finishes. */
  notifyDone?: (summary: string) => void;
  provider: LLMProvider;
  tools: ToolDef[];
};

export type RunOpts = {
  /** The latest user turn — becomes the final user message in the messages array. */
  prompt: string;
  /**
   * Prior conversation history (from oldest to newest, excluding the current
   * user turn). Passed as a real Message[] so the provider can cache the
   * stable prefix across turns instead of re-prefilling a concatenated blob.
   */
  priorMessages?: Message[];
  abort: AbortController;
  emit: (e: AgentEvent) => void;
  runId: string;
  deps: AgentDeps;
  db: Db;
  sessionId: string;
  /**
   * "conversation": no tools exposed, side model used. The persona's
   * conversation-mode bias is enforced by withholding tools entirely.
   * "action" (default): full tool registry + orchestrator model.
   */
  mode?: "conversation" | "action";
  /**
   * Per-call override for OpenAI reasoning effort. Falls back to the per-mode
   * default (conversation=minimal, action=low) when undefined.
   */
  reasoningEffort?: ReasoningEffort;
  /** Provider-reported usage is accounting data, not conversational output. */
  recordUsage?: (usage: ProviderUsage) => void;
  /** Literal current turn used only to select a closed delivery register. */
  personaContext?: { userText: string; channel: PersonaChannel };
};

export async function runAgent(opts: RunOpts): Promise<void> {
  const { prompt, abort, runId, deps } = opts;
  const stuckLoop = createStuckLoop();
  const innerEmit = opts.emit;
  let stuckReason: "stuck" | undefined = undefined;
  const emit = (e: AgentEvent) => {
    innerEmit(e);
    // Both reasoning `thought`s and streamed `delta` text count as "the model is
    // making progress" for the stuck-loop. Streamed reply text used to ride the
    // `thought` kind (and thus reset the no-progress timer); now it rides `delta`,
    // so observe both to keep the identical anti-loop behavior.
    if (e.kind === "thought" || e.kind === "delta") stuckLoop.observeThought(e.payload.text);
    else if (e.kind === "tool_result") {
      const r = stuckLoop.observe({
        tool: e.payload.tool,
        resultText: e.payload.result,
        at: Date.now(),
      });
      if (r.halt && !abort.signal.aborted) {
        innerEmit({ kind: "thought",
          payload: { text: "I've been trying for a while without progress, Sir. Halting." } });
        stuckReason = "stuck";
        abort.abort();
      }
    }
  };

  const policy: PolicyHook = buildPolicyHook({
    db: opts.db, sessionId: opts.sessionId, emit,
    pushDeliver: deps.pushDeliver,
    // Stop during a pending approval must cancel, not auto-approve: the signal
    // resolves the veto-window wait immediately as expired.
    signal: abort.signal,
  });

  const mode = opts.mode ?? "action";
  const projectIndex = loadProjectIndex(deps.memoryDir);
  const initialProject = detectProject(prompt, projectIndex);
  const initialProjectContext = initialProject
    ? readProjectFile(deps.memoryDir, initialProject.slug)
    : "";
  const system = buildSystemPrompt({
    memoryDir: deps.memoryDir,
    projectContext: initialProjectContext,
    mode,
    fsRoots: deps.fsRoots,
    personaContext: opts.personaContext,
  });
  let loadedProjectSlug: string | null = initialProject?.slug ?? null;
  // Pass the run's abort signal into every tool's ctx so the red Stop button
  // (which calls abort()) reaches tools already executing — claude_code's child
  // process and computer_use's desktop loop — not just the model read-loop.
  const registry = buildToolRegistry({ tools: deps.tools, ctx: { runId, signal: abort.signal } });
  const allTools = registry.toolDefinitions();
  // Conversation mode hides tools entirely so the side model can't try to call
  // them. Persona/system prompt stays byte-stable in both modes for cache hits.
  const tools = mode === "conversation" ? [] : allTools;
  const model = mode === "conversation"
    ? deps.provider.defaultSideModel
    : deps.provider.defaultOrchestratorModel;

  const messages: Message[] = [
    ...(opts.priorMessages ?? []),
    { role: "user", content: prompt },
  ];
  let finalText = "";
  let toolsUsed = 0;
  let killed = false;
  // Backstop for a truly runaway loop — NOT a task budget. Real tasks (multi-item
  // edits, browsing many pages) are turn-hungry and must never be cut off mid-work:
  // a 48-turn cap couldn't even finish one Shopify product edit. The actual brakes
  // are the Stop button (aborts in <=1 turn), the 5-min no-progress stuck-loop
  // detector, per-tool timeouts, and approval gates — so this is set high
  // (effectively unlimited for human-scale tasks) and is env-overridable. On
  // exhaustion we still emit a graceful final below rather than ending silently.
  const MAX_AGENT_TURNS = Number(process.env.AVA_MAX_AGENT_TURNS) || 1000;
  let concluded = false;
  const concludeCancelled = () => {
    if (killed) return;
    emit({ kind: "killed", payload: stuckReason ? { reason: stuckReason } : { reason: "manual" } });
    concluded = true;
    killed = true;
  };

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    if (abort.signal.aborted) {
      concludeCancelled();
      break;
    }
    let assistantText = "";
    const pendingCalls: ToolCall[] = [];
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error" = "end_turn";

    // ── Delta coalescer (per turn) ──────────────────────────────────────────
    // The provider yields one `delta` per model token. Emitting an SSE event per
    // token floods the replay buffer (and the wire). Instead we batch tokens and
    // flush a coalesced `delta` AgentEvent on a WORD/whitespace boundary OR after
    // a ~50ms window — whichever trips first — so the frontend receives whole
    // words at a human cadence (a long reply becomes tens-to-low-hundreds of
    // events, not thousands). `deltaBuf`/`deltaTimer` are scoped INSIDE this turn
    // loop so turn N's tail can never bleed into turn N+1.
    let deltaBuf = "";
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;
    const flushDelta = () => {
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
      if (deltaBuf) { emit({ kind: "delta", payload: { text: deltaBuf } }); deltaBuf = ""; }
    };

    try {
      for await (const ev of deps.provider.stream({
        model,
        system, messages, tools, abort: abort.signal,
        reasoningEffort: opts.reasoningEffort
          ?? (mode === "conversation" ? "none" : "low"),
      })) {
        if (ev.kind === "delta") {
          assistantText += ev.text;
          deltaBuf += ev.text;
          // Flush whole words promptly; otherwise cap latency with a short timer
          // so a long token-less stretch still streams within ~50ms.
          if (/\s$/.test(ev.text) || deltaBuf.length >= 24) {
            flushDelta();
          } else if (!deltaTimer) {
            deltaTimer = setTimeout(flushDelta, 50);
          }
        } else if (ev.kind === "tool_call") {
          // Order guarantee: any streamed prose must land BEFORE the tool chip in
          // the ordered replay buffer, so the client never re-reveals text after
          // a tool event.
          flushDelta();
          pendingCalls.push(ev.call);
        } else if (ev.kind === "usage") {
          // Keep accounting out of the user-facing event grammar while still
          // making real provider usage visible in Mission Control. Telemetry
          // can never fail the response it observes.
          try { opts.recordUsage?.(ev.usage); } catch { /* observation only */ }
        } else if (ev.kind === "done") {
          stopReason = ev.stop_reason;
          if (ev.stop_reason === "error") {
            flushDelta();
            emit({ kind: "error", payload: { message: ev.error ?? "stream error" } });
            return;
          }
        }
      }
    } catch (err) {
      flushDelta();
      if (abort.signal.aborted) {
        concludeCancelled();
        break;
      }
      emit({ kind: "error", payload: { message: err instanceof Error ? err.message : String(err) } });
      return;
    }

    // Drain the last partial word so the tail is never stranded after `final`.
    // This runs BEFORE every stopReason branch below (abort/max_tokens/end_turn),
    // guaranteeing all of this turn's deltas precede its `final`/`killed`.
    flushDelta();

    if (stopReason === "abort" || abort.signal.aborted) {
      concludeCancelled();
      break;
    }

    // Phase 1: surface max_tokens as a visible thought; future work can request continuation.
    if (stopReason === "max_tokens") {
      emit({ kind: "thought", payload: { text: "[response truncated by token limit]" } });
      finalText = assistantText;
      emit({ kind: "final", payload: { text: finalText } });
      concluded = true;
      break;
    }

    if (stopReason === "end_turn" || pendingCalls.length === 0) {
      finalText = assistantText;
      emit({ kind: "final", payload: { text: finalText } });
      concluded = true;
      break;
    }

    messages.push({ role: "assistant", content: assistantText, tool_calls: pendingCalls });

    // Track how each action-tool result for this turn classifies, so we can
    // stop the model from claiming success after a failure or partial result.
    const turnResultClasses: ActionResultClass[] = [];

    for (const call of pendingCalls) {
      if (abort.signal.aborted) break;
      // Emit REDACTED args: the event stream feeds the UI, transcripts, and
      // playbook capture — none of which may see credentials (instagram_login).
      // The tool itself dispatches with the raw args below.
      emit({ kind: "tool_call", payload: { tool: call.name, args: redactSensitiveArgs(call.args) } });

      const detected = detectProjectInArgs(call.args, projectIndex);
      if (detected && detected.slug !== loadedProjectSlug) {
        const body = readProjectFile(deps.memoryDir, detected.slug);
        if (body) {
          messages.push({
            role: "user",
            content: `[PROJECT CONTEXT — ${detected.slug}]\n${body}`,
          });
        }
        loadedProjectSlug = detected.slug;
      }

      const decision = await policy(call.name, call.args);
      // policy() can block for the full veto window. If Stop fired during it, bail
      // before dispatching — otherwise a cancelled run still executes this tool.
      if (abort.signal.aborted) break;
      if (!decision.allow) {
        const result = { call_id: call.id, output: decision.message, is_error: true };
        emit({ kind: "tool_result", payload: { tool: call.name, ok: false, result: result.output } });
        messages.push({ role: "tool", content: result });
        turnResultClasses.push(classifyActionResult(result));
        continue;
      }
      toolsUsed++;

      const budget = TOOL_BUDGET_MS[call.name] ?? 30_000;
      // Per-dispatch abort: a budget timeout must CANCEL the in-flight work
      // (computer_use's inner vision loop kept clicking the shared browser and
      // spending API credits after withTimeout had already rejected). The
      // call-scoped controller follows the run's Stop signal AND fires on
      // timeout; tools see it as ctx.signal.
      const callAbort = new AbortController();
      const onRunAbort = () => callAbort.abort();
      abort.signal.addEventListener("abort", onRunAbort, { once: true });
      try {
        // Final guard immediately before dispatch: covers a Stop that lands in the
        // narrow gap between the policy decision and the tool actually running.
        if (abort.signal.aborted) break;
        const r = await withTimeout(registry.dispatch(call, callAbort.signal), budget, call.name);
        // A cooperative tool may resolve with an "aborted" result after Stop.
        // Cancellation is a lifecycle event, not a failed tool outcome: do not
        // poison the receipt or ask the model for another turn.
        if (abort.signal.aborted) break;
        emit({
          kind: "tool_result",
          payload: {
            tool: call.name,
            ok: !r.is_error,
            result: r.output,
            ...(r.verification ? { verification: r.verification } : {}),
          },
        });
        messages.push({ role: "tool", content: r });
        turnResultClasses.push(classifyActionResult(r));
      } catch (err) {
        callAbort.abort();
        if (abort.signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        emit({ kind: "tool_result", payload: { tool: call.name, ok: false, result: msg } });
        messages.push({ role: "tool", content: { call_id: call.id, output: msg, is_error: true } });
        turnResultClasses.push("error");
      } finally {
        abort.signal.removeEventListener("abort", onRunAbort);
      }
    }

    if (abort.signal.aborted) {
      concludeCancelled();
      break;
    }

    // Before the next turn generates the model's wording, if any action-tool
    // result this turn failed or was only partial/uncertain, inject a final
    // reminder that forbids claiming completion/success and requires an honest
    // report of the failure and any partial progress.
    const worst = worstClass(turnResultClasses);
    if (worst !== "ok") {
      messages.push({ role: "user", content: buildConsistencyReminder(worst) });
    }
  }

  if (!concluded) {
    // Turn budget exhausted before the model concluded. Never leave the user
    // with nothing: emit a final so a response is shown and persisted, and the
    // run can be picked up again.
    emit({
      kind: "final",
      payload: {
        text: finalText
          || "I reached my step limit before finishing this, Sir — I made progress but didn't complete it in one run. Tell me to continue and I'll pick up where I left off.",
      },
    });
  }
  // Proactively ping Sir when an action run that actually did work wraps up — so
  // a long/background task tells him it's done instead of finishing quietly.
  if (mode === "action" && toolsUsed > 0 && !killed && deps.notifyDone) {
    try { deps.notifyDone(finalText.trim().slice(0, 140) || "Task complete."); } catch { /* push is best-effort */ }
  }
  emit({ kind: "done", payload: {} });
}

/**
 * Recursively flatten string values from a tool-call args object and run them
 * through detectProject. Returns the longest-matching project, or null. We
 * walk the whole tree because args may carry path-bearing fields under any
 * name (path, cwd, args[*], file, etc.).
 */
function detectProjectInArgs(args: unknown, index: ProjectEntry[]): ProjectEntry | null {
  if (index.length === 0) return null;
  const haystack = collectStrings(args).join(" ");
  if (!haystack) return null;
  return detectProject(haystack, index);
}

function collectStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(collectStrings);
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(collectStrings);
  return [];
}
