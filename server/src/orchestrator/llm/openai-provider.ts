import type OpenAI from "openai";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput,
} from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
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

  async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
    throw new Error("OpenAIProvider.stream not implemented yet");
    // eslint-disable-next-line @typescript-eslint/no-unreachable -- placeholder for next task
    yield { kind: "done", stop_reason: "end_turn" };
  }
}
