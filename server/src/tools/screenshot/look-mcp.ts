// `look_at_screen` — Ava's honest eyes for the desktop.
//
// take_screenshot only saves a PNG (the model never sees it), and the full
// computer_use loop needs OpenAI's gated `computer-use-preview` model, which
// not every account has. This tool covers the everyday case: capture the
// desktop and run ONE vision call on a standard multimodal model so Ava can
// truthfully describe/verify what is on screen.

import type OpenAI from "openai";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { promises as fsp } from "node:fs";
import { takeScreenshot, type CaptureFn } from "./screenshot.js";

export type LookToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;
};

export function buildLookAtScreenTool(opts: {
  openai: OpenAI;
  /** Vision-capable model for the one-shot describe call. */
  model?: string;
  /** Override the capture backend (tests inject a fake). */
  capture?: CaptureFn;
  /** Override the base directory (tests point this at a temp dir). */
  baseDir?: string;
}): LookToolDef {
  const model = opts.model ?? "gpt-5";
  return {
    tool: {
      name: "look_at_screen",
      description:
        "Capture the current Windows desktop AND actually look at it: the image " +
        "is analyzed by a vision model and a factual description comes back. Use " +
        "this to describe the screen, check whether something rendered/finished, " +
        "or verify the visual result of an action. Args: { question?: string } — " +
        "an optional specific question about the screen (default: describe it).",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Optional specific question to answer about the screen.",
          },
        },
      },
    },
    run: async (args) => {
      const shot = await takeScreenshot({ capture: opts.capture, baseDir: opts.baseDir });
      if (!shot.ok) {
        return { ok: false, text: `screenshot failed (${shot.error.code}): ${shot.error.message}` };
      }
      const png = await fsp.readFile(shot.path);
      const question = typeof args.question === "string" && args.question.trim()
        ? args.question.trim()
        : "Describe what is visible on this screen, briefly and factually.";
      const messages = [{
        role: "user" as const,
        content: [
          { type: "text" as const, text: `${question} Answer in 2-4 factual sentences. If something is ambiguous, say so rather than guessing.` },
          { type: "image_url" as const, image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
        ],
      }];
      // Reasoning-family models spend from the completion budget on hidden
      // reasoning tokens first — a small cap yields an EMPTY visible answer.
      // Big cap + minimal effort keeps this one-shot describe call fast; if
      // the model rejects the effort knob, retry without it.
      let resp;
      try {
        resp = await opts.openai.chat.completions.create({
          model, messages, max_completion_tokens: 2000,
          reasoning_effort: "low",
        } as Parameters<typeof opts.openai.chat.completions.create>[0]) as OpenAI.Chat.ChatCompletion;
      } catch {
        resp = await opts.openai.chat.completions.create({
          model, messages, max_completion_tokens: 2000,
        }) as OpenAI.Chat.ChatCompletion;
      }
      const choice = resp.choices[0];
      const answer = choice?.message?.content?.trim();
      if (!answer) {
        return { ok: false, text: `vision model returned no text (finish_reason=${choice?.finish_reason ?? "?"})` };
      }
      return { ok: true, text: `[saved to ${shot.path}]\n${answer}` };
    },
  };
}
