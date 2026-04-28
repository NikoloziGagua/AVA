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
      emit: (e: AgentEvent) => events.push(e),
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
      emit: (e: AgentEvent) => events.push(e),
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
      emit: (e: AgentEvent) => events.push(e),
      runId: "r1", sessionId: "s1", db: openInMemoryDb(),
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [], provider, tools: [] } as never,
    } as never);
    ac.abort();
    await promise;
    expect(events.find((e) => e.kind === "killed")).toBeDefined();
  });
});
