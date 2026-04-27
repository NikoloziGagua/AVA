import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { buildShellMcp } from "../tools/shell-mcp.js";

export type AgentEvent =
  | { kind: "thought"; payload: { text: string } }
  | { kind: "tool_call"; payload: { tool: string; args: unknown } }
  | { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string } }
  | { kind: "final"; payload: { text: string } }
  | { kind: "error"; payload: { message: string } }
  | { kind: "killed"; payload: Record<string, never> }
  | { kind: "done"; payload: Record<string, never> };

export type RunOpts = {
  prompt: string;
  abort: AbortController;
  emit: (e: AgentEvent) => void;
};

export async function runAgent(opts: RunOpts): Promise<void> {
  const { prompt, abort, emit } = opts;

  const shellMcp = buildShellMcp({
    emit: (e) => {
      if (e.kind === "shell.call") {
        emit({ kind: "tool_call", payload: { tool: "shell", args: e.args } });
      } else {
        emit({ kind: "tool_result", payload: { tool: "shell", ok: e.ok, result: e.result } });
      }
    },
    signalForRun: () => abort.signal,
  });

  try {
    const result = query({
      prompt,
      options: {
        abortController: abort,
        systemPrompt: { type: "preset", preset: "claude_code", append: buildSystemPrompt() },
        mcpServers: {
          ava: { type: "sdk", name: "ava", instance: shellMcp as unknown as McpServer },
        },
        // `tools: []` disables ALL built-in claude_code tools (Read/Bash/Edit/etc.).
        // `allowedTools` is only an auto-approval list — without `tools`, the full
        // claude_code preset would still be available to the model.
        tools: [],
        allowedTools: ["mcp__ava__shell"],
      },
    });

    for await (const evt of result) {
      if (abort.signal.aborted) break;
      if (evt.type === "assistant" && Array.isArray(evt.message?.content)) {
        const blocks = evt.message.content;
        // Final-only assistant turns (text without tool_use) are re-emitted by
        // the SDK as `result.result`. Skip them here to avoid duplicate
        // rendering — only emit thoughts for intermediate turns that also call
        // a tool.
        const hasToolUse = blocks.some((b) => b.type === "tool_use");
        if (hasToolUse) {
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              emit({ kind: "thought", payload: { text: block.text } });
            }
          }
        }
      }
      if (evt.type === "result") {
        if (evt.subtype === "success") {
          if (evt.result) emit({ kind: "final", payload: { text: evt.result } });
        } else {
          const errs = evt.errors;
          const detail = errs?.length ? errs.join("; ") : "unknown";
          emit({ kind: "error", payload: { message: `${evt.subtype}: ${detail}` } });
        }
      }
    }

    if (abort.signal.aborted) {
      emit({ kind: "killed", payload: {} });
    } else {
      emit({ kind: "done", payload: {} });
    }
  } catch (e) {
    if (abort.signal.aborted) {
      emit({ kind: "killed", payload: {} });
    } else {
      emit({ kind: "error", payload: { message: String(e instanceof Error ? e.message : e) } });
    }
  }
}
