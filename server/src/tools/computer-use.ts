import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

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
  /** Run's abort signal. Checked before every model turn so the red Stop button
   *  halts the desktop loop promptly instead of running all ≤25 iterations. */
  signal?: AbortSignal;
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

  const { client, surface, signal } = deps;
  const maxIterations = deps.maxIterations ?? 25;
  const screenshots: string[] = [];

  // Bail before any work (screenshot or model call) if Stop already fired.
  if (signal?.aborted) return { ok: false, reason: "interrupted" };

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
    // Stop reaches the GUI loop here: abort between turns so an in-flight
    // computer_use halts promptly instead of finishing all its iterations.
    if (signal?.aborted) return { ok: false, reason: "interrupted" };
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
    } as any, signal ? { signal } : undefined);

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

// ─── OpenAI computer-use-preview ─────────────────────────────────────────────
// Different protocol from Anthropic's tool_use loop. Uses the Responses API:
//   - Tool: { type: "computer_use_preview", display_width, display_height, environment }
//   - Output items include { type: "computer_call", call_id, action, pending_safety_checks }
//   - Response back: { type: "computer_call_output", call_id, output: { type: "input_image", image_url } }
//   - Subsequent turns chain via previous_response_id to avoid resending history.

export type OpenAIComputerUseDeps = {
  client: OpenAI;
  surface: ComputerSurface;
  maxIterations?: number;
  /** Run's abort signal. Checked before every model turn so the red Stop button
   *  halts the desktop loop promptly instead of running all ≤25 iterations. */
  signal?: AbortSignal;
};

type OpenAIAction =
  | { type: "click"; button?: string; x: number; y: number }
  | { type: "double_click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "keypress"; keys: string[] }
  | { type: "scroll"; x: number; y: number; scroll_x: number; scroll_y: number }
  | { type: "screenshot" }
  | { type: "move"; x: number; y: number }
  | { type: "wait"; ms?: number }
  | { type: "drag"; path: Array<{ x: number; y: number }> };

type ComputerCallItem = {
  type: "computer_call";
  call_id: string;
  action: OpenAIAction;
  pending_safety_checks?: Array<{ id: string; code: string; message: string }>;
};

type MessageItem = {
  type: "message";
  content: Array<{ type: string; text?: string }>;
};

type ResponseOutputItem =
  | ComputerCallItem
  | MessageItem
  | { type: "reasoning" }
  | { type: string; [k: string]: unknown };

type ResponsesPayload = {
  id: string;
  output: ResponseOutputItem[];
};

export async function runComputerUseOpenAI(
  deps: OpenAIComputerUseDeps,
  args: { task: string },
): Promise<ComputerUseResult> {
  if (!args || typeof args.task !== "string" || args.task.trim().length === 0) {
    return { ok: false, reason: "task required" };
  }
  const { client, surface, signal } = deps;
  const maxIterations = deps.maxIterations ?? 25;
  const screenshots: string[] = [];

  // Bail before any work (screenshot or model call) if Stop already fired.
  if (signal?.aborted) return { ok: false, reason: "interrupted" };

  const initial = await surface.screenshotBytes();
  if (!initial.ok || !initial.base64) {
    return { ok: false, reason: initial.reason ?? "initial screenshot failed" };
  }
  if (initial.path) screenshots.push(initial.path);
  const vp = surface.viewport();

  const tool = {
    type: "computer_use_preview",
    display_width: vp.width,
    display_height: vp.height,
    environment: "browser",
  };

  // SDK typings often lag the preview API; cast through unknown.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: ResponsesPayload = (await (client as any).responses.create({
    model: "computer-use-preview",
    tools: [tool],
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: args.task },
          { type: "input_image", image_url: `data:image/png;base64,${initial.base64}` },
        ],
      },
    ],
    truncation: "auto",
    reasoning: { summary: "concise" },
  }, signal ? { signal } : undefined)) as ResponsesPayload;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Stop reaches the GUI loop here: abort between turns so an in-flight
    // computer_use halts promptly instead of finishing all its iterations.
    if (signal?.aborted) return { ok: false, reason: "interrupted" };
    const calls = response.output.filter(
      (o): o is ComputerCallItem => (o as { type: string }).type === "computer_call",
    );

    if (calls.length === 0) {
      const messages = response.output.filter(
        (o): o is MessageItem => (o as { type: string }).type === "message",
      );
      const summary = messages
        .flatMap((m) =>
          (m.content ?? [])
            .filter((c) => c.type === "output_text" && typeof c.text === "string")
            .map((c) => c.text as string),
        )
        .join("\n")
        .trim();
      return { ok: true, summary, screenshots };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outputs: any[] = [];
    for (const call of calls) {
      const action = call.action;
      switch (action.type) {
        case "screenshot":
          break;
        case "click":
        case "double_click": {
          const r = await surface.mouseClick(action.x, action.y);
          if (!r.ok) return { ok: false, reason: r.reason ?? "click failed" };
          if (action.type === "double_click") {
            const r2 = await surface.mouseClick(action.x, action.y);
            if (!r2.ok) return { ok: false, reason: r2.reason ?? "second click failed" };
          }
          break;
        }
        case "type": {
          const r = await surface.keyboardType(action.text);
          if (!r.ok) return { ok: false, reason: r.reason ?? "type failed" };
          break;
        }
        case "keypress": {
          for (const key of action.keys) {
            const r = await surface.keyboardPress(key);
            if (!r.ok) return { ok: false, reason: r.reason ?? "keypress failed" };
          }
          break;
        }
        case "scroll": {
          const dy = action.scroll_y;
          if (dy !== 0) {
            const r = await surface.mouseWheel(dy);
            if (!r.ok) return { ok: false, reason: r.reason ?? "scroll failed" };
          }
          break;
        }
        case "wait": {
          const ms = typeof action.ms === "number" ? action.ms : 1000;
          await new Promise((res) => setTimeout(res, Math.min(ms, 5000)));
          break;
        }
        case "move":
          break; // surface has no separate move; subsequent click re-establishes context
        case "drag": {
          const path = action.path;
          if (path.length >= 2) {
            const start = path[0]!;
            const end = path[path.length - 1]!;
            const r1 = await surface.mouseClick(start.x, start.y);
            if (!r1.ok) return { ok: false, reason: r1.reason ?? "drag-start failed" };
            const r2 = await surface.mouseClick(end.x, end.y);
            if (!r2.ok) return { ok: false, reason: r2.reason ?? "drag-end failed" };
          }
          break;
        }
        default:
          return { ok: false, reason: `unsupported openai action: ${(action as { type: string }).type}` };
      }

      const shot = await surface.screenshotBytes();
      if (!shot.ok || !shot.base64) {
        return { ok: false, reason: shot.reason ?? "screenshot failed" };
      }
      if (shot.path) screenshots.push(shot.path);

      outputs.push({
        type: "computer_call_output",
        call_id: call.call_id,
        // Auto-ack pending safety checks. The user is operating their own
        // machine via this tool; outer policy gates approvals.
        ...(call.pending_safety_checks && call.pending_safety_checks.length > 0
          ? { acknowledged_safety_checks: call.pending_safety_checks }
          : {}),
        output: {
          type: "input_image",
          image_url: `data:image/png;base64,${shot.base64}`,
        },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response = (await (client as any).responses.create({
      model: "computer-use-preview",
      previous_response_id: response.id,
      tools: [tool],
      input: outputs,
      truncation: "auto",
    }, signal ? { signal } : undefined)) as ResponsesPayload;
  }

  return { ok: false, reason: "max iterations reached" };
}
