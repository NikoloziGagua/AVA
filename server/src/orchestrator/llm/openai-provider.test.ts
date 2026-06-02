import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "./openai-provider.js";
import type { Message } from "./types.js";

// The provider talks to the Responses API; the SDK exposes it as
// client.responses.create(). Our typing uses `any` casts internally because
// the SDK typings lag the preview API, so the tests mirror that.

function fakeOpenAIComplete(text: string) {
  return {
    responses: {
      create: vi.fn().mockResolvedValue({
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text }],
          },
        ],
      }),
    },
  } as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"];
}

function fakeStream(events: object[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e;
    },
  };
}

function fakeOpenAIStream(events: object[]) {
  return {
    responses: {
      create: vi.fn().mockResolvedValue(fakeStream(events)),
    },
  } as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"];
}

describe("OpenAIProvider.complete", () => {
  it("extracts output_text from the message item", async () => {
    const client = fakeOpenAIComplete("ok");
    const p = new OpenAIProvider({ client });
    const r = await p.complete({ model: "gpt-5", system: "s", user: "u", maxTokens: 50 });
    expect(r).toBe("ok");
  });

  it("passes instructions + input + max_output_tokens", async () => {
    const client = fakeOpenAIComplete("x");
    const p = new OpenAIProvider({ client });
    await p.complete({ model: "gpt-5", system: "S", user: "U", maxTokens: 10 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((client as any).responses.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.model).toBe("gpt-5");
    expect(args.instructions).toBe("S");
    expect(args.input).toBe("U");
    expect(args.max_output_tokens).toBe(10);
  });
});

describe("OpenAIProvider.stream", () => {
  it("emits text deltas then end_turn on response.completed", async () => {
    const client = fakeOpenAIStream([
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: ", Sir." },
      { type: "response.completed", response: { status: "completed" } },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const out: string[] = [];
    let done = "";
    for await (const e of p.stream({
      model: "gpt-5.5",
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

  it("accumulates function_call argument deltas and emits a tool_call on item.done", async () => {
    const client = fakeOpenAIStream([
      {
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: "" },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"comm' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: 'and":"ls"}' },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        arguments: '{"command":"ls"}',
      },
      {
        type: "response.output_item.done",
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: '{"command":"ls"}' },
      },
      { type: "response.completed", response: { status: "completed" } },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const events: Array<{ kind: string; call?: { id: string; name: string; args: unknown }; stop_reason?: string }> = [];
    for await (const e of p.stream({
      model: "gpt-5.5", system: "S",
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

  it("converts our Message shape into Responses input items", async () => {
    const client = fakeOpenAIStream([
      { type: "response.completed", response: { status: "completed" } },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const messages: Message[] = [
      { role: "user", content: "do it" },
      { role: "assistant", content: "ok", tool_calls: [{ id: "c1", name: "shell", args: { command: "ls" } }] },
      { role: "tool", content: { call_id: "c1", output: "file1\nfile2", is_error: false } },
    ];
    for await (const _ of p.stream({
      model: "gpt-5.5", system: "S", messages, tools: [], abort: ac.signal,
    })) { /* drain */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((client as any).responses.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.instructions).toBe("S");
    expect(args.input).toEqual([
      { role: "user", content: "do it" },
      { role: "assistant", content: "ok" },
      { type: "function_call", call_id: "c1", name: "shell", arguments: '{"command":"ls"}' },
      { type: "function_call_output", call_id: "c1", output: "file1\nfile2" },
    ]);
  });

  it("flattens tools to {type, name, description, parameters}", async () => {
    const client = fakeOpenAIStream([
      { type: "response.completed", response: { status: "completed" } },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    for await (const _ of p.stream({
      model: "gpt-5.5", system: "",
      messages: [{ role: "user", content: "x" }],
      tools: [{ name: "shell", description: "d", input_schema: { type: "object", properties: { command: { type: "string" } } } }],
      abort: ac.signal,
    })) { /* drain */ }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((client as any).responses.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(args.tools).toEqual([
      {
        type: "function",
        name: "shell",
        description: "d",
        parameters: { type: "object", properties: { command: { type: "string" } } },
      },
    ]);
  });

  it("maps reasoningEffort onto OpenAI's accepted enum (none -> minimal)", async () => {
    // OpenAI's gpt-5 only accepts minimal|low|medium|high. Passing our internal
    // "none" raw returns a 400, so the provider must floor it to "minimal".
    const cases: Array<[("none" | "low" | "medium" | "high" | "xhigh"), string]> = [
      ["none", "minimal"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "high"],
    ];
    for (const [input, expected] of cases) {
      const client = fakeOpenAIStream([
        { type: "response.completed", response: { status: "completed" } },
      ]);
      const p = new OpenAIProvider({ client });
      const ac = new AbortController();
      for await (const _ of p.stream({
        model: "gpt-5.5", system: "",
        messages: [{ role: "user", content: "x" }],
        tools: [], abort: ac.signal, reasoningEffort: input,
      })) { /* drain */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = ((client as any).responses.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(args.reasoning).toEqual({ effort: expected });
    }
  });

  it("forwards reasoning_summary_text.delta as thought events", async () => {
    const client = fakeOpenAIStream([
      { type: "response.reasoning_summary_text.delta", delta: "considering options…" },
      { type: "response.output_text.delta", delta: "ok" },
      { type: "response.completed", response: { status: "completed" } },
    ]);
    const p = new OpenAIProvider({ client });
    const ac = new AbortController();
    const thoughts: string[] = [];
    for await (const e of p.stream({
      model: "gpt-5.5", system: "",
      messages: [{ role: "user", content: "x" }],
      tools: [], abort: ac.signal,
    })) {
      if (e.kind === "thought") thoughts.push(e.text);
    }
    expect(thoughts.join("")).toBe("considering options…");
  });

  it("aborts when the signal fires", async () => {
    const client = fakeOpenAIStream([
      { type: "response.output_text.delta", delta: "Hi" },
    ]);
    const ac = new AbortController();
    ac.abort();
    const p = new OpenAIProvider({ client });
    let aborted = false;
    for await (const e of p.stream({
      model: "gpt-5.5", system: "",
      messages: [{ role: "user", content: "x" }],
      tools: [], abort: ac.signal,
    })) {
      if (e.kind === "done") aborted = e.stop_reason === "abort";
    }
    expect(aborted).toBe(true);
  });

  it("emits an error done event when stream throws", async () => {
    const errStream = {
      responses: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { type: "response.output_text.delta", delta: "x" };
            throw new Error("network blip");
          },
        }),
      },
    } as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"];
    const p = new OpenAIProvider({ client: errStream });
    const ac = new AbortController();
    let stop = "";
    let errMsg = "";
    for await (const e of p.stream({
      model: "gpt-5.5", system: "",
      messages: [{ role: "user", content: "x" }],
      tools: [], abort: ac.signal,
    })) {
      if (e.kind === "done") {
        stop = e.stop_reason;
        errMsg = e.error ?? "";
      }
    }
    expect(stop).toBe("error");
    expect(errMsg).toBe("network blip");
  });
});
