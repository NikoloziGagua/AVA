import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent, type AgentEvent } from "./agent.js";
import { MockLLMProvider } from "./llm/mock-provider.js";
import { CONSISTENCY_REMINDER_MARKER } from "./tool-result-consistency.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { openInMemoryDb, type Db } from "../state/db.js";
import { bootstrapMemoryDir } from "../memory/bootstrap.js";
import { planComputerExecution } from "./computer-execution-router.js";
import { TaskReceiptBuilder } from "../receipts/task-receipt.js";

function makeMemDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ava-test-mem-"));
  bootstrapMemoryDir({ dir: d });
  return d;
}

function seedAllowAllRule(db: Db): void {
  const now = Date.now();
  db.prepare(
    "INSERT INTO rules (id, source, parsed, enabled, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("test-allow-all", "allow all", JSON.stringify({ match: {}, action: "allow" }), 1, "active", now, now);
}

function makeShellTool(): ToolDef {
  return {
    tool: { name: "shell", description: "shell",
      inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
    run: vi.fn().mockResolvedValue({ text: "file1\nfile2", ok: true }),
  };
}

describe("runAgent (v2 loop)", () => {
  it("executes a deterministic Google route without a provider round-trip", async () => {
    const provider = new MockLLMProvider({});
    const tool: ToolDef = {
      tool: {
        name: "chrome_google_search",
        description: "search",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      run: vi.fn(async () => ({
        ok: true,
        text: "Google is open in AVA Chrome with results for “router proof”.",
        verification: {
          state: "verified" as const,
          scope: "task_outcome" as const,
          method: "chrome_google_search_url",
          summary: "The active page is Google's search route with the exact requested query.",
          observedAt: 1,
        },
      })),
    };
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    await runAgent({
      prompt: "Open Google and search for router proof",
      computerExecutionPlan: planComputerExecution("Open Google and search for router proof"),
      abort: new AbortController(),
      emit: (event) => events.push(event),
      runId: "route-run",
      sessionId: "route-session",
      db,
      deps: {
        chrome: null as never,
        pidfiles: null as never,
        fsRoots: [],
        memoryDir: makeMemDir(),
        provider,
        tools: [tool],
      } as never,
    });

    expect(provider.calls.stream).toHaveLength(0);
    expect(tool.run).toHaveBeenCalledWith(
      { query: "router proof" },
      expect.objectContaining({ runId: "route-run" }),
    );
    expect(events.map((event) => event.kind)).toEqual(["tool_call", "tool_result", "final", "done"]);
    const result = events.find((event) => event.kind === "tool_result");
    expect(result?.payload).toMatchObject({
      tool: "chrome_google_search",
      ok: true,
      verification: { state: "verified", method: "chrome_google_search_url" },
    });

    const receipt = new TaskReceiptBuilder({
      taskId: "route-run",
      objective: "Open Google and search for router proof",
      mode: "action",
      startedAt: 0,
    });
    for (const event of events) receipt.observe(event);
    expect(receipt.snapshot(10)).toMatchObject({
      lifecycle: "finished",
      outcome: "verified",
      verificationScope: "task_outcome",
      verificationMethod: "chrome_google_search_url",
    });
  });

  it("fails closed without invoking the fixed UFO tool for an explicit UFO web request", async () => {
    const provider = new MockLLMProvider({});
    const ufo = vi.fn();
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    await runAgent({
      prompt: "Use Microsoft UFO to open Google and search for AVA",
      computerExecutionPlan: planComputerExecution("Use Microsoft UFO to open Google and search for AVA"),
      abort: new AbortController(),
      emit: (event) => events.push(event),
      runId: "ufo-web-run",
      sessionId: "ufo-web-session",
      db,
      deps: {
        chrome: null as never,
        pidfiles: null as never,
        fsRoots: [],
        memoryDir: makeMemDir(),
        provider,
        tools: [{
          tool: { name: "ufo_runtime_run", description: "fixed proof", inputSchema: { type: "object", properties: {} } },
          run: ufo,
        }],
      } as never,
    });

    expect(provider.calls.stream).toHaveLength(0);
    expect(ufo).not.toHaveBeenCalled();
    expect(events.find((event) => event.kind === "tool_call")).toBeUndefined();
    expect(events.find((event) => event.kind === "final")?.payload).toMatchObject({
      text: expect.stringContaining("cannot operate Google or a browser"),
    });
  });

  it("conversation-only path: no tools dispatched, emits final + done", async () => {
    const provider = new MockLLMProvider({
      scripts: [
        [
          { kind: "delta", text: "Good morning, " },
          { kind: "delta", text: "Sir." },
          {
            kind: "usage",
            usage: {
              providerRequestId: "resp-conversation-1",
              model: "gpt-5.6",
              inputTokens: 80,
              outputTokens: 12,
              cachedTokens: 30,
            },
          },
          { kind: "done", stop_reason: "end_turn" },
        ],
      ],
    });
    const events: AgentEvent[] = [];
    const usage = vi.fn(() => { throw new Error("isolated accounting failure"); });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e),
      recordUsage: usage,
      runId: "r1",
      sessionId: "s1",
      db,
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [],
      } as never,
    } as never);
    expect(events.find((e) => e.kind === "final")?.payload).toEqual({ text: "Good morning, Sir." });
    expect(events.find((e) => e.kind === "tool_call")).toBeUndefined();
    expect(events.find((e) => e.kind === "done")).toBeDefined();
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: "resp-conversation-1",
      inputTokens: 80,
      outputTokens: 12,
    }));
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
    const db2 = openInMemoryDb();
    seedAllowAllRule(db2);
    await runAgent({
      prompt: "list",
      abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e),
      runId: "r1",
      sessionId: "s1",
      db: db2,
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [tool],
      } as never,
    } as never);
    expect(tool.run).toHaveBeenCalledWith({ command: "ls" }, expect.objectContaining({ runId: "r1" }));
    expect(events.find((e) => e.kind === "tool_call")?.payload).toMatchObject({ tool: "shell", args: { command: "ls" } });
    expect(events.find((e) => e.kind === "tool_result")?.payload).toMatchObject({ tool: "shell", ok: true });
    expect(events.find((e) => e.kind === "final")?.payload).toEqual({ text: "Done." });
  });

  it("emits a graceful final (not a silent done) when the turn budget is exhausted", async () => {
    // The model asks for a tool every turn and never concludes, exhausting the
    // loop cap. Each tool result is substantially different so the stuck-loop
    // detector doesn't halt first — we want the turn-budget path specifically.
    // Pin the (now env-overridable) cap low so this stays fast + deterministic.
    process.env.AVA_MAX_AGENT_TURNS = "48";
    let n = 0;
    const looper: ToolDef = {
      tool: { name: "shell", description: "shell",
        inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
      // 60 identical chars, but the char rotates each call → consecutive results
      // differ by ~60 edit distance (> the 50 no-progress threshold).
      run: vi.fn(async () => ({ text: String.fromCharCode(97 + (n++ % 26)).repeat(60), ok: true })),
    };
    const provider = new MockLLMProvider({
      scripts: Array.from({ length: 60 }, () => [
        { kind: "tool_call", call: { id: "c", name: "shell", args: { command: "go" } } },
        { kind: "done", stop_reason: "tool_use" },
      ]) as never,
    });
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "loop without concluding",
      abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e),
      runId: "r-loop", sessionId: "s-loop", db,
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [looper],
      } as never,
    } as never);
    delete process.env.AVA_MAX_AGENT_TURNS;
    const final = events.find((e) => e.kind === "final");
    expect(final).toBeDefined();
    expect((final!.payload as { text: string }).text).toMatch(/step limit/i);
    // Capped at MAX_AGENT_TURNS (pinned to 48 above) tool calls, then a graceful final, then done.
    expect(events.filter((e) => e.kind === "tool_call").length).toBe(48);
    expect(events.at(-1)?.kind).toBe("done");
  });

  it("conversation mode hides tools and uses the side model", async () => {
    const tool = makeShellTool();
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "hi Sir." }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e),
      runId: "r1", sessionId: "s1", db,
      mode: "conversation",
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [tool],
      } as never,
    } as never);
    expect(provider.calls.stream).toHaveLength(1);
    expect(provider.calls.stream[0]!.model).toBe("mock-side");
    expect(provider.calls.stream[0]!.tools).toEqual([]);
    expect(tool.run).not.toHaveBeenCalled();
  });

  it("action mode uses the orchestrator model and exposes tools", async () => {
    const tool = makeShellTool();
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "ok." }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "run the tests",
      abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e),
      runId: "r1", sessionId: "s1", db,
      mode: "action",
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [tool],
      } as never,
    } as never);
    expect(provider.calls.stream[0]!.model).toBe("mock-orchestrator");
    expect((provider.calls.stream[0]!.tools as unknown[]).length).toBeGreaterThan(0);
  });

  it("loads project context into the system prompt when prompt path matches", async () => {
    const memDir = makeMemDir();
    writeFileSync(join(memDir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    mkdirSync(join(memDir, "projects"), { recursive: true });
    writeFileSync(
      join(memDir, "projects", "yov.md"),
      "Root: C:/ai/yov\nNotes: build with npm run dev.\n",
      "utf8",
    );
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "ok." }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "look at C:/ai/yov/package.json",
      abort: new AbortController(),
      emit: () => {},
      runId: "r1", sessionId: "s1", db,
      mode: "action",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: memDir, provider, tools: [makeShellTool()] } as never,
    } as never);
    const sys = String(provider.calls.stream[0]!.system);
    expect(sys).toContain("Project context");
    expect(sys).toContain("npm run dev");
  });

  it("appends project context as user message when a tool-call arg matches a project root", async () => {
    const memDir = makeMemDir();
    writeFileSync(join(memDir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    mkdirSync(join(memDir, "projects"), { recursive: true });
    writeFileSync(
      join(memDir, "projects", "yov.md"),
      "Root: C:/ai/yov\nNotes: yov-specific.\n",
      "utf8",
    );
    const tool = makeShellTool();
    const provider = new MockLLMProvider({
      scripts: [
        [{ kind: "tool_call", call: { id: "c1", name: "shell", args: { command: "ls C:/ai/yov" } } },
         { kind: "done", stop_reason: "tool_use" }],
        [{ kind: "delta", text: "done" }, { kind: "done", stop_reason: "end_turn" }],
      ],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "ls things",  // no project match in prompt
      abort: new AbortController(),
      emit: () => {},
      runId: "r1", sessionId: "s1", db,
      mode: "action",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: memDir, provider, tools: [tool] } as never,
    } as never);
    // Second turn's messages should include the [PROJECT CONTEXT] user message
    expect(provider.calls.stream).toHaveLength(2);
    const secondTurnMessages = provider.calls.stream[1]!.messages;
    const projectMsg = secondTurnMessages.find(
      (m: { role: string; content?: unknown }) =>
        m.role === "user" && typeof m.content === "string" && m.content.startsWith("[PROJECT CONTEXT"),
    );
    expect(projectMsg).toBeDefined();
    expect((projectMsg as { content: string }).content).toContain("yov-specific");
  });

  it("does not re-inject project context when the same project is detected twice", async () => {
    const memDir = makeMemDir();
    writeFileSync(join(memDir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    mkdirSync(join(memDir, "projects"), { recursive: true });
    writeFileSync(join(memDir, "projects", "yov.md"), "Root: C:/ai/yov\n", "utf8");
    const tool = makeShellTool();
    const provider = new MockLLMProvider({
      scripts: [
        // Project already loaded at run start via prompt; tool call into same root.
        [{ kind: "tool_call", call: { id: "c1", name: "shell", args: { command: "ls C:/ai/yov" } } },
         { kind: "done", stop_reason: "tool_use" }],
        [{ kind: "delta", text: "done" }, { kind: "done", stop_reason: "end_turn" }],
      ],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "look at C:/ai/yov",
      abort: new AbortController(),
      emit: () => {},
      runId: "r1", sessionId: "s1", db,
      mode: "action",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: memDir, provider, tools: [tool] } as never,
    } as never);
    const secondTurnMessages = provider.calls.stream[1]!.messages;
    const projectMsg = secondTurnMessages.find(
      (m: { role: string; content?: unknown }) =>
        m.role === "user" && typeof m.content === "string" && m.content.startsWith("[PROJECT CONTEXT"),
    );
    expect(projectMsg).toBeUndefined();
  });

  it("forwards priorMessages as the cacheable prefix and appends prompt as the final user turn", async () => {
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "ack." }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "and also that",
      priorMessages: [
        { role: "user", content: "remember this" },
        { role: "assistant", content: "noted, Sir." },
      ],
      abort: new AbortController(),
      emit: () => {},
      runId: "r1", sessionId: "s1", db,
      mode: "conversation",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [] } as never,
    } as never);
    const sent = provider.calls.stream[0]!.messages;
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ role: "user", content: "remember this" });
    expect(sent[1]).toMatchObject({ role: "assistant", content: "noted, Sir." });
    expect(sent[2]).toMatchObject({ role: "user", content: "and also that" });
  });

  it("conversation mode omits the tool rubric from the system prompt", async () => {
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "hi." }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: () => {},
      runId: "r1", sessionId: "s1", db,
      mode: "conversation",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [] } as never,
    } as never);
    const sys = String(provider.calls.stream[0]!.system);
    expect(sys).not.toContain("# Tools and rubric");
  });

  it("emits killed when the provider reports stop_reason abort", async () => {
    const ac = new AbortController();
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "stalling…" }, { kind: "done", stop_reason: "abort" }]],
    });
    const events: AgentEvent[] = [];
    const db3 = openInMemoryDb();
    seedAllowAllRule(db3);
    const promise = runAgent({
      prompt: "x",
      abort: ac,
      emit: (e: AgentEvent) => events.push(e),
      runId: "r1", sessionId: "s1", db: db3,
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [], memoryDir: makeMemDir(), provider, tools: [] } as never,
    } as never);
    ac.abort();
    await promise;
    expect(events.find((e) => e.kind === "killed")).toBeDefined();
  });

  it("treats Stop during an active tool as cancellation, not a failed result", async () => {
    const ac = new AbortController();
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    const tool: ToolDef = {
      tool: { name: "shell", description: "shell",
        inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
      run: vi.fn(async (_args, ctx) => {
        toolStarted();
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) return resolve();
          ctx.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { text: "ERROR: aborted", ok: false };
      }),
    };
    const provider = new MockLLMProvider({
      scripts: [[
        { kind: "tool_call", call: { id: "c-stop", name: "shell", args: { command: "wait" } } },
        { kind: "done", stop_reason: "tool_use" },
      ]],
    });
    const events: AgentEvent[] = [];
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    const running = runAgent({
      prompt: "wait until I stop this",
      abort: ac,
      emit: (event) => events.push(event),
      runId: "r-stop-tool", sessionId: "s-stop-tool", db,
      mode: "action",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [tool] } as never,
    });

    await started;
    ac.abort();
    await running;

    expect(events.filter((event) => event.kind === "tool_call")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "tool_result")).toHaveLength(0);
    expect(events.filter((event) => event.kind === "killed")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "final")).toHaveLength(0);
    expect(events.at(-1)?.kind).toBe("done");
  });
});

describe("runAgent — result-consistency reminder", () => {
  function toolReturning(result: { text: string; ok: boolean }): ToolDef {
    return {
      tool: { name: "shell", description: "shell",
        inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
      run: vi.fn().mockResolvedValue(result),
    };
  }

  // Two-turn script: turn 1 calls the tool, turn 2 produces a (would-be) final.
  function twoTurnProvider(): MockLLMProvider {
    return new MockLLMProvider({
      scripts: [
        [{ kind: "tool_call", call: { id: "c1", name: "shell", args: { command: "go" } } },
         { kind: "done", stop_reason: "tool_use" }],
        [{ kind: "delta", text: "All done, Sir." }, { kind: "done", stop_reason: "end_turn" }],
      ],
    });
  }

  async function run(tool: ToolDef, provider: MockLLMProvider): Promise<void> {
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "do the thing",
      abort: new AbortController(),
      emit: () => {},
      runId: "r1", sessionId: "s1", db,
      mode: "action",
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [tool] } as never,
    } as never);
  }

  function reminderMessages(provider: MockLLMProvider): unknown[] {
    // messages is a single mutated array shared across turns; inspect final state.
    const msgs = provider.calls.stream.at(-1)!.messages as Array<{ role: string; content?: unknown }>;
    return msgs.filter(
      (m) => m.role === "user" && typeof m.content === "string" &&
        (m.content as string).includes(CONSISTENCY_REMINDER_MARKER),
    );
  }

  it("injects the reminder after a failed action-tool result", async () => {
    const provider = twoTurnProvider();
    await run(toolReturning({ text: "command not found", ok: false }), provider);
    expect(provider.calls.stream).toHaveLength(2);
    const reminders = reminderMessages(provider);
    expect(reminders).toHaveLength(1);
    expect(String((reminders[0] as { content: string }).content).toLowerCase()).toContain("failure");
  });

  it("injects the reminder after a partial/uncertain action-tool result", async () => {
    const provider = twoTurnProvider();
    await run(toolReturning({ text: JSON.stringify({ status: "partial", done: 2, total: 5 }), ok: true }), provider);
    const reminders = reminderMessages(provider);
    expect(reminders).toHaveLength(1);
    expect(String((reminders[0] as { content: string }).content).toLowerCase()).toContain("partial");
  });

  it("does NOT inject the reminder after a clean success", async () => {
    const provider = twoTurnProvider();
    await run(toolReturning({ text: JSON.stringify({ ok: true, text: "file1\nfile2" }), ok: true }), provider);
    expect(provider.calls.stream).toHaveLength(2);
    expect(reminderMessages(provider)).toHaveLength(0);
  });
});

describe("runAgent reasoning passthrough", () => {
  it("forwards opts.reasoningEffort to provider.stream", async () => {
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "ok" }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: () => {},
      runId: "r1",
      sessionId: "s1",
      db,
      mode: "action",
      reasoningEffort: "medium",
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [],
      } as never,
    } as never);
    expect(provider.calls.stream[0]!.reasoningEffort).toBe("medium");
  });

  it("falls back to mode-default when reasoningEffort is undefined", async () => {
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "ok" }, { kind: "done", stop_reason: "end_turn" }]],
    });
    const db = openInMemoryDb();
    seedAllowAllRule(db);
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: () => {},
      runId: "r1",
      sessionId: "s1",
      db,
      mode: "conversation",
      deps: {
        chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider, tools: [],
      } as never,
    } as never);
    expect(provider.calls.stream[0]!.reasoningEffort).toBe("none");
  });
});
