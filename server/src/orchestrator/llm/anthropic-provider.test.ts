import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "./anthropic-provider.js";

function fakeAnthropic(opts: { responseText?: string }) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: opts.responseText ?? "" }],
        stop_reason: "end_turn",
      }),
    },
  } as unknown as ConstructorParameters<typeof AnthropicProvider>[0]["client"];
}

describe("AnthropicProvider.complete", () => {
  it("returns the assistant text block", async () => {
    const client = fakeAnthropic({ responseText: "hi" });
    const p = new AnthropicProvider({ client });
    const r = await p.complete({ model: "claude-sonnet-4-6", system: "s", user: "u", maxTokens: 50 });
    expect(r).toBe("hi");
  });

  it("passes system as a string and user as a single message", async () => {
    const client = fakeAnthropic({});
    const p = new AnthropicProvider({ client });
    await p.complete({ model: "claude-sonnet-4-6", system: "S", user: "U", maxTokens: 10 });
    const args = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.model).toBe("claude-sonnet-4-6");
    expect(args.system).toBe("S");
    expect(args.messages).toEqual([{ role: "user", content: "U" }]);
    expect(args.max_tokens).toBe(10);
  });
});
