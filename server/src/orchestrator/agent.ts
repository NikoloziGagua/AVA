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

  let lastTextChunk = "";
  try {
    const result = query({
      prompt,
      options: {
        abortController: abort,
        systemPrompt: { type: "preset", preset: "claude_code", append: buildSystemPrompt() },
        mcpServers: {
          ava: { type: "sdk", name: "ava", instance: shellMcp as unknown as McpServer },
        },
        allowedTools: ["mcp__ava__shell"],
      },
    });

    for await (const evt of result) {
      if (abort.signal.aborted) break;
      if (evt.type === "assistant" && Array.isArray(evt.message?.content)) {
        for (const block of evt.message.content) {
          if (block.type === "text") {
            const text = block.text;
            if (text && text !== lastTextChunk) {
              emit({ kind: "thought", payload: { text } });
              lastTextChunk = text;
            }
          }
        }
      }
      if (evt.type === "result") {
        const finalText = (evt as { result?: string }).result ?? "";
        if (finalText) emit({ kind: "final", payload: { text: finalText } });
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
