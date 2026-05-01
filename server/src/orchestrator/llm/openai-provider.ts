import type OpenAI from "openai";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput, Message, ToolCall, ToolDefinition,
} from "./types.js";

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAIMessages(system: string, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const tc = m.tool_calls?.map((c) => ({
        id: c.id, type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      }));
      out.push({ role: "assistant", content: m.content, ...(tc ? { tool_calls: tc } : {}) });
    } else {
      out.push({
        role: "tool",
        tool_call_id: m.content.call_id,
        content: typeof m.content.output === "string" ? m.content.output : JSON.stringify(m.content.output),
      });
    }
  }
  return out;
}

function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  // gpt-5.5 only runs on /v1/responses; this provider uses chat-completions.
  // Stay on gpt-5 here until the Responses-API rewrite lands.
  readonly defaultOrchestratorModel = "gpt-5";
  readonly defaultSideModel = "gpt-5-mini";
  private client: OpenAI;

  constructor(opts: { client: OpenAI }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    const r = await this.client.chat.completions.create({
      model: input.model,
      max_completion_tokens: input.maxTokens,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    });
    return r.choices[0]?.message?.content ?? "";
  }

  async *stream(input: StreamInput): AsyncIterable<StreamEvent> {
    if (input.abort.aborted) {
      yield { kind: "done", stop_reason: "abort" };
      return;
    }
    const stream = await this.client.chat.completions.create({
      model: input.model,
      stream: true,
      messages: toOpenAIMessages(input.system, input.messages),
      tools: input.tools.length ? toOpenAITools(input.tools) : undefined,
      ...(input.reasoningEffort
        ? { reasoning_effort: input.reasoningEffort }
        : {}),
    } as Parameters<typeof this.client.chat.completions.create>[0]);
    // Tool calls arrive in deltas keyed by index. Accumulate by index.
    const partial = new Map<number, { id: string; name: string; argsBuf: string }>();
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error" = "end_turn";

    try {
      for await (const chunk of stream as AsyncIterable<{
        choices?: { delta?: { content?: string;
          tool_calls?: { index: number; id?: string; type?: string;
            function?: { name?: string; arguments?: string } }[] };
          finish_reason?: string | null }[];
      }>) {
        if (input.abort.aborted) {
          stopReason = "abort";
          break;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta;
        if (d?.content) yield { kind: "delta", text: d.content };
        if (d?.tool_calls) {
          for (const tc of d.tool_calls) {
            const slot = partial.get(tc.index) ?? { id: "", name: "", argsBuf: "" };
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.argsBuf += tc.function.arguments;
            partial.set(tc.index, slot);
          }
        }
        if (choice.finish_reason) {
          stopReason = choice.finish_reason === "tool_calls" ? "tool_use"
            : choice.finish_reason === "length" ? "max_tokens"
            : "end_turn";
        }
      }
    } catch (err) {
      yield { kind: "done", stop_reason: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    for (const [, slot] of [...partial.entries()].sort(([a], [b]) => a - b)) {
      let parsed: unknown = {};
      try { parsed = JSON.parse(slot.argsBuf || "{}"); } catch { parsed = { _raw: slot.argsBuf }; }
      const call: ToolCall = { id: slot.id, name: slot.name, args: parsed };
      yield { kind: "tool_call", call };
    }

    yield { kind: "done", stop_reason: stopReason };
  }
}
