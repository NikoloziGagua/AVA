import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent, type AgentEvent } from "./agent.js";
import { MockLLMProvider } from "./llm/mock-provider.js";
import type { ToolDef } from "../tools/ava-mcp.js";
import { openInMemoryDb, type Db } from "../state/db.js";
import { bootstrapMemoryDir } from "../memory/bootstrap.js";

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
    seedAllowAllRule(db);
    await runAgent({
      prompt: "hi",
      abort: new AbortController(),
      emit: (e: AgentEvent) => events.push(e),
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
