import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type Anthropic from "@anthropic-ai/sdk";
import type { Chrome } from "./chrome.js";
import { runComputerUse } from "./computer-use.js";

export type ComputerUseToolEvent =
  | { kind: "computer_use.call"; args: unknown }
  | { kind: "computer_use.result"; ok: boolean; result: string };

export type ComputerUseToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;
};

export function buildComputerUseTool(opts: {
  client: Anthropic | null;
  chrome: Chrome;
  emit: (e: ComputerUseToolEvent) => void;
}): ComputerUseToolDef {
  return {
    tool: {
      name: "computer_use",
      description:
        "Drive the active Chrome browser tab using vision + clicks. Best for tasks that need visual reasoning over a webpage. Args: { task: string }.",
      inputSchema: {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
      },
    },
    run: async (args) => {
      opts.emit({ kind: "computer_use.call", args });
      if (!opts.client) {
        const text = "computer_use unavailable: no Anthropic API key configured";
        opts.emit({ kind: "computer_use.result", ok: false, result: text });
        return { ok: false, text };
      }
      const task = String(args.task ?? "");
      const r = await runComputerUse(
        { client: opts.client, surface: opts.chrome },
        { task },
      );
      if (!r.ok) {
        opts.emit({ kind: "computer_use.result", ok: false, result: r.reason });
        return { ok: false, text: `error: ${r.reason}` };
      }
      const text = `${r.summary}\n\n[${r.screenshots.length} screenshot(s) saved]`;
      opts.emit({ kind: "computer_use.result", ok: true, result: text });
      return { ok: true, text };
    },
  };
}
