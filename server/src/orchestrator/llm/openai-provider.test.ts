import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "./openai-provider.js";

function fakeOpenAI(opts: {
  completion?: { content: string };
}) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: opts.completion?.content ?? "" } }],
        }),
      },
    },
  } as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"];
}

describe("OpenAIProvider.complete", () => {
  it("returns the assistant content", async () => {
    const client = fakeOpenAI({ completion: { content: "ok" } });
    const p = new OpenAIProvider({ client });
    const r = await p.complete({ model: "gpt-5-mini", system: "s", user: "u", maxTokens: 50 });
    expect(r).toBe("ok");
  });

  it("passes system + user as messages", async () => {
    const client = fakeOpenAI({ completion: { content: "x" } });
    const p = new OpenAIProvider({ client });
    await p.complete({ model: "gpt-5-mini", system: "S", user: "U", maxTokens: 10 });
    const args = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.model).toBe("gpt-5-mini");
    expect(args.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "U" },
    ]);
    expect(args.max_completion_tokens).toBe(10);
  });
});
