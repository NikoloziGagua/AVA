import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { OpenAIMemoryEmbedder } from "./embedding.js";

describe("OpenAIMemoryEmbedder", () => {
  it("uses the configured model and returns the provider vector", async () => {
    const create = vi.fn().mockResolvedValue({ data: [{ embedding: [0.2, 0.4] }] });
    const client = { embeddings: { create } } as unknown as OpenAI;
    const embedder = new OpenAIMemoryEmbedder(client, "fixture-embedding-model");
    await expect(embedder.embed("sanitized summary")).resolves.toEqual({
      provider: "openai",
      model: "fixture-embedding-model",
      vector: [0.2, 0.4],
    });
    expect(create).toHaveBeenCalledWith({
      model: "fixture-embedding-model",
      input: "sanitized summary",
      encoding_format: "float",
    });
  });

  it("fails closed on an empty or non-finite vector", async () => {
    const client = {
      embeddings: { create: async () => ({ data: [{ embedding: [Number.NaN] }] }) },
    } as unknown as OpenAI;
    await expect(new OpenAIMemoryEmbedder(client).embed("x")).rejects.toThrow(/usable vector/);
  });
});
