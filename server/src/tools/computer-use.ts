import type Anthropic from "@anthropic-ai/sdk";

export type ComputerSurface = {
  mouseClick: (x: number, y: number) => Promise<{ ok: boolean; reason?: string }>;
  mouseWheel: (dy: number) => Promise<{ ok: boolean; reason?: string }>;
  keyboardType: (text: string) => Promise<{ ok: boolean; reason?: string }>;
  keyboardPress: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  screenshotBytes: () => Promise<{
    ok: boolean;
    base64?: string;
    path?: string;
    reason?: string;
  }>;
  viewport: () => { width: number; height: number };
};

export type ComputerUseDeps = {
  client: Anthropic;
  surface: ComputerSurface;
  maxIterations?: number;
};

export type ComputerUseResult =
  | { ok: true; summary: string; screenshots: string[] }
  | { ok: false; reason: string };

type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type TextBlock = { type: "text"; text: string };

type ContentBlock = ToolUseBlock | TextBlock | { type: string; [k: string]: unknown };

function imageBlock(base64: string) {
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/png" as const,
      data: base64,
    },
  };
}

export async function runComputerUse(
  deps: ComputerUseDeps,
  args: { task: string },
): Promise<ComputerUseResult> {
  if (!args || typeof args.task !== "string" || args.task.trim().length === 0) {
    return { ok: false, reason: "task required" };
  }

  const { client, surface } = deps;
  const maxIterations = deps.maxIterations ?? 10;
  const screenshots: string[] = [];

  const initial = await surface.screenshotBytes();
  if (!initial.ok || !initial.base64) {
    return { ok: false, reason: initial.reason ?? "initial screenshot failed" };
  }
  if (initial.path) screenshots.push(initial.path);

  const vp = surface.viewport();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: "user",
      content: [
        { type: "text", text: args.task },
        imageBlock(initial.base64),
      ],
    },
  ];

  for (let iter = 0; iter < maxIterations; iter++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await client.beta.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      tools: [
        {
          type: "computer_20250124",
          name: "computer",
          display_width_px: vp.width,
          display_height_px: vp.height,
          display_number: 1,
        },
      ],
      betas: ["computer-use-2025-01-24"],
      messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const content: ContentBlock[] = response.content ?? [];

    if (response.stop_reason === "end_turn") {
      const summary = content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { ok: true, summary, screenshots };
    }

    // Append assistant turn before tool_result.
    messages.push({ role: "assistant", content });

    const toolUses = content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      // No tool_use and not end_turn — collect text and stop.
      const summary = content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { ok: true, summary, screenshots };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];

    for (const tu of toolUses) {
      if (tu.name !== "computer") {
        return { ok: false, reason: `unsupported tool: ${tu.name}` };
      }
      const action = (tu.input as { action?: string }).action;
      switch (action) {
        case "screenshot":
          break; // fresh screenshot taken below
        case "left_click":
        case "click": {
          const coord = (tu.input as { coordinate?: [number, number] }).coordinate;
          if (!coord || coord.length !== 2) {
            return { ok: false, reason: "click missing coordinate" };
          }
          const r = await surface.mouseClick(coord[0], coord[1]);
          if (!r.ok) return { ok: false, reason: r.reason ?? "click failed" };
          break;
        }
        case "type": {
          const text = (tu.input as { text?: string }).text;
          if (typeof text !== "string") {
            return { ok: false, reason: "type missing text" };
          }
          const r = await surface.keyboardType(text);
          if (!r.ok) return { ok: false, reason: r.reason ?? "type failed" };
          break;
        }
        case "key": {
          const text = (tu.input as { text?: string }).text;
          if (typeof text !== "string") {
            return { ok: false, reason: "key missing text" };
          }
          const r = await surface.keyboardPress(text);
          if (!r.ok) return { ok: false, reason: r.reason ?? "key failed" };
          break;
        }
        case "scroll": {
          const dir = (tu.input as { scroll_direction?: string }).scroll_direction;
          const amount = (tu.input as { scroll_amount?: number }).scroll_amount;
          const magnitude = typeof amount === "number" ? amount * 100 : 500;
          const dy = dir === "up" ? -magnitude : magnitude;
          const r = await surface.mouseWheel(dy);
          if (!r.ok) return { ok: false, reason: r.reason ?? "scroll failed" };
          break;
        }
        default:
          return { ok: false, reason: `unsupported action: ${String(action)}` };
      }

      const shot = await surface.screenshotBytes();
      if (!shot.ok || !shot.base64) {
        return { ok: false, reason: shot.reason ?? "screenshot failed" };
      }
      if (shot.path) screenshots.push(shot.path);

      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: [imageBlock(shot.base64)],
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { ok: false, reason: "max iterations reached" };
}
