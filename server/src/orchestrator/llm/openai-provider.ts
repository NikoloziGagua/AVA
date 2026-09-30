import type OpenAI from "openai";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput, Message, ToolCall, ToolDefinition,
} from "./types.js";

// ─── Responses API shapes ────────────────────────────────────────────────────
// The OpenAI Responses API uses a different request/response shape than
// chat-completions. Inputs are an array of "items" rather than messages:
//   - { role: "user" | "assistant", content: string }      regular text turn
//   - { type: "function_call", call_id, name, arguments }  prior assistant tool call
//   - { type: "function_call_output", call_id, output }    prior tool result
// Tools are flat ({type: "function", name, description, parameters}) instead
// of the chat-completions nested {function: {...}} shape. Reasoning is
// configured via reasoning.effort instead of the top-level reasoning_effort.
//
// The streaming events differ too — see stream() for the event-type handling.

type ResponsesInputItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

function toResponsesInput(messages: Message[]): ResponsesInputItem[] {
  const out: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      // Plain assistant text (if any) followed by separate function_call items
      if (m.content) {
        out.push({ role: "assistant", content: m.content });
      }
      if (m.tool_calls) {
        for (const c of m.tool_calls) {
          out.push({
            type: "function_call",
            call_id: c.id,
            name: c.name,
            arguments: JSON.stringify(c.args),
          });
        }
      }
    } else {
      out.push({
        type: "function_call_output",
        call_id: m.content.call_id,
        output: typeof m.content.output === "string"
          ? m.content.output
          : JSON.stringify(m.content.output),
      });
    }
  }
  return out;
}

function toResponsesTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

// Map our internal effort vocabulary onto the values the OpenAI Responses API
// actually accepts. gpt-5 supports only minimal | low | medium | high, so our
// "none" (least reasoning) floors to "minimal" and "xhigh" caps to "high".
// Passing "none" raw returns a 400 ("Unsupported value: 'none'") — which is
// silent death for any caller that swallows errors (e.g. playbook capture).
function toOpenAIEffort(
  model: string,
  effort: "none" | "low" | "medium" | "high" | "xhigh",
): "none" | "minimal" | "low" | "medium" | "high" {
  switch (effort) {
    // GPT-5.6 uses the current `none` spelling; older GPT-5 models used
    // `minimal`. Keep explicit-model compatibility for side jobs/tests.
    case "none": return model.startsWith("gpt-5.6") ? "none" : "minimal";
    case "xhigh": return "high";
    default: return effort;
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  // GPT-5.6 Sol is the current flagship and drives AVA's tool/action agent.
  // Luna handles tiny titles/summaries economically without downgrading the
  // model generation.
  readonly defaultOrchestratorModel = "gpt-5.6";
  readonly defaultSideModel = "gpt-5.6-luna";
  private client: OpenAI;

  constructor(opts: { client: OpenAI }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    // Responses API. SDK typings sometimes lag; cast through unknown.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (await (this.client as any).responses.create({
      model: input.model,
      max_output_tokens: input.maxTokens,
      instructions: input.system,
      input: input.user,
      // complete() is only used for side work (titles, summaries, chip labels,
      // playbook distill). Without this, gpt-5.x defaults to MEDIUM reasoning —
      // burning thinking tokens on a 32-token title and sometimes eating the
      // whole maxTokens budget as reasoning before any text.
      reasoning: { effort: input.model.startsWith("gpt-5.6") ? "none" : "minimal" },
    })) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };

    const messages = (r.output ?? []).filter((o) => o.type === "message");
    return messages
      .flatMap((m) =>
        (m.content ?? [])
          .filter((c) => c.type === "output_text" && typeof c.text === "string")
          .map((c) => c.text as string),
      )
      .join("");
  }

  async *stream(input: StreamInput): AsyncIterable<StreamEvent> {
    if (input.abort.aborted) {
      yield { kind: "done", stop_reason: "abort" };
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (await (this.client as any).responses.create({
      model: input.model,
      stream: true,
      instructions: input.system,
      input: toResponsesInput(input.messages),
      // Routing affinity for OpenAI's automatic prompt caching: keeps this
      // app's requests on the same cache shard so the stable prefix actually
      // hits. No behavior change.
      prompt_cache_key: "ava-main",
      ...(input.tools.length ? { tools: toResponsesTools(input.tools) } : {}),
      ...(input.reasoningEffort
        ? { reasoning: { effort: toOpenAIEffort(input.model, input.reasoningEffort) } }
        : {}),
    }, { signal: input.abort })) as AsyncIterable<ResponsesStreamEvent>;

    // Accumulate function_call argument chunks by item id.
    const toolCallById = new Map<string, { name: string; callId: string; argsBuf: string }>();
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error" = "end_turn";
    let sawToolCall = false;

    try {
      for await (const event of stream) {
        if (input.abort.aborted) {
          stopReason = "abort";
          break;
        }
        const type = event.type;

        if (type === "response.output_text.delta") {
          if (typeof event.delta === "string") {
            yield { kind: "delta", text: event.delta };
          }
          continue;
        }

        if (type === "response.output_item.added") {
          const item = event.item;
          if (item?.type === "function_call") {
            const itemId = item.id ?? item.call_id ?? "";
            const callId = item.call_id ?? item.id ?? "";
            toolCallById.set(itemId, {
              name: item.name ?? "",
              callId,
              argsBuf: item.arguments ?? "",
            });
          }
          continue;
        }

        if (type === "response.function_call_arguments.delta") {
          const slot = toolCallById.get(event.item_id ?? "");
          if (slot && typeof event.delta === "string") {
            slot.argsBuf += event.delta;
          }
          continue;
        }

        if (type === "response.function_call_arguments.done") {
          const slot = toolCallById.get(event.item_id ?? "");
          if (slot && typeof event.arguments === "string") {
            // Prefer the final-arguments string from the server when supplied.
            slot.argsBuf = event.arguments;
          }
          continue;
        }

        if (type === "response.output_item.done") {
          const item = event.item;
          if (item?.type === "function_call") {
            sawToolCall = true;
            const itemId = item.id ?? item.call_id ?? "";
            const slot = toolCallById.get(itemId);
            const argsStr = slot?.argsBuf || item.arguments || "{}";
            let parsed: unknown = {};
            try { parsed = JSON.parse(argsStr || "{}"); }
            catch { parsed = { _raw: argsStr }; }
            const callId = slot?.callId || item.call_id || item.id || "";
            const name = item.name ?? slot?.name ?? "";
            const call: ToolCall = { id: callId, name, args: parsed };
            yield { kind: "tool_call", call };
          }
          continue;
        }

        if (type === "response.reasoning_summary_text.delta") {
          // Surface reasoning summaries as thoughts so the chat UI can render
          // a "thinking" caption while gpt-5.x is reasoning.
          if (typeof event.delta === "string") {
            yield { kind: "thought", text: event.delta };
          }
          continue;
        }

        if (type === "response.completed") {
          const status = event.response?.status;
          const usage = event.response?.usage;
          if (usage) {
            yield {
              kind: "usage",
              usage: {
                providerRequestId: event.response?.id ?? null,
                model: event.response?.model ?? input.model,
                inputTokens: usage.input_tokens ?? 0,
                outputTokens: usage.output_tokens ?? 0,
                cachedTokens: usage.input_tokens_details?.cached_tokens ?? 0,
              },
            };
          }
          if (status === "incomplete") {
            stopReason = "max_tokens";
          } else {
            stopReason = sawToolCall ? "tool_use" : "end_turn";
          }
          continue;
        }

        if (type === "response.failed" || type === "error" || type === "response.error") {
          const msg = event.error?.message ?? event.message ?? "stream error";
          yield { kind: "done", stop_reason: "error", error: msg };
          return;
        }
        // All other event types (response.created, response.in_progress,
        // response.output_text.done, response.content_part.*, etc.) are not
        // material for our agent loop and are intentionally ignored.
      }
    } catch (err) {
      yield { kind: "done", stop_reason: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    yield { kind: "done", stop_reason: stopReason };
  }
}

// ─── Stream event shapes (loose; SDK typings lag the API) ────────────────────

type ResponsesStreamEvent = {
  type: string;
  delta?: string;
  arguments?: string;
  item_id?: string;
  item?: {
    type: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: {
    id?: string;
    model?: string;
    status?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  error?: { message?: string };
  message?: string;
};
