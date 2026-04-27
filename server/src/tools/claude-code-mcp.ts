// server/src/tools/claude-code-mcp.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ClaudeCode } from "./claude-code.js";

export type ClaudeCodeToolEvent =
  | { kind: "claude_code.call"; args: unknown }
  | { kind: "claude_code.result"; ok: boolean; result: string };

export type ClaudeCodeToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>, ctx: { runId: string }) => Promise<{ text: string; ok: boolean }>;
};

export function buildClaudeCodeTool(opts: {
  cc: ClaudeCode;
  emit: (e: ClaudeCodeToolEvent) => void;
}): ClaudeCodeToolDef {
  return {
    tool: {
      name: "claude_code",
      description:
        "Spawn a Claude Code worker on a project directory. cwd must be allowlisted. Returns the worker's combined stdout/stderr after exit. Use for actual code edits — not for free-form chat.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Task for the worker, in English." },
          cwd: { type: "string", description: "Absolute project path (must be allowlisted)." },
          model: { type: "string", description: "Optional model override (e.g. 'claude-sonnet-4-6')." },
        },
        required: ["prompt", "cwd"],
      },
    },
    run: async (args, ctx) => {
      opts.emit({ kind: "claude_code.call", args });
      const r = await opts.cc.run({
        prompt: String(args.prompt ?? ""),
        cwd: String(args.cwd ?? ""),
        model: typeof args.model === "string" ? args.model : undefined,
        runId: ctx.runId,
      });
      if (r.ok) {
        const summary = `EXIT ${r.exitCode}\n${r.output}`;
        opts.emit({ kind: "claude_code.result", ok: true, result: summary });
        return { ok: true, text: summary };
      }
      const err = `error: ${r.reason}`;
      opts.emit({ kind: "claude_code.result", ok: false, result: err });
      return { ok: false, text: err };
    },
  };
}
