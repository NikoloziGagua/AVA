# Ava M4 Phase 1 — Foundation (Orchestrator Refactor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Claude Agent SDK orchestrator (`query()` over OAuth) with a directly-controlled OpenAI tool-use loop. All M3 functionality — tools, approvals, push, per-tool timeouts, stuck-loop guard, recovery — preserved unchanged. OpenAI is the default provider; Anthropic remains a sibling behind a config flag.

**Architecture:** A new `LLMProvider` interface abstracts both providers. `OpenAIProvider` uses the Chat Completions API (streaming + function tools). `AnthropicProvider` uses the Messages API (streaming + tool_use blocks with cache_control). The existing `ToolDef[]` shape from `tools/ava-mcp.ts` becomes a flat tool registry. The new `runAgent` drives `provider.stream()`, dispatches tool calls against the registry, and emits the same `AgentEvent` shape as today so chat.ts SSE consumers don't change.

**Tech Stack:** TypeScript, Node 20, `openai` SDK (^6.35), `@anthropic-ai/sdk` (^0.81), vitest, supertest, existing Express + better-sqlite3 stack. M3 work (timeout wrapper, stuck-loop, policy hook) carries forward unchanged.

---

## File Structure

**Create:**
- `server/src/orchestrator/llm/types.ts` — `LLMProvider`, `Message`, `ToolDefinition`, `ToolCall`, `StreamEvent`
- `server/src/orchestrator/llm/openai-provider.ts` — `OpenAIProvider` impl
- `server/src/orchestrator/llm/anthropic-provider.ts` — `AnthropicProvider` impl
- `server/src/orchestrator/llm/mock-provider.ts` — `MockLLMProvider` for tests
- `server/src/orchestrator/llm/factory.ts` — `buildProvider(env)` selects active provider
- `server/src/orchestrator/llm/openai-provider.test.ts`
- `server/src/orchestrator/llm/anthropic-provider.test.ts`
- `server/src/orchestrator/llm/factory.test.ts`
- `server/src/orchestrator/tool-registry.ts` — converts `ToolDef[]` to provider tool definitions, dispatches calls
- `server/src/orchestrator/tool-registry.test.ts`
- `server/src/orchestrator/agent-v2.test.ts` — full-loop integration test with mock provider

**Modify:**
- `server/src/orchestrator/agent.ts` — rewrite to use `LLMProvider` + tool registry; remove `query()` / SDK dependency
- `server/src/orchestrator/auto-title.ts` — switch from Anthropic SDK direct to `provider.complete()`
- `server/src/orchestrator/auto-summary.ts` — switch to `provider.complete()`
- `server/src/policy/rule-parser.ts` — switch to `provider.complete()`
- `server/src/routes/chat.ts` — accept `provider` via deps, pass to `runAgent`
- `server/src/index.ts` — build provider at startup, inject into chat deps
- `server/src/config.ts` — add `llmProvider` field + env parsing
- `server/package.json` — no new deps needed (openai + anthropic SDKs already present); remove `@anthropic-ai/claude-agent-sdk` once unreferenced

**Reference (read-only, do not modify):**
- `server/src/tools/ava-mcp.ts` — `ToolDef` shape we reuse
- `server/src/orchestrator/timeout.ts`, `stuck-loop.ts` — wrappers carry forward
- `server/src/policy/runtime.ts` — `buildPolicyHook` carries forward
- `server/src/orchestrator/system-prompt.ts` — system-prompt assembly is reused (Phase 2 will replace it)

---

## Sequencing notes for the implementer

- The plan is TDD throughout: write failing test, run to verify failure, implement, verify pass, commit.
- Build the **MockLLMProvider** before either real provider; everything downstream tests against it.
- The **OpenAI provider** lands before Anthropic so we have a working orchestrator end-to-end before adding the parity surface.
- The **agent loop rewrite** happens before any side calls (auto-title, rule-parse, auto-summary) are migrated, so chat keeps working while side calls flip one at a time.
- After each task, run `npm -w server test` and confirm the affected suite passes.
- Commit after every task. Small frequent commits.
- Keep the existing Agent SDK import working until **Task 8**, when `agent.ts` no longer imports `query()`. After Task 8, run `npm -w server build` to verify nothing else references the SDK; only then remove the dep in package.json (Task 15).

---

### Task 1: LLMProvider types

**Files:**
- Create: `server/src/orchestrator/llm/types.ts`
- Test: none (pure type module — verified by Task 2 compile)

- [ ] **Step 1: Create the types module**

```ts
// server/src/orchestrator/llm/types.ts

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

export type StreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "tool_call"; call: ToolCall }
  | { kind: "thought"; text: string }
  | { kind: "done"; stop_reason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error"; error?: string };

export type StreamInput = {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  abort: AbortSignal;
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npm -w server run build`
Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/orchestrator/llm/types.ts
git commit -m "feat(orchestrator): add LLMProvider type module"
```

---

### Task 2: MockLLMProvider

**Files:**
- Create: `server/src/orchestrator/llm/mock-provider.ts`
- Test: `server/src/orchestrator/llm/mock-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/orchestrator/llm/mock-provider.test.ts
import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "./mock-provider.js";
import type { StreamEvent } from "./types.js";

describe("MockLLMProvider", () => {
  it("emits scripted stream events", async () => {
    const events: StreamEvent[] = [
      { kind: "delta", text: "Hello, " },
      { kind: "delta", text: "Sir." },
      { kind: "done", stop_reason: "end_turn" },
    ];
    const p = new MockLLMProvider({ scripts: [events] });
    const ac = new AbortController();
    const out: StreamEvent[] = [];
    for await (const e of p.stream({
      model: "mock",
      system: "",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      abort: ac.signal,
    })) {
      out.push(e);
    }
    expect(out).toEqual(events);
  });

  it("complete returns scripted text", async () => {
    const p = new MockLLMProvider({ completions: ["Done."] });
    const r = await p.complete({ model: "mock", system: "s", user: "u", maxTokens: 10 });
    expect(r).toBe("Done.");
  });

  it("throws if scripts run out", async () => {
    const p = new MockLLMProvider({ scripts: [] });
    const ac = new AbortController();
    await expect(async () => {
      for await (const _ of p.stream({
        model: "mock", system: "", messages: [], tools: [], abort: ac.signal,
      })) { /* drain */ }
    }).rejects.toThrow(/no scripts left/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w server test -- mock-provider`
Expected: FAIL — `Cannot find module './mock-provider.js'`

- [ ] **Step 3: Write the implementation**

```ts
// server/src/orchestrator/llm/mock-provider.ts
import type { LLMProvider, StreamEvent, StreamInput, CompleteInput } from "./types.js";

export class MockLLMProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly defaultOrchestratorModel = "mock";
  readonly defaultSideModel = "mock";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w server test -- mock-provider`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/orchestrator/llm/mock-provider.ts server/src/orchestrator/llm/mock-provider.test.ts
git commit -m "feat(orchestrator): add MockLLMProvider for tests"
```

---

### Task 3: OpenAIProvider — complete()

**Files:**
- Create: `server/src/orchestrator/llm/openai-provider.ts`
- Test: `server/src/orchestrator/llm/openai-provider.test.ts`

- [ ] **Step 1: Write the failing test for complete()**

```ts
// server/src/orchestrator/llm/openai-provider.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w server test -- openai-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation skeleton with complete()**

```ts
// server/src/orchestrator/llm/openai-provider.ts
import type OpenAI from "openai";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput,
} from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly defaultOrchestratorModel = "gpt-5";
  readonly defaultSideModel = "gpt-5-mini";
  private client: OpenAI;

  constructor(opts: { client: OpenAI }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    const r = await this.client.chat.completions.create({
      model: input.model,
      max_completion_tokens: input.maxTokens,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    });
    return r.choices[0]?.message?.content ?? "";
  }

  async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
    throw new Error("OpenAIProvider.stream not implemented yet");
    // eslint-disable-next-line @typescript-eslint/no-unreachable -- placeholder for next task
    yield { kind: "done", stop_reason: "end_turn" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w server test -- openai-provider`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/orchestrator/llm/openai-provider.ts server/src/orchestrator/llm/openai-provider.test.ts
git commit -m "feat(orchestrator): OpenAIProvider.complete()"
```

---

### Task 4: OpenAIProvider — stream() with tool_calls

**Files:**
- Modify: `server/src/orchestrator/llm/openai-provider.ts`
- Modify: `server/src/orchestrator/llm/openai-provider.test.ts`

- [ ] **Step 1: Add the failing streaming test**

Add to the test file:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server test -- openai-provider`
Expected: FAIL on the new tests — `OpenAIProvider.stream not implemented yet`.

- [ ] **Step 3: Implement stream()**

Replace the placeholder in `openai-provider.ts`:

```ts
import type OpenAI from "openai";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput, Message, ToolCall, ToolDefinition,
} from "./types.js";

type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

function toOpenAIMessages(system: string, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const tc = m.tool_calls?.map((c) => ({
        id: c.id, type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      }));
      out.push({ role: "assistant", content: m.content, ...(tc ? { tool_calls: tc } : {}) });
    } else {
      out.push({
        role: "tool",
        tool_call_id: m.content.call_id,
        content: typeof m.content.output === "string" ? m.content.output : JSON.stringify(m.content.output),
      });
    }
  }
  return out;
}

function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly defaultOrchestratorModel = "gpt-5";
  readonly defaultSideModel = "gpt-5-mini";
  private client: OpenAI;

  constructor(opts: { client: OpenAI }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    const r = await this.client.chat.completions.create({
      model: input.model,
      max_completion_tokens: input.maxTokens,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    });
    return r.choices[0]?.message?.content ?? "";
  }

  async *stream(input: StreamInput): AsyncIterable<StreamEvent> {
    if (input.abort.aborted) {
      yield { kind: "done", stop_reason: "abort" };
      return;
    }
    const stream = await this.client.chat.completions.create({
      model: input.model,
      stream: true,
      messages: toOpenAIMessages(input.system, input.messages),
      tools: input.tools.length ? toOpenAITools(input.tools) : undefined,
    });
    // Tool calls arrive in deltas keyed by index. Accumulate by index.
    const partial = new Map<number, { id: string; name: string; argsBuf: string }>();
    let stopReason: StreamEvent extends { kind: "done"; stop_reason: infer R } ? R : never = "end_turn";

    try {
      for await (const chunk of stream as AsyncIterable<{
        choices?: { delta?: { content?: string;
          tool_calls?: { index: number; id?: string; type?: string;
            function?: { name?: string; arguments?: string } }[] };
          finish_reason?: string | null }[];
      }>) {
        if (input.abort.aborted) {
          stopReason = "abort";
          break;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta;
        if (d?.content) yield { kind: "delta", text: d.content };
        if (d?.tool_calls) {
          for (const tc of d.tool_calls) {
            const slot = partial.get(tc.index) ?? { id: "", name: "", argsBuf: "" };
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.argsBuf += tc.function.arguments;
            partial.set(tc.index, slot);
          }
        }
        if (choice.finish_reason) {
          stopReason = choice.finish_reason === "tool_calls" ? "tool_use"
            : choice.finish_reason === "length" ? "max_tokens"
            : "end_turn";
        }
      }
    } catch (err) {
      yield { kind: "done", stop_reason: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }

    for (const [, slot] of [...partial.entries()].sort(([a], [b]) => a - b)) {
      let parsed: unknown = {};
      try { parsed = JSON.parse(slot.argsBuf || "{}"); } catch { parsed = { _raw: slot.argsBuf }; }
      const call: ToolCall = { id: slot.id, name: slot.name, args: parsed };
      yield { kind: "tool_call", call };
    }

    yield { kind: "done", stop_reason: stopReason };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w server test -- openai-provider`
Expected: PASS — all 5 tests (2 from Task 3 + 3 new + abort).

- [ ] **Step 5: Commit**

```bash
git add server/src/orchestrator/llm/openai-provider.ts server/src/orchestrator/llm/openai-provider.test.ts
git commit -m "feat(orchestrator): OpenAIProvider.stream() with tool_calls"
```

---

### Task 5: AnthropicProvider — complete()

**Files:**
- Create: `server/src/orchestrator/llm/anthropic-provider.ts`
- Test: `server/src/orchestrator/llm/anthropic-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// server/src/orchestrator/llm/anthropic-provider.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w server test -- anthropic-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement skeleton with complete()**

```ts
// server/src/orchestrator/llm/anthropic-provider.ts
import type Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput,
} from "./types.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly defaultOrchestratorModel = "claude-sonnet-4-6";
  readonly defaultSideModel = "claude-haiku-4-5-20251001";
  private client: Anthropic;

  constructor(opts: { client: Anthropic }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    const r = await this.client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const block = r.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  }

  async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
    throw new Error("AnthropicProvider.stream not implemented yet");
    // eslint-disable-next-line @typescript-eslint/no-unreachable
    yield { kind: "done", stop_reason: "end_turn" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w server test -- anthropic-provider`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/orchestrator/llm/anthropic-provider.ts server/src/orchestrator/llm/anthropic-provider.test.ts
git commit -m "feat(orchestrator): AnthropicProvider.complete()"
```

---

### Task 6: AnthropicProvider — stream() with tool_use

**Files:**
- Modify: `server/src/orchestrator/llm/anthropic-provider.ts`
- Modify: `server/src/orchestrator/llm/anthropic-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `anthropic-provider.test.ts`:

```ts
import type { Message } from "./types.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w server test -- anthropic-provider`
Expected: FAIL — `stream not implemented yet`.

- [ ] **Step 3: Implement stream()**

Replace the placeholder in `anthropic-provider.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider, StreamEvent, StreamInput, CompleteInput, Message, ToolCall, ToolDefinition,
} from "./types.js";

type AContentBlockParam =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

type AMessageParam = { role: "user" | "assistant"; content: string | AContentBlockParam[] };

function toAnthropicMessages(messages: Message[]): AMessageParam[] {
  const out: AMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const blocks: AContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      }
      out.push({ role: "assistant", content: blocks });
    } else {
      out.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.content.call_id,
          content: typeof m.content.output === "string" ? m.content.output : JSON.stringify(m.content.output),
          is_error: !!m.content.is_error,
        }],
      });
    }
  }
  return out;
}

function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  readonly defaultOrchestratorModel = "claude-sonnet-4-6";
  readonly defaultSideModel = "claude-haiku-4-5-20251001";
  private client: Anthropic;

  constructor(opts: { client: Anthropic }) {
    this.client = opts.client;
  }

  async complete(input: CompleteInput): Promise<string> {
    const r = await this.client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const block = r.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "";
  }

  async *stream(input: StreamInput): AsyncIterable<StreamEvent> {
    if (input.abort.aborted) {
      yield { kind: "done", stop_reason: "abort" };
      return;
    }
    const tools = input.tools.length ? toAnthropicTools(input.tools) : undefined;
    const stream = await this.client.messages.create({
      model: input.model,
      max_tokens: 4096,
      stream: true,
      system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
      messages: toAnthropicMessages(input.messages),
      ...(tools ? { tools } : {}),
    });
    type Block = { kind: "text" } | { kind: "tool_use"; id: string; name: string; argsBuf: string };
    const blocks = new Map<number, Block>();
    let stopReason: StreamEvent extends { kind: "done"; stop_reason: infer R } ? R : never = "end_turn";

    try {
      for await (const ev of stream as AsyncIterable<{
        type: string; index?: number; content_block?: { type: string; id?: string; name?: string; input?: unknown };
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
      }>) {
        if (input.abort.aborted) { stopReason = "abort"; break; }
        if (ev.type === "content_block_start" && typeof ev.index === "number" && ev.content_block) {
          if (ev.content_block.type === "text") {
            blocks.set(ev.index, { kind: "text" });
          } else if (ev.content_block.type === "tool_use") {
            blocks.set(ev.index, {
              kind: "tool_use",
              id: ev.content_block.id ?? "",
              name: ev.content_block.name ?? "",
              argsBuf: "",
            });
          }
        } else if (ev.type === "content_block_delta" && typeof ev.index === "number") {
          const blk = blocks.get(ev.index);
          if (!blk) continue;
          if (blk.kind === "text" && ev.delta?.type === "text_delta" && ev.delta.text) {
            yield { kind: "delta", text: ev.delta.text };
          } else if (blk.kind === "tool_use" && ev.delta?.type === "input_json_delta" && ev.delta.partial_json) {
            blk.argsBuf += ev.delta.partial_json;
          }
        } else if (ev.type === "content_block_stop" && typeof ev.index === "number") {
          const blk = blocks.get(ev.index);
          if (blk?.kind === "tool_use") {
            let parsed: unknown = {};
            try { parsed = JSON.parse(blk.argsBuf || "{}"); } catch { parsed = { _raw: blk.argsBuf }; }
            const call: ToolCall = { id: blk.id, name: blk.name, args: parsed };
            yield { kind: "tool_call", call };
          }
        } else if (ev.type === "message_delta" && ev.delta?.stop_reason) {
          stopReason = ev.delta.stop_reason === "tool_use" ? "tool_use"
            : ev.delta.stop_reason === "max_tokens" ? "max_tokens"
            : "end_turn";
        }
      }
    } catch (err) {
      yield { kind: "done", stop_reason: "error", error: err instanceof Error ? err.message : String(err) };
      return;
    }
    yield { kind: "done", stop_reason: stopReason };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm -w server test -- anthropic-provider`
Expected: PASS — all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/orchestrator/llm/anthropic-provider.ts server/src/orchestrator/llm/anthropic-provider.test.ts
git commit -m "feat(orchestrator): AnthropicProvider.stream() with tool_use + cache_control"
```

---

### Task 7: Tool registry

**Files:**
- Create: `server/src/orchestrator/tool-registry.ts`
- Test: `server/src/orchestrator/tool-registry.test.ts`

The registry takes the existing `ToolDef[]` (from `ava-mcp.ts`), exposes them as `ToolDefinition[]` for the provider, and dispatches `ToolCall` against them returning a `ToolResult`.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/orchestrator/tool-registry.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildToolRegistry } from "./tool-registry.js";
import type { ToolDef } from "../tools/ava-mcp.js";

function defOf(name: string, run = vi.fn().mockResolvedValue({ text: "ok", ok: true })): ToolDef {
  return {
    tool: { name, description: `desc ${name}`,
      inputSchema: { type: "object", properties: { x: { type: "string" } } } as const },
    run,
  };
}

describe("buildToolRegistry", () => {
  it("converts ToolDef[] to ToolDefinition[] for the provider", () => {
    const reg = buildToolRegistry({ tools: [defOf("a"), defOf("b")], ctx: { runId: "r1" } });
    const defs = reg.toolDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0]).toEqual({
      name: "a",
      description: "desc a",
      input_schema: { type: "object", properties: { x: { type: "string" } } },
    });
  });

  it("dispatches a ToolCall to the right ToolDef and packages the result", async () => {
    const run = vi.fn().mockResolvedValue({ text: "result-text", ok: true });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "a", args: { x: "y" } });
    expect(run).toHaveBeenCalledWith({ x: "y" }, { runId: "r1" });
    expect(r).toEqual({ call_id: "c1", output: "result-text", is_error: false });
  });

  it("packages an error when the ToolDef returns ok:false", async () => {
    const run = vi.fn().mockResolvedValue({ text: "boom", ok: false });
    const reg = buildToolRegistry({ tools: [defOf("a", run)], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "a", args: {} });
    expect(r).toEqual({ call_id: "c1", output: "boom", is_error: true });
  });

  it("returns an error result for an unknown tool", async () => {
    const reg = buildToolRegistry({ tools: [defOf("a")], ctx: { runId: "r1" } });
    const r = await reg.dispatch({ id: "c1", name: "ghost", args: {} });
    expect(r).toEqual({ call_id: "c1", output: expect.stringContaining("unknown tool: ghost"), is_error: true });
  });

  it("fills inputSchema defaults when the ToolDef has no properties key", () => {
    const td: ToolDef = {
      tool: { name: "z", description: "z", inputSchema: { type: "object" } as const },
      run: vi.fn(),
    };
    const reg = buildToolRegistry({ tools: [td], ctx: { runId: "r1" } });
    const def = reg.toolDefinitions()[0];
    expect(def?.input_schema).toEqual({ type: "object", properties: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w server test -- tool-registry`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

```ts
// server/src/orchestrator/tool-registry.ts
import type { ToolDef, RunCtx } from "../tools/ava-mcp.js";
import type { ToolDefinition, ToolCall, ToolResult } from "./llm/types.js";

export type ToolRegistry = {
  toolDefinitions(): ToolDefinition[];
  dispatch(call: ToolCall): Promise<ToolResult>;
  has(name: string): boolean;
};

export function buildToolRegistry(opts: { tools: ToolDef[]; ctx: RunCtx }): ToolRegistry {
  const byName = new Map(opts.tools.map((t) => [t.tool.name, t]));

  return {
    toolDefinitions(): ToolDefinition[] {
      return opts.tools.map((t) => {
        const schema = t.tool.inputSchema as { type?: string; properties?: Record<string, unknown>;
          required?: string[]; additionalProperties?: boolean } | undefined;
        return {
          name: t.tool.name,
          description: t.tool.description ?? "",
          input_schema: {
            type: "object",
            properties: schema?.properties ?? {},
            ...(schema?.required ? { required: schema.required } : {}),
            ...(typeof schema?.additionalProperties === "boolean"
              ? { additionalProperties: schema.additionalProperties } : {}),
          },
        };
      });
    },
    has(name: string): boolean {
      return byName.has(name);
    },
    async dispatch(call: ToolCall): Promise<ToolResult> {
      const td = byName.get(call.name);
      if (!td) {
        return { call_id: call.id, output: `unknown tool: ${call.name}`, is_error: true };
      }
      try {
        const args = (typeof call.args === "object" && call.args !== null)
          ? (call.args as Record<string, unknown>) : {};
        const r = await td.run(args, opts.ctx);
        return { call_id: call.id, output: r.text, is_error: !r.ok };
      } catch (err) {
        return {
          call_id: call.id,
          output: err instanceof Error ? err.message : String(err),
          is_error: true,
        };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w server test -- tool-registry`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/orchestrator/tool-registry.ts server/src/orchestrator/tool-registry.test.ts
git commit -m "feat(orchestrator): tool registry — converts ToolDef to provider ToolDefinition + dispatch"
```

---

### Task 8: Rewrite agent loop using LLMProvider + ToolRegistry

**Files:**
- Modify: `server/src/orchestrator/agent.ts`
- Create: `server/src/orchestrator/agent-v2.test.ts`

This is the load-bearing change. The new loop:
1. Builds the system prompt (existing `buildSystemPrompt`).
2. Constructs the tool registry from existing `ToolDef[]` (built the same way as today, just collected into a flat array).
3. Calls `provider.stream()` in a loop:
   - On `delta` → emit `thought` (Phase 2 will distinguish text from reasoning; for now all text = thought, final assistant turn = `final`).
   - On `tool_call` → check policy hook (existing M3 logic); if denied/timeout → emit `tool_result` with error and continue. If allowed → run via registry through `withTimeout` + stuck-loop emit shadow, then emit `tool_result`, append the tool result to messages.
   - On `done` with `stop_reason !== "tool_use"` → emit `final` with the accumulated assistant text + emit `done` and exit.
   - On `done` with `stop_reason === "tool_use"` → loop again with the appended tool messages.
4. Honour the same `AgentEvent` shape so SSE consumers don't change.

- [ ] **Step 1: Write the failing integration test**

```ts
// server/src/orchestrator/agent-v2.test.ts
import { describe, it, expect, vi } from "vitest";
import { runAgent, type AgentEvent } from "./agent.js";
import { MockLLMProvider } from "./llm/mock-provider.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { openInMemoryDb } from "../state/db.js";

function makeShellTool(): ToolDef {
  return {
    tool: { name: "shell", description: "shell",
      inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
    run: vi.fn().mockResolvedValue({ text: "file1\nfile2", ok: true }),
  };
}

describe("runAgent (v2 loop)", () => {
  it("conversation-only path: no tools dispatched, emits final + done", async () => {
    const provider = new MockLLMProvider({
      scripts: [
        [
          { kind: "delta", text: "Good morning, " },
          { kind: "delta", text: "Sir." },
          { kind: "done", stop_reason: "end_turn" },
        ],
      ],
    });
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: (e) => events.push(e),
      runId: "r1",
      sessionId: "s1",
      db,
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        provider, tools: [],
      } as never,
    } as never);
    expect(events.find((e) => e.kind === "final")?.payload).toEqual({ text: "Good morning, Sir." });
    expect(events.find((e) => e.kind === "tool_call")).toBeUndefined();
    expect(events.find((e) => e.kind === "done")).toBeDefined();
  });

  it("tool path: dispatches a tool_call, packages the result, finalizes", async () => {
    const tool = makeShellTool();
    const provider = new MockLLMProvider({
      scripts: [
        [
          { kind: "tool_call",
            call: { id: "c1", name: "shell", args: { command: "ls" } } },
          { kind: "done", stop_reason: "tool_use" },
        ],
        [
          { kind: "delta", text: "Done." },
          { kind: "done", stop_reason: "end_turn" },
        ],
      ],
    });
    const events: AgentEvent[] = [];
    await runAgent({
      prompt: "list",
      abort: new AbortController(),
      emit: (e) => events.push(e),
      runId: "r1",
      sessionId: "s1",
      db: openInMemoryDb(),
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        provider, tools: [tool],
      } as never,
    } as never);
    expect(tool.run).toHaveBeenCalledWith({ command: "ls" }, expect.objectContaining({ runId: "r1" }));
    expect(events.find((e) => e.kind === "tool_call")?.payload).toMatchObject({ tool: "shell", args: { command: "ls" } });
    expect(events.find((e) => e.kind === "tool_result")?.payload).toMatchObject({ tool: "shell", ok: true });
    expect(events.find((e) => e.kind === "final")?.payload).toEqual({ text: "Done." });
  });

  it("emits killed when the abort signal fires mid-stream", async () => {
    const ac = new AbortController();
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "stalling…" }, { kind: "done", stop_reason: "abort" }]],
    });
    const events: AgentEvent[] = [];
    const promise = runAgent({
      prompt: "x",
      abort: ac,
      emit: (e) => events.push(e),
      runId: "r1", sessionId: "s1", db: openInMemoryDb(),
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [], provider, tools: [] } as never,
    } as never);
    ac.abort();
    await promise;
    expect(events.find((e) => e.kind === "killed")).toBeDefined();
  });
});
```

Note: the test imports `openInMemoryDb` — Phase 1 doesn't change DB schema, so this helper exists already (`server/src/state/db.ts` exports it for tests). If it doesn't, add it as part of this task; it's a one-liner over `better-sqlite3` `:memory:`.

- [ ] **Step 2: Verify the test fails (because agent.ts hasn't been rewritten)**

Run: `npm -w server test -- agent-v2`
Expected: FAIL — likely a type error referencing `provider`/`tools` in `AgentDeps`, or runtime failure because the old loop ignores the mock provider.

- [ ] **Step 3: Rewrite agent.ts**

Replace the file with the new implementation. Key points:
- `AgentDeps` gains `provider: LLMProvider` and `tools: ToolDef[]`.
- `AgentDeps` loses `chrome`/`pidfiles`/`anthropic` only as **direct callers of the SDK** — those still flow in to construct tools, just not used inside the loop. Keep them in the type to maintain compatibility with `chat.ts` deps; the agent passes them through to the tool builders that are now constructed in `chat.ts` or `index.ts` (no behavior change in this task; we keep wiring intact).
- The main loop dispatches `provider.stream()`, handles tool_calls through the registry, applies `withTimeout` + stuck-loop guard + policy hook the same way as M3.

```ts
// server/src/orchestrator/agent.ts
import { buildSystemPrompt } from "./system-prompt.js";
import { buildToolRegistry } from "./tool-registry.js";
import type { LLMProvider, Message, ToolCall } from "./llm/types.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import type { Chrome } from "../tools/chrome.js";
import type { PidfileRegistry } from "../process/pidfile.js";
import { buildPolicyHook, type PolicyHook } from "../policy/runtime.js";
import type { Db } from "../state/db.js";
import type { Approval } from "../state/approvals.js";
import { withTimeout, TOOL_BUDGET_MS } from "./timeout.js";
import { createStuckLoop } from "./stuck-loop.js";

export type AgentEvent =
  | { kind: "thought"; payload: { text: string } }
  | { kind: "tool_call"; payload: { tool: string; args: unknown } }
  | { kind: "tool_result"; payload: { tool: string; ok: boolean; result: string } }
  | { kind: "final"; payload: { text: string } }
  | { kind: "error"; payload: { message: string } }
  | { kind: "killed"; payload: { reason?: "stuck" | "manual" } }
  | { kind: "done"; payload: Record<string, never> }
  | { kind: "approval_required"; payload: { id: string; tool: string; args: unknown; summary: string } }
  | { kind: "approval_resolved"; payload: { id: string; status: "approved" | "denied" | "expired" } };

export type AgentDeps = {
  chrome: Chrome;
  pidfiles: PidfileRegistry;
  fsRoots: string[];
  pushDeliver?: (a: Approval) => Promise<void>;
  provider: LLMProvider;
  tools: ToolDef[];
};

export type RunOpts = {
  prompt: string;
  abort: AbortController;
  emit: (e: AgentEvent) => void;
  runId: string;
  deps: AgentDeps;
  db: Db;
  sessionId: string;
};

export async function runAgent(opts: RunOpts): Promise<void> {
  const { prompt, abort, runId, deps } = opts;
  const stuckLoop = createStuckLoop();
  const innerEmit = opts.emit;
  let stuckReason: "stuck" | undefined = undefined;
  const emit = (e: AgentEvent) => {
    innerEmit(e);
    if (e.kind === "thought") stuckLoop.observeThought(e.payload.text);
    else if (e.kind === "tool_result") {
      const r = stuckLoop.observe({
        tool: e.payload.tool,
        resultText: e.payload.result,
        at: Date.now(),
      });
      if (r.halt && !abort.signal.aborted) {
        innerEmit({ kind: "thought",
          payload: { text: "I've been trying for a while without progress, Sir. Halting." } });
        stuckReason = "stuck";
        abort.abort();
      }
    }
  };

  const policy: PolicyHook = buildPolicyHook({
    db: opts.db, runId, sessionId: opts.sessionId, emit,
    pushDeliver: deps.pushDeliver,
  });

  const system = buildSystemPrompt({ runId });
  const registry = buildToolRegistry({ tools: deps.tools, ctx: { runId } });
  const tools = registry.toolDefinitions();

  const messages: Message[] = [{ role: "user", content: prompt }];
  let finalText = "";

  loop: for (let turn = 0; turn < 32; turn++) {
    if (abort.signal.aborted) break;
    let assistantText = "";
    const pendingCalls: ToolCall[] = [];
    let stopReason: "end_turn" | "tool_use" | "max_tokens" | "abort" | "error" = "end_turn";

    try {
      for await (const ev of deps.provider.stream({
        model: deps.provider.defaultOrchestratorModel,
        system, messages, tools, abort: abort.signal,
      })) {
        if (ev.kind === "delta") {
          assistantText += ev.text;
          emit({ kind: "thought", payload: { text: ev.text } });
        } else if (ev.kind === "tool_call") {
          pendingCalls.push(ev.call);
        } else if (ev.kind === "done") {
          stopReason = ev.stop_reason;
          if (ev.stop_reason === "error") {
            emit({ kind: "error", payload: { message: ev.error ?? "stream error" } });
            break loop;
          }
        }
      }
    } catch (err) {
      emit({ kind: "error", payload: { message: err instanceof Error ? err.message : String(err) } });
      break;
    }

    if (stopReason === "abort" || abort.signal.aborted) {
      emit({ kind: "killed", payload: stuckReason ? { reason: stuckReason } : { reason: "manual" } });
      break;
    }

    if (stopReason === "end_turn" || pendingCalls.length === 0) {
      finalText = assistantText;
      emit({ kind: "final", payload: { text: finalText } });
      break;
    }

    messages.push({ role: "assistant", content: assistantText, tool_calls: pendingCalls });

    for (const call of pendingCalls) {
      if (abort.signal.aborted) break;
      emit({ kind: "tool_call", payload: { tool: call.name, args: call.args } });

      const decision = await policy.evaluate({ tool: call.name, args: call.args });
      if (decision.outcome === "blocked" || decision.outcome === "denied" || decision.outcome === "expired") {
        const result = { call_id: call.id, output: decision.reason ?? decision.outcome, is_error: true };
        emit({ kind: "tool_result", payload: { tool: call.name, ok: false, result: result.output } });
        messages.push({ role: "tool", content: result });
        continue;
      }

      const budget = TOOL_BUDGET_MS[call.name] ?? 30_000;
      try {
        const r = await withTimeout(registry.dispatch(call), budget, call.name);
        emit({ kind: "tool_result", payload: { tool: call.name, ok: !r.is_error, result: r.output } });
        messages.push({ role: "tool", content: r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit({ kind: "tool_result", payload: { tool: call.name, ok: false, result: msg } });
        messages.push({ role: "tool", content: { call_id: call.id, output: msg, is_error: true } });
      }
    }
  }

  emit({ kind: "done", payload: {} });
}
```

- [ ] **Step 4: Adjust unaffected callers — temporary shim in chat.ts**

`chat.ts` currently builds `agentDeps` without `provider` or `tools`. To keep tests green for this single task (Task 8), add a TODO comment marking the wiring deferred to Task 9. Skip this step if `npm -w server test` passes already (mock provider used in tests).

- [ ] **Step 5: Run all tests to verify**

Run: `npm -w server test -- agent-v2`
Expected: PASS — 3 tests.

Run: `npm -w server test`
Expected: existing tests may fail in `chat.ts` integration if it constructed `runAgent` directly. Check the failures — they should be type errors on `AgentDeps` shape. Fix them with the **minimum** wiring change to keep them compiling: declare a type-cast at the call site (`as AgentDeps`) flagged as a TODO, and finish the wiring properly in Task 9.

- [ ] **Step 6: Commit**

```bash
git add server/src/orchestrator/agent.ts server/src/orchestrator/agent-v2.test.ts
git commit -m "feat(orchestrator): rewrite agent loop on LLMProvider + ToolRegistry"
```

---

### Task 9: Wire chat.ts and index.ts to the new agent

**Files:**
- Modify: `server/src/routes/chat.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/chat.test.ts` (existing — adjust deps shape)

- [ ] **Step 1: Read the current wiring**

Re-read `server/src/routes/chat.ts` and `server/src/index.ts` to refresh the wiring shape. The current `chat.ts` builds tools per-run from raw deps (chrome, pidfiles, fsRoots, anthropic). After this task, the **provider** is built once at startup and lives in `index.ts`; the **tools** are also built per-run (no change there) and passed in via deps.

- [ ] **Step 2: Update `agentDeps` in `index.ts`**

Replace the existing `agentDeps` block with:

```ts
import { buildProvider } from "./orchestrator/llm/factory.js";  // added in Task 10

const provider = buildProvider({
  preferred: cfg.llmProvider,
  openaiApiKey: cfg.openaiApiKey,
  anthropicApiKey: cfg.anthropicApiKey,
  log,
});

const agentDeps = {
  pidfiles,
  fsRoots: cfg.fsRoots,
  getChrome,
  pushDeliver,
  provider,
};
```

(`tools` is built per-run in `chat.ts`, so it stays out of `agentDeps`.)

- [ ] **Step 3: Update `chat.ts` to build tools per run and pass them through**

```ts
// in chat.ts, in the run handler, around where tools are currently constructed:
const tools: ToolDef[] = [
  ...buildShellMcp({ allow: shellAllow, runId }),
  ...buildFilesystemTools({
    fs: buildFilesystem({ fsRoots: deps.fsRoots, scrub: scrubSecrets }),
    runId,
  }),
  buildClaudeCodeTool({ deps: { ...deps, claudeCode }, runId, emit }),
  ...buildChromeTools({ chrome: await deps.getChrome(), runId, emit }),
  buildComputerUseTool({ chrome: await deps.getChrome(), client: deps.provider.name === "anthropic" ? metered.anthropic : null, emit }),
];
// (the existing inline construction is moved into a flat array — no behavior change)

await runAgent({
  prompt, abort, emit, runId, sessionId,
  db,
  deps: { ...deps, tools },
});
```

(For now, computer_use still depends on the metered Anthropic client. Phase 1 keeps that path working; Phase 4 swaps in OpenAI's computer_use_preview driver. Add a TODO comment.)

- [ ] **Step 4: Update `chat.test.ts` to construct the new deps shape**

Find each `runAgent` mock and ensure `deps.provider` is supplied (e.g., `new MockLLMProvider({ scripts: [...] })`). The existing tests should otherwise pass.

- [ ] **Step 5: Run the chat tests**

Run: `npm -w server test -- routes/chat`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `npm -w server test`
Expected: PASS across the board, except the side-call modules (auto-title, rule-parser, auto-summary) which still use the Anthropic SDK directly. Their tests should still pass since they were not touched.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/chat.ts server/src/routes/chat.test.ts server/src/index.ts
git commit -m "feat(orchestrator): wire chat + index to new agent loop with provider"
```

---

### Task 10: Provider factory + config

**Files:**
- Create: `server/src/orchestrator/llm/factory.ts`
- Test: `server/src/orchestrator/llm/factory.test.ts`
- Modify: `server/src/config.ts`

- [ ] **Step 1: Write the failing factory test**

```ts
// server/src/orchestrator/llm/factory.test.ts
import { describe, it, expect } from "vitest";
import { buildProvider } from "./factory.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, flush: async () => {} };

describe("buildProvider", () => {
  it("returns OpenAIProvider when preferred=openai and openai key set", () => {
    const p = buildProvider({ preferred: "openai", openaiApiKey: "sk-x", anthropicApiKey: null, log });
    expect(p?.name).toBe("openai");
  });

  it("returns AnthropicProvider when preferred=anthropic and anthropic key set", () => {
    const p = buildProvider({ preferred: "anthropic", openaiApiKey: null, anthropicApiKey: "sk-ant-x", log });
    expect(p?.name).toBe("anthropic");
  });

  it("falls back to the only available key when preferred is unavailable", () => {
    const p = buildProvider({ preferred: "openai", openaiApiKey: null, anthropicApiKey: "sk-ant-x", log });
    expect(p?.name).toBe("anthropic");
  });

  it("returns null when no provider is available", () => {
    const p = buildProvider({ preferred: "openai", openaiApiKey: null, anthropicApiKey: null, log });
    expect(p).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm -w server test -- factory`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory**

```ts
// server/src/orchestrator/llm/factory.ts
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
```

- [ ] **Step 4: Add config field**

Modify `server/src/config.ts`. Add to the `Config` type:

```ts
llmProvider: "openai" | "anthropic";
```

And in `loadConfig()`:

```ts
const rawProvider = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
const llmProvider = rawProvider === "anthropic" ? "anthropic" : "openai";
```

Pass it through in the returned object.

- [ ] **Step 5: Run the factory test**

Run: `npm -w server test -- factory`
Expected: PASS — 4 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm -w server test`
Expected: still green.

- [ ] **Step 7: Commit**

```bash
git add server/src/orchestrator/llm/factory.ts server/src/orchestrator/llm/factory.test.ts server/src/config.ts
git commit -m "feat(orchestrator): provider factory + LLM_PROVIDER config"
```

---

### Task 11: Migrate auto-title to provider.complete()

**Files:**
- Modify: `server/src/orchestrator/auto-title.ts`
- Modify: `server/src/orchestrator/auto-title.test.ts`

- [ ] **Step 1: Read the current implementation**

Confirm the current `auto-title.ts` uses `client.messages.create()` with `claude-haiku-4-5-20251001`. The task is to replace that with `provider.complete()` and accept a provider.

- [ ] **Step 2: Update the test to inject a MockLLMProvider**

Open `auto-title.test.ts`. Replace the Anthropic mock with a MockLLMProvider that scripts a single completion. Assert the completion text is set as the session title.

```ts
// in auto-title.test.ts
import { MockLLMProvider } from "./llm/mock-provider.js";

it("sets the title from provider.complete()", async () => {
  const provider = new MockLLMProvider({ completions: ["Auth tests failing"] });
  // ... existing test setup ...
  await generateAutoTitle({ provider, sessionId, db, log });
  expect(getSession(db, sessionId)?.title).toBe("Auth tests failing");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm -w server test -- auto-title`
Expected: FAIL — `generateAutoTitle` still expects an Anthropic client.

- [ ] **Step 4: Update `auto-title.ts` to take a provider**

```ts
// server/src/orchestrator/auto-title.ts
import type { LLMProvider } from "./llm/types.js";
import type { Db } from "../state/db.js";
import type { Logger } from "../logs/logger.js";
import { updateSessionTitle } from "../state/sessions.js";

const SYSTEM = `You produce session titles.
Output ONLY a 3-7 word phrase summarizing the user's first message. No quotes, no punctuation at the end.`;

export async function generateAutoTitle(opts: {
  provider: LLMProvider;
  sessionId: string;
  firstMessage: string;
  db: Db;
  log: Logger;
}): Promise<void> {
  try {
    const text = await opts.provider.complete({
      model: opts.provider.defaultSideModel,
      system: SYSTEM,
      user: opts.firstMessage,
      maxTokens: 32,
    });
    const cleaned = text.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    if (cleaned.length > 0) {
      updateSessionTitle(opts.db, opts.sessionId, cleaned);
    }
  } catch (err) {
    opts.log.warn({ sessionId: opts.sessionId, err: err instanceof Error ? err.message : String(err) },
      "auto-title failed");
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm -w server test -- auto-title`
Expected: PASS.

- [ ] **Step 6: Update callers**

Search for `generateAutoTitle` in `chat.ts` (or wherever it's invoked); replace the `client` arg with `deps.provider`.

Run: `npm -w server test`
Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add server/src/orchestrator/auto-title.ts server/src/orchestrator/auto-title.test.ts server/src/routes/chat.ts
git commit -m "refactor(orchestrator): auto-title via LLMProvider.complete()"
```

---

### Task 12: Migrate rule-parser to provider.complete()

**Files:**
- Modify: `server/src/policy/rule-parser.ts`
- Modify: `server/src/routes/rules.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Update `rule-parser.ts` signature**

Replace the `client: Anthropic` parameter with `provider: LLMProvider`. Use `provider.complete()` with `provider.defaultSideModel`.

```ts
// server/src/policy/rule-parser.ts
import type { LLMProvider } from "../orchestrator/llm/types.js";

export type ParseResult =
  | { ok: true; parsed: object }
  | { ok: false; reason: string };

const SYSTEM = `You parse natural-language autonomy rules into strict JSON.
Schema: { "match": { "tool"?: string, "args.cwd"?: string[], "args.path"?: string[], "args.command"?: string[] }, "action": "allow" | "ask" | "deny" }
- "tool" is one of: shell, fs_read, fs_write, fs_list, fs_stat, fs_delete, claude_code, chrome_navigate, chrome_click, chrome_type, chrome_press_key, chrome_read_page, chrome_screenshot, chrome_tabs, computer_use. Or "*" for any.
- args.* fields are arrays of glob patterns (picomatch syntax). Use forward slashes; "**" matches across path separators.
- "action" must be exactly "allow", "ask", or "deny".
Return ONLY the JSON object — no preamble, no fences, no explanation.`;

const ACTIONS = new Set(["allow", "ask", "deny"]);

function isValid(parsed: unknown): parsed is { match: object; action: string } {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  if (!o.match || typeof o.match !== "object") return false;
  if (typeof o.action !== "string" || !ACTIONS.has(o.action)) return false;
  return true;
}

export async function parseRule(opts: {
  provider: LLMProvider;
  source: string;
}): Promise<ParseResult> {
  try {
    const text = await opts.provider.complete({
      model: opts.provider.defaultSideModel,
      system: SYSTEM, user: opts.source, maxTokens: 512,
    });
    const trimmed = text.trim();
    let json: unknown;
    try { json = JSON.parse(trimmed); }
    catch { return { ok: false, reason: "invalid JSON in response" }; }
    if (!isValid(json)) return { ok: false, reason: "schema mismatch" };
    return { ok: true, parsed: json };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}
```

- [ ] **Step 2: Update `rules.ts` deps**

Change `RulesDeps` from `{ anthropic: Anthropic | null; log?: Logger }` to `{ provider: LLMProvider | null; log?: Logger }`. Pass through.

- [ ] **Step 3: Update `index.ts` wiring**

Where `rulesRoutes` is mounted, replace `{ anthropic, log }` with `{ provider, log }`.

- [ ] **Step 4: Update existing tests**

Search for `parseRule` in tests. Replace the Anthropic mock with `MockLLMProvider({ completions: ['{"match":{"tool":"fs_read"},"action":"allow"}'] })`.

- [ ] **Step 5: Run all tests**

Run: `npm -w server test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/policy/rule-parser.ts server/src/routes/rules.ts server/src/index.ts server/src/policy/rule-parser.test.ts
git commit -m "refactor(policy): rule-parser via LLMProvider.complete()"
```

---

### Task 13: Migrate auto-summary to provider.complete()

**Files:**
- Modify: `server/src/orchestrator/auto-summary.ts`
- Modify: `server/src/orchestrator/auto-summary.test.ts`
- Modify: `server/src/routes/chat.ts` (caller)

- [ ] **Step 1: Same shape as Task 11/12**

Replace the Anthropic client with `provider: LLMProvider`. Use `provider.defaultSideModel` and a higher `maxTokens` (1024) since summarization is longer. Keep the failure-tolerant behavior (skip on error, raw transcript continues).

- [ ] **Step 2: Update test fixture**

Replace the Anthropic mock with a `MockLLMProvider` scripting one completion.

- [ ] **Step 3: Run tests**

Run: `npm -w server test -- auto-summary`
Expected: PASS.

- [ ] **Step 4: Update caller in chat.ts**

Pass `deps.provider` instead of `metered.anthropic`.

- [ ] **Step 5: Full suite**

Run: `npm -w server test`
Expected: full green.

- [ ] **Step 6: Commit**

```bash
git add server/src/orchestrator/auto-summary.ts server/src/orchestrator/auto-summary.test.ts server/src/routes/chat.ts
git commit -m "refactor(orchestrator): auto-summary via LLMProvider.complete()"
```

---

### Task 14: Provider-swap parity test (optional live, mock-based by default)

**Files:**
- Create: `server/src/orchestrator/llm/parity.test.ts`

The parity test runs the same scripted user input through both `OpenAIProvider` and `AnthropicProvider` against **mocked SDKs** producing equivalent stream events, and asserts both produce the same `AgentEvent` sequence from `runAgent`. Real-API parity is gated behind an env flag and skipped by default.

- [ ] **Step 1: Write the test**

```ts
// server/src/orchestrator/llm/parity.test.ts
import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider } from "./openai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { runAgent, type AgentEvent } from "../agent.js";
import type { ToolDef } from "../../tools/ava-mcp.js";
import { openInMemoryDb } from "../../state/db.js";

function fakeOpenAIChunkSequence() {
  return [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function",
        function: { name: "shell", arguments: '{"command":"ls"}' } }] }, finish_reason: "tool_calls" }] },
  ];
}

function fakeAnthropicChunkSequence() {
  return [
    { type: "content_block_start", index: 0,
      content_block: { type: "tool_use", id: "tu_1", name: "shell", input: {} } },
    { type: "content_block_delta", index: 0,
      delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ];
}

function asAsync(chunks: object[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; } };
}

const tool: ToolDef = {
  tool: { name: "shell", description: "shell",
    inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
  run: vi.fn().mockResolvedValue({ text: "file1\nfile2", ok: true }),
};

describe("provider parity", () => {
  it("same AgentEvent stream from OpenAI and Anthropic providers (mocked SDKs)", async () => {
    let oai = 0;
    const openaiClient = { chat: { completions: { create: vi.fn().mockImplementation(() =>
      Promise.resolve(asAsync(oai++ === 0 ? fakeOpenAIChunkSequence() : [
        { choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] },
      ])),
    ) } } } as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"];

    let an = 0;
    const anthropicClient = { messages: { create: vi.fn().mockImplementation(() =>
      Promise.resolve(asAsync(an++ === 0 ? fakeAnthropicChunkSequence() : [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
      ])),
    ) } } as unknown as ConstructorParameters<typeof AnthropicProvider>[0]["client"];

    const events1: AgentEvent[] = [];
    await runAgent({
      prompt: "list", abort: new AbortController(), emit: (e) => events1.push(e),
      runId: "r1", sessionId: "s1", db: openInMemoryDb(),
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        provider: new OpenAIProvider({ client: openaiClient }), tools: [tool] } as never,
    } as never);

    (tool.run as ReturnType<typeof vi.fn>).mockClear();

    const events2: AgentEvent[] = [];
    await runAgent({
      prompt: "list", abort: new AbortController(), emit: (e) => events2.push(e),
      runId: "r1", sessionId: "s1", db: openInMemoryDb(),
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        provider: new AnthropicProvider({ client: anthropicClient }), tools: [tool] } as never,
    } as never);

    const shape = (events: AgentEvent[]) => events.map((e) => e.kind);
    expect(shape(events1)).toEqual(shape(events2));
    expect(events1.find((e) => e.kind === "final")?.payload)
      .toEqual(events2.find((e) => e.kind === "final")?.payload);
  });
});
```

- [ ] **Step 2: Run the parity test**

Run: `npm -w server test -- parity`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/orchestrator/llm/parity.test.ts
git commit -m "test(orchestrator): provider parity test (mocked SDKs)"
```

---

### Task 15: Cleanup, full smoke, dep removal, commit

**Files:**
- Modify: `server/package.json`
- Modify: `scripts/smoke-test.md`

- [ ] **Step 1: Verify the SDK is unreferenced**

Run: `npm -w server run build 2>&1`
Expected: clean build.

Run: `grep -rn "claude-agent-sdk" server/src` (use Grep tool, not bash grep)
Expected: no matches. If any, finish migrating them and re-run.

- [ ] **Step 2: Remove the unused dependency**

Edit `server/package.json` and remove the line:

```
"@anthropic-ai/claude-agent-sdk": "^0.2.120",
```

Run: `npm install` from repo root to update the lockfile.

- [ ] **Step 3: Re-run the full test suite**

Run: `npm -w server test`
Expected: full green.

Run: `npm -w server run build`
Expected: clean.

- [ ] **Step 4: Manual smoke**

Start the server with `LLM_PROVIDER=openai`:

```bash
npm -w server run start
```

Pair a device, send a chat message — confirm a response streams back. Send an action prompt (`open chrome to https://example.com`) — confirm tool_call/tool_result events on SSE and the action runs.

Restart with `LLM_PROVIDER=anthropic` and repeat. Confirm parity behavior end-to-end.

- [ ] **Step 5: Update smoke-test.md**

Add a new section to `scripts/smoke-test.md`:

```markdown
## M4 Phase 1 — Foundation

- [ ] Start server with `LLM_PROVIDER=openai`. Send "hi" — get a streamed reply.
- [ ] Send "open chrome to https://example.com" — tool_call: chrome_navigate appears.
- [ ] Stop server. Restart with `LLM_PROVIDER=anthropic`. Repeat both — same behavior.
- [ ] No mention of `claude-agent-sdk` in `server/src` (`grep` returns nothing).
```

- [ ] **Step 6: Commit**

```bash
git add server/package.json package-lock.json scripts/smoke-test.md
git commit -m "chore(orchestrator): remove claude-agent-sdk dep, add M4 P1 smoke section"
```

---

## Phase 1 done when

- All 15 tasks committed.
- `npm -w server test` is green.
- `npm -w server run build` is clean.
- M4 Phase 1 smoke section in `scripts/smoke-test.md` ticks pass for both providers.
- The codebase no longer imports `@anthropic-ai/claude-agent-sdk`.

Phase 2 picks up here, layering the memory subsystem on top of the now-direct orchestrator.
