import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { Chrome } from "./chrome.js";
import { runComputerUse, runComputerUseOpenAI } from "./computer-use.js";

export type ComputerUseToolEvent =
  | { kind: "computer_use.call"; args: unknown }
  | { kind: "computer_use.result"; ok: boolean; result: string };

export type ComputerUseToolDef = {
  tool: Tool;
  run: (
    args: Record<string, unknown>,
    ctx: { runId: string; signal?: AbortSignal },
  ) => Promise<{ text: string; ok: boolean }>;
};

export function buildComputerUseTool(opts: {
  /** Anthropic client (preferred when both are present, since that loop is more battle-tested). */
  anthropic: Anthropic | null;
  /** OpenAI client (used when no Anthropic key is configured). */
  openai: OpenAI | null;
  /**
   * Lazy accessor for the persistent Chromium context. Resolved only after the
   * provider check passes, so the no-key path never boots a browser and merely
   * exposing the tool costs nothing.
   */
  getChrome: () => Promise<Chrome>;
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
    run: async (args, ctx) => {
      opts.emit({ kind: "computer_use.call", args });
      const task = String(args.task ?? "");
      const signal = ctx?.signal;

      if (opts.anthropic) {
        const chrome = await opts.getChrome();
        const r = await runComputerUse(
          { client: opts.anthropic, surface: chrome, signal },
          { task },
        );
        if (!r.ok) {
          opts.emit({ kind: "computer_use.result", ok: false, result: r.reason });
          return { ok: false, text: `error: ${r.reason}` };
        }
        const text = `${r.summary}\n\n[${r.screenshots.length} screenshot(s) saved]`;
        opts.emit({ kind: "computer_use.result", ok: true, result: text });
        return { ok: true, text };
      }

      if (opts.openai) {
        const chrome = await opts.getChrome();
        const r = await runComputerUseOpenAI(
          { client: opts.openai, surface: chrome, signal },
          { task },
        );
        if (!r.ok) {
          opts.emit({ kind: "computer_use.result", ok: false, result: r.reason });
          return { ok: false, text: `error: ${r.reason}` };
        }
        const text = `${r.summary}\n\n[${r.screenshots.length} screenshot(s) saved]`;
        opts.emit({ kind: "computer_use.result", ok: true, result: text });
        return { ok: true, text };
      }

      const text =
        "computer_use unavailable: no Anthropic or OpenAI API key configured. " +
        "Add ANTHROPIC_API_KEY or OPENAI_API_KEY to the server's .env to enable.";
      opts.emit({ kind: "computer_use.result", ok: false, result: text });
      return { ok: false, text };
    },
  };
}
