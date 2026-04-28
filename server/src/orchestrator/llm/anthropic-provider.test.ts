import { describe, it, expect, vi } from "vitest";
import { AnthropicProvider } from "./anthropic-provider.js";
import type { Message } from "./types.js";

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

function fakeAnthropicStream(chunks: object[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
}

function fakeAnthropicWithStream(chunks: object[]) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(fakeAnthropicStream(chunks)),
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

describe("AnthropicProvider.stream", () => {
  it("emits text deltas then end_turn", async () => {
    const client = fakeAnthropicWithStream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", Sir." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);
    const p = new AnthropicProvider({ client });
    const ac = new AbortController();
    const out: string[] = [];
    let done = "";
    for await (const e of p.stream({
      model: "claude-sonnet-4-6", system: "S",
      messages: [{ role: "user", content: "hi" }], tools: [], abort: ac.signal,
    })) {
      if (e.kind === "delta") out.push(e.text);
      if (e.kind === "done") done = e.stop_reason;
    }
    expect(out.join("")).toBe("Hello, Sir.");
    expect(done).toBe("end_turn");
  });

  it("emits tool_call from a tool_use content block", async () => {
    const client = fakeAnthropicWithStream([
      { type: "content_block_start", index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "shell", input: {} } },
      { type: "content_block_delta", index: 0,
        delta: { type: "input_json_delta", partial_json: '{"command' } },
      { type: "content_block_delta", index: 0,
        delta: { type: "input_json_delta", partial_json: '":"ls"}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);
    const p = new AnthropicProvider({ client });
    const ac = new AbortController();
    const events = [];
    for await (const e of p.stream({
      model: "claude-sonnet-4-6", system: "S",
      messages: [{ role: "user", content: "list" }],
      tools: [{ name: "shell", description: "run a command",
        input_schema: { type: "object", properties: {} } }],
      abort: ac.signal,
    })) {
      events.push(e);
    }
    const calls = events.filter((e) => e.kind === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: "tool_call",
      call: { id: "toolu_1", name: "shell", args: { command: "ls" } },
    });
    const done = events.find((e) => e.kind === "done");
    expect(done?.stop_reason).toBe("tool_use");
  });

  it("converts our Message shape + tool results into Anthropic messages", async () => {
    const client = fakeAnthropicWithStream([
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);
    const p = new AnthropicProvider({ client });
    const ac = new AbortController();
    const messages: Message[] = [
      { role: "user", content: "do it" },
      { role: "assistant", content: "ok", tool_calls: [{ id: "c1", name: "shell", args: { command: "ls" } }] },
      { role: "tool", content: { call_id: "c1", output: "file1\nfile2", is_error: false } },
    ];
    for await (const _ of p.stream({
      model: "claude-sonnet-4-6", system: "S", messages, tools: [], abort: ac.signal,
    })) { /* drain */ }
    const args = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.system).toEqual([
      { type: "text", text: "S", cache_control: { type: "ephemeral" } },
    ]);
    expect(args.messages[0]).toEqual({ role: "user", content: "do it" });
    expect(args.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "ok" },
        { type: "tool_use", id: "c1", name: "shell", input: { command: "ls" } },
      ],
    });
    expect(args.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "c1", content: "file1\nfile2", is_error: false }],
    });
  });
});
