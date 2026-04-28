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

import type { ToolDefinition, Message } from "./types.js";

function fakeStream(chunks: object[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
}

function fakeOpenAIWithStream(chunks: object[]) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(fakeStream(chunks)),
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

describe("OpenAIProvider.stream", () => {
  it("emits text deltas then end_turn", async () => {
    const client = fakeOpenAIWithStream([
      { choices: [{ delta: { content: "Hello" }, finish_reason: null }] },
      { choices: [{ delta: { content: ", Sir." }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const out: string[] = [];
    let done = "";
    for await (const e of p.stream({
      model: "gpt-5",
      system: "S",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      abort: ac.signal,
    })) {
      if (e.kind === "delta") out.push(e.text);
      if (e.kind === "done") done = e.stop_reason;
    }
    expect(out.join("")).toBe("Hello, Sir.");
    expect(done).toBe("end_turn");
  });

  it("accumulates tool_call deltas and emits a single tool_call event", async () => {
    const client = fakeOpenAIWithStream([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function",
          function: { name: "shell", arguments: '{"comm' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] },
          finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const events = [];
    for await (const e of p.stream({
      model: "gpt-5", system: "S",
      messages: [{ role: "user", content: "list" }],
      tools: [{ name: "shell", description: "run a shell command", input_schema: { type: "object", properties: {} } }],
      abort: ac.signal,
    })) {
      events.push(e);
    }
    const calls = events.filter((e) => e.kind === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      kind: "tool_call",
      call: { id: "call_1", name: "shell", args: { command: "ls" } },
    });
    const done = events.find((e) => e.kind === "done");
    expect(done?.stop_reason).toBe("tool_use");
  });

  it("converts our Message shape + tool results into OpenAI messages", async () => {
    const client = fakeOpenAIWithStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const messages: Message[] = [
      { role: "user", content: "do it" },
      { role: "assistant", content: "ok", tool_calls: [{ id: "c1", name: "shell", args: { command: "ls" } }] },
      { role: "tool", content: { call_id: "c1", output: "file1\nfile2", is_error: false } },
    ];
    for await (const _ of p.stream({
      model: "gpt-5", system: "S", messages, tools: [], abort: ac.signal,
    })) { /* drain */ }
    const args = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.messages[0]).toEqual({ role: "system", content: "S" });
    expect(args.messages[1]).toEqual({ role: "user", content: "do it" });
    expect(args.messages[2]).toEqual({
      role: "assistant",
      content: "ok",
      tool_calls: [{ id: "c1", type: "function", function: { name: "shell", arguments: '{"command":"ls"}' } }],
    });
    expect(args.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "file1\nfile2" });
  });

  it("aborts when the signal fires", async () => {
    let aborted = false;
    const client = fakeOpenAIWithStream([
      { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
    ]);
    const ac = new AbortController();
    ac.abort();
    const p = new OpenAIProvider({ client });
    const events = [];
    for await (const e of p.stream({
      model: "gpt-5", system: "", messages: [{ role: "user", content: "x" }], tools: [], abort: ac.signal,
    })) {
      events.push(e);
      if (e.kind === "done") aborted = e.stop_reason === "abort";
    }
    expect(aborted).toBe(true);
  });
});
