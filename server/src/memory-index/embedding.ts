import type OpenAI from "openai";
import type { MemoryEmbedder, MemoryEmbedding } from "./types.js";

export const DEFAULT_MEMORY_EMBEDDING_MODEL = "text-embedding-3-small";

export class OpenAIMemoryEmbedder implements MemoryEmbedder {
  readonly provider = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(client: OpenAI, model = DEFAULT_MEMORY_EMBEDDING_MODEL) {
    this.client = client;
    this.model = model;
  }

  async embed(text: string): Promise<MemoryEmbedding> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      encoding_format: "float",
    });
    const vector = response.data[0]?.embedding;
    if (!vector?.length || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("embedding provider returned no usable vector");
    }
    return { provider: this.provider, model: this.model, vector };
  }
}
