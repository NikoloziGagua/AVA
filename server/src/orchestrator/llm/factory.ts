import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider } from "./types.js";
import { OpenAIProvider } from "./openai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import type { Logger } from "../../logs/logger.js";

export function buildProvider(opts: {
  preferred: "openai" | "anthropic";
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  log: Logger;
}): LLMProvider | null {
  const order = opts.preferred === "openai" ? ["openai", "anthropic"] : ["anthropic", "openai"];
  for (const choice of order) {
    if (choice === "openai" && opts.openaiApiKey) {
      opts.log.info({ provider: "openai" }, "LLMProvider selected");
      return new OpenAIProvider({ client: new OpenAI({ apiKey: opts.openaiApiKey }) });
    }
    if (choice === "anthropic" && opts.anthropicApiKey) {
      opts.log.info({ provider: "anthropic" }, "LLMProvider selected");
      return new AnthropicProvider({ client: new Anthropic({ apiKey: opts.anthropicApiKey }) });
    }
  }
  opts.log.warn({}, "no LLMProvider available — chat will return 503");
  return null;
}
