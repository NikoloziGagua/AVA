import type { LLMProvider, StreamEvent, StreamInput, CompleteInput } from "./types.js";

export class MockLLMProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly defaultOrchestratorModel = "mock-orchestrator";
  readonly defaultSideModel = "mock-side";
  private scripts: StreamEvent[][];
  private completions: string[];
  public calls: { stream: StreamInput[]; complete: CompleteInput[] } = { stream: [], complete: [] };

  constructor(opts: { scripts?: StreamEvent[][]; completions?: string[] }) {
    this.scripts = opts.scripts ? [...opts.scripts] : [];
    this.completions = opts.completions ? [...opts.completions] : [];
  }

  async *stream(input: StreamInput): AsyncIterable<StreamEvent> {
    this.calls.stream.push(input);
    const next = this.scripts.shift();
    if (!next) throw new Error("MockLLMProvider: no scripts left");
    for (const e of next) {
      if (input.abort.aborted) {
        yield { kind: "done", stop_reason: "abort" };
        return;
      }
      yield e;
    }
  }

  async complete(input: CompleteInput): Promise<string> {
    this.calls.complete.push(input);
    const next = this.completions.shift();
    if (next === undefined) throw new Error("MockLLMProvider: no completions left");
    return next;
  }
}
