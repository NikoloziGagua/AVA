// MCP tool wrapper for desktop screenshot capture.
//
// Exposes `take_screenshot` to the orchestrator. The model may optionally pass a
// `path`, but it is only honoured if it resolves inside the allowed screenshots
// directory (enforced in `takeScreenshot`); otherwise a timestamped file is
// created under `%USERPROFILE%\Downloads\Ava\screenshots\`.

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { takeScreenshot, type CaptureFn } from "./screenshot.js";

export type ScreenshotToolEvent =
  | { kind: "screenshot.call"; args: unknown }
  | { kind: "screenshot.result"; ok: boolean; result: string };

export type ScreenshotToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;
};

export function buildScreenshotTool(opts: {
  emit?: (e: ScreenshotToolEvent) => void;
  /** Override the capture backend (tests inject a fake). */
  capture?: CaptureFn;
  /** Override the base directory (tests point this at a temp dir). */
  baseDir?: string;
} = {}): ScreenshotToolDef {
  const emit = opts.emit ?? (() => {});
  return {
    tool: {
      name: "take_screenshot",
      description:
        "Capture a PNG screenshot of the current Windows desktop and save it under " +
        "the owner's Downloads/Ava/screenshots folder. Returns the saved file path " +
        "ONLY — you cannot see the captured image through this tool, so never " +
        "describe or make claims about what the screenshot shows. To actually SEE " +
        "and describe what is on screen, use computer_use instead. " +
        "Args: { path?: string } — path is optional and must stay inside the " +
        "screenshots folder; omit it to auto-name the file.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Optional .png output path inside Downloads/Ava/screenshots. Omit to auto-generate.",
          },
        },
      },
    },
    run: async (args) => {
      emit({ kind: "screenshot.call", args });
      const path = typeof args.path === "string" ? args.path : undefined;
      const r = await takeScreenshot({ path, capture: opts.capture, baseDir: opts.baseDir });
      if (!r.ok) {
        const text = `error (${r.error.code}): ${r.error.message}`;
        emit({ kind: "screenshot.result", ok: false, result: text });
        return { ok: false, text };
      }
      const text =
        `Saved screenshot to ${r.path} (${r.bytes} bytes, ${r.mimeType}). ` +
        `Note: you have NOT seen this image — if the owner wants the screen described, use computer_use.`;
      emit({ kind: "screenshot.result", ok: true, result: text });
      return { ok: true, text };
    },
  };
}
