export type ToolDefinition = {
  name: string;
  description: string;
  // JSON Schema describing the args object the LLM should produce.
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
};

export type ToolCall = {
  id: string;          // provider-specific call id, opaque to us
  name: string;
  args: unknown;       // parsed JSON; never a raw string
};

export type ToolResult = {
  call_id: string;
  output: string;      // tool stringified its own result
  is_error?: boolean;
};

export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; content: ToolResult };

export type ProviderUsage = {
  providerRequestId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export type StreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool_call"; call: ToolCall }
  | { kind: "thought"; text: string }
  | { kind: "usage"; usage: ProviderUsage }
  | { kind: "done"; stop_reason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error"; error?: string };

export type StreamInput = {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  abort: AbortSignal;
  /**
   * For OpenAI reasoning models (gpt-5.x family via Responses API): how much
   * invisible reasoning to allow before the first token. "none" is critical
   * for sub-second TTFT in conversation mode. Ignored by non-reasoning models
   * and by Anthropic (which doesn't expose reasoning effort here).
   *
   * Note: gpt-5 chat-completions called this "minimal"; the Responses API
   * renamed it to "none" for the gpt-5.5+ family.
   */
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
};

export type CompleteInput = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
};

export type LLMProvider = {
  name: "openai" | "anthropic";
  defaultOrchestratorModel: string;
  defaultSideModel: string;
  stream(input: StreamInput): AsyncIterable<StreamEvent>;
  complete(input: CompleteInput): Promise<string>;
};
