import type Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput, Message, ToolCall, ToolDefinition,
} from "./types.js";

type AContentBlockParam =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AMessageParam = { role: "user" | "assistant"; content: string | AContentBlockParam[] };

function toAnthropicMessages(messages: Message[]): AMessageParam[] {
  const out: AMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const blocks: AContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.content.call_id,
          content: typeof m.content.output === "string" ? m.content.output : JSON.stringify(m.content.output),
          is_error: !!m.content.is_error,
        }],
      });
    }
  }
  return out;
}

function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly defaultOrchestratorModel = "claude-sonnet-4-6";
  readonly defaultSideModel = "claude-haiku-4-5-20251001";
  private client: Anthropic;

  constructor(opts: { client: Anthropic }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    const r = await this.client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const block = r.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  }

  async *stream(input: StreamInput): AsyncIterable<StreamEvent> {
    if (input.abort.aborted) {
      yield { kind: "done", stop_reason: "abort" };
      return;
    }
    const tools = input.tools.length ? toAnthropicTools(input.tools) : undefined;
    const stream = await this.client.messages.create({
      model: input.model,
      max_tokens: 4096,
      stream: true,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropicMessages(input.messages),
      ...(tools ? { tools } : {}),
    });
    type Block = { kind: "text" } | { kind: "tool_use"; id: string; name: string; argsBuf: string };
    const blocks = new Map<number, Block>();
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error" = "end_turn";

    try {
      for await (const ev of stream as AsyncIterable<{
        type: string; index?: number; content_block?: { type: string; id?: string; name?: string; input?: unknown };
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
      }>) {
        if (input.abort.aborted) { stopReason = "abort"; break; }
        if (ev.type === "content_block_start" && typeof ev.index === "number" && ev.content_block) {
          if (ev.content_block.type === "text") {
            blocks.set(ev.index, { kind: "text" });
          } else if (ev.content_block.type === "tool_use") {
            blocks.set(ev.index, {
              kind: "tool_use",
              id: ev.content_block.id ?? "",
              name: ev.content_block.name ?? "",
              argsBuf: "",
            });
          }
        } else if (ev.type === "content_block_delta" && typeof ev.index === "number") {
          const blk = blocks.get(ev.index);
          if (!blk) continue;
          if (blk.kind === "text" && ev.delta?.type === "text_delta" && ev.delta.text) {
            yield { kind: "delta", text: ev.delta.text };
          } else if (blk.kind === "tool_use" && ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
            blk.argsBuf += ev.delta.partial_json;
          }
        } else if (ev.type === "content_block_stop" && typeof ev.index === "number") {
          const blk = blocks.get(ev.index);
          if (blk?.kind === "tool_use") {
            let parsed: unknown = {};
            try { parsed = JSON.parse(blk.argsBuf || "{}"); } catch { parsed = { _raw: blk.argsBuf }; }
            const call: ToolCall = { id: blk.id, name: blk.name, args: parsed };
            yield { kind: "tool_call", call };
          }
        } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
          stopReason = ev.delta.stop_reason === "tool_use" ? "tool_use"
            : ev.delta.stop_reason === "max_tokens" ? "max_tokens"
            : "end_turn";
        }
      }
    } catch (err) {
      yield { kind: "done", stop_reason: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }
    yield { kind: "done", stop_reason: stopReason };
  }
}
