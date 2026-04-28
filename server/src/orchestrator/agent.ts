import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { buildShellMcp } from "../tools/shell-mcp.js";
import { buildAvaMcp, type ToolDef } from "../tools/ava-mcp.js";
import { buildFilesystem } from "../tools/filesystem.js";
import { buildFilesystemTools } from "../tools/filesystem-mcp.js";
import { buildClaudeCode } from "../tools/claude-code.js";
import { buildClaudeCodeTool } from "../tools/claude-code-mcp.js";
import { buildChromeTools } from "../tools/chrome-mcp.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { buildPathAllowlist } from "../security/path-allowlist.js";
import { buildPolicyHook, type PolicyHook } from "../policy/runtime.js";
import type { Db } from "../state/db.js";
import type { Approval } from "../state/approvals.js";

export type AgentEvent =
  | { kind: "thought"; payload: { text: string } }
  | { kind: "tool_call"; payload: { tool: string; args: unknown } }
  | { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string } }
  | { kind: "final"; payload: { text: string } }
  | { kind: "error"; payload: { message: string } }
  | { kind: "killed"; payload: Record<string, never> }
  | { kind: "done"; payload: Record<string, never> }
  | { kind: "approval_required"; payload: { id: string; tool: string; args: unknown; summary: string } }
  | { kind: "approval_resolved"; payload: { id: string; status: "approved" | "denied" | "expired" } };

export type AgentDeps = {
  chrome: Chrome;
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  pushDeliver?: (a: Approval) => Promise<void>;
};

export type RunOpts = {
  prompt: string;
  abort: AbortController;
  emit: (e: AgentEvent) => void;
  runId: string;
  deps: AgentDeps;
  db: Db;
  sessionId: string;
};

const ALL_TOOL_NAMES = [
  "shell",
  "fs_read",
  "fs_write",
  "fs_list",
  "fs_stat",
  "fs_delete",
  "claude_code",
  "chrome_navigate",
  "chrome_click",
  "chrome_type",
  "chrome_press_key",
  "chrome_read_page",
  "chrome_screenshot",
  "chrome_tabs",
];

export async function runAgent(opts: RunOpts): Promise<void> {
  const { prompt, abort, emit, runId, deps } = opts;

  const policy = buildPolicyHook({
    db: opts.db,
    sessionId: opts.sessionId,
    emit: (e) => emit(e),
    pushDeliver: deps.pushDeliver,
  });

  function wrapToolDef(td: ToolDef, hook: PolicyHook): ToolDef {
    return {
      tool: td.tool,
      run: async (args, ctx) => {
        const r = await hook(td.tool.name, args);
        if (!r.allow) {
          emit({ kind: "tool_call", payload: { tool: td.tool.name, args } });
          emit({ kind: "tool_result", payload: { tool: td.tool.name, ok: false, result: r.message } });
          return { ok: false, text: r.message };
        }
        return td.run(args, ctx);
      },
    };
  }

  const shellSrv = buildShellMcp({
    emit: (e) => {
      if (e.kind === "shell.call") {
        emit({ kind: "tool_call", payload: { tool: "shell", args: e.args } });
      } else {
        emit({ kind: "tool_result", payload: { tool: "shell", ok: e.ok, result: e.result } });
      }
    },
    signalForRun: () => abort.signal,
    policyCheck: policy,
  });

  const fs = buildFilesystem({ roots: deps.fsRoots });
  const fsTools: ToolDef[] = buildFilesystemTools({
    fs,
    emit: (e) => {
      if (e.kind === "fs.call")
        emit({ kind: "tool_call", payload: { tool: e.tool, args: e.args } });
      else emit({ kind: "tool_result", payload: { tool: e.tool, ok: e.ok, result: e.result } });
    },
  }) as ToolDef[];

  const cc = buildClaudeCode({
    pidfiles: deps.pidfiles,
    check: buildPathAllowlist({ roots: deps.fsRoots }),
  });
  const ccTool = buildClaudeCodeTool({
    cc,
    emit: (e) => {
      if (e.kind === "claude_code.call")
        emit({ kind: "tool_call", payload: { tool: "claude_code", args: e.args } });
      else
        emit({
          kind: "tool_result",
          payload: { tool: "claude_code", ok: e.ok, result: e.result },
        });
    },
  });

  const chromeTools: ToolDef[] = buildChromeTools({
    chrome: deps.chrome,
    emit: (e) => {
      if (e.kind === "chrome.call")
        emit({ kind: "tool_call", payload: { tool: e.tool, args: e.args } });
      else emit({ kind: "tool_result", payload: { tool: e.tool, ok: e.ok, result: e.result } });
    },
  }) as ToolDef[];

  const wrappedFsTools = fsTools.map((t) => wrapToolDef(t, policy));
  const wrappedCcTool = wrapToolDef(ccTool, policy);
  const wrappedChromeTools = chromeTools.map((t) => wrapToolDef(t, policy));

  const ava = buildAvaMcp({
    ctx: { runId },
    tools: [...wrappedFsTools, wrappedCcTool, ...wrappedChromeTools],
  });

  try {
    const result = query({
      prompt,
      options: {
        abortController: abort,
        systemPrompt: { type: "preset", preset: "claude_code", append: buildSystemPrompt() },
        mcpServers: {
          shell: { type: "sdk", name: "shell", instance: shellSrv as unknown as McpServer },
          ava: { type: "sdk", name: "ava", instance: ava as unknown as McpServer },
        },
        // `tools: []` disables ALL built-in claude_code tools (Read/Bash/Edit/etc.).
        // `allowedTools` is only an auto-approval list — without `tools`, the full
        // claude_code preset would still be available to the model.
        tools: [],
        allowedTools: [
          "mcp__shell__shell",
          ...ALL_TOOL_NAMES.filter((n) => n !== "shell").map((n) => `mcp__ava__${n}`),
        ],
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
      const pids = deps.pidfiles.list(runId);
      const { killTree } = await import("../process/kill-tree.js");
      await Promise.all(pids.map((p) => killTree(p)));
      deps.pidfiles.clear(runId);
      emit({ kind: "killed", payload: {} });
    } else {
      emit({ kind: "done", payload: {} });
    }
  } catch (e) {
    if (abort.signal.aborted) {
      const pids = deps.pidfiles.list(runId);
      const { killTree } = await import("../process/kill-tree.js");
      await Promise.all(pids.map((p) => killTree(p)));
      deps.pidfiles.clear(runId);
      emit({ kind: "killed", payload: {} });
    } else {
      emit({ kind: "error", payload: { message: String(e instanceof Error ? e.message : e) } });
    }
  }
}
