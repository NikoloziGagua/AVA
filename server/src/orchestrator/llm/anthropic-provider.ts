import type Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput,
} from "./types.js";

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

  async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
    throw new Error("AnthropicProvider.stream not implemented yet");
    // eslint-disable-next-line @typescript-eslint/no-unreachable
    yield { kind: "done", stop_reason: "end_turn" };
  }
}
