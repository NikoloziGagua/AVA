import { buildSystemPrompt } from "./system-prompt.js";
import { buildToolRegistry } from "./tool-registry.js";
import type { LLMProvider, Message, ToolCall } from "./llm/types.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { buildPolicyHook, type PolicyHook } from "../policy/runtime.js";
import type { Db } from "../state/db.js";
import type { Approval } from "../state/approvals.js";
import { withTimeout, TOOL_BUDGET_MS } from "./timeout.js";
import { createStuckLoop } from "./stuck-loop.js";
import { loadProjectIndex, detectProject, readProjectFile, type ProjectEntry } from "../memory/project-index.js";

export type AgentEvent =
  | { kind: "thought"; payload: { text: string } }
  | { kind: "tool_call"; payload: { tool: string; args: unknown } }
  | { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string } }
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
};

export async function runAgent(opts: RunOpts): Promise<void> {
  const { prompt, abort, runId, deps } = opts;
  const stuckLoop = createStuckLoop();
  const innerEmit = opts.emit;
  let stuckReason: "stuck" | undefined = undefined;
  const emit = (e: AgentEvent) => {
    innerEmit(e);
    if (e.kind === "thought") stuckLoop.observeThought(e.payload.text);
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
  });
  let loadedProjectSlug: string | null = initialProject?.slug ?? null;
  const registry = buildToolRegistry({ tools: deps.tools, ctx: { runId } });
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

  for (let turn = 0; turn < 32; turn++) {
    if (abort.signal.aborted) break;
    let assistantText = "";
    const pendingCalls: ToolCall[] = [];
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error" = "end_turn";

    try {
      for await (const ev of deps.provider.stream({
        model,
        system, messages, tools, abort: abort.signal,
      })) {
        if (ev.kind === "delta") {
          assistantText += ev.text;
          emit({ kind: "thought", payload: { text: ev.text } });
        } else if (ev.kind === "tool_call") {
          pendingCalls.push(ev.call);
        } else if (ev.kind === "done") {
          stopReason = ev.stop_reason;
          if (ev.stop_reason === "error") {
            emit({ kind: "error", payload: { message: ev.error ?? "stream error" } });
            return;
          }
        }
      }
    } catch (err) {
      emit({ kind: "error", payload: { message: err instanceof Error ? err.message : String(err) } });
      return;
    }

    if (stopReason === "abort" || abort.signal.aborted) {
      emit({ kind: "killed", payload: stuckReason ? { reason: stuckReason } : { reason: "manual" } });
      break;
    }

    // Phase 1: surface max_tokens as a visible thought; future work can request continuation.
    if (stopReason === "max_tokens") {
      emit({ kind: "thought", payload: { text: "[response truncated by token limit]" } });
      finalText = assistantText;
      emit({ kind: "final", payload: { text: finalText } });
      break;
    }

    if (stopReason === "end_turn" || pendingCalls.length === 0) {
      finalText = assistantText;
      emit({ kind: "final", payload: { text: finalText } });
      break;
    }

    messages.push({ role: "assistant", content: assistantText, tool_calls: pendingCalls });

    for (const call of pendingCalls) {
      if (abort.signal.aborted) break;
      emit({ kind: "tool_call", payload: { tool: call.name, args: call.args } });

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
      if (!decision.allow) {
        const result = { call_id: call.id, output: decision.message, is_error: true };
        emit({ kind: "tool_result", payload: { tool: call.name, ok: false, result: result.output } });
        messages.push({ role: "tool", content: result });
        continue;
      }

      const budget = TOOL_BUDGET_MS[call.name] ?? 30_000;
      try {
        const r = await withTimeout(registry.dispatch(call), budget, call.name);
        emit({ kind: "tool_result", payload: { tool: call.name, ok: !r.is_error, result: r.output } });
        messages.push({ role: "tool", content: r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ kind: "tool_result", payload: { tool: call.name, ok: false, result: msg } });
        messages.push({ role: "tool", content: { call_id: call.id, output: msg, is_error: true } });
      }
    }
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
