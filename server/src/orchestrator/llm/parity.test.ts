import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAIProvider } from "./openai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import { runAgent, type AgentEvent } from "../agent.js";
import type { ToolDef } from "../../tools/ava-mcp.js";
import { openInMemoryDb, type Db } from "../../state/db.js";
import { bootstrapMemoryDir } from "../../memory/bootstrap.js";

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

function asAsync<T>(chunks: T[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; } };
}

function makeShellTool(): ToolDef {
  return {
    tool: { name: "shell", description: "shell",
      inputSchema: { type: "object", properties: { command: { type: "string" } } } as const },
    run: vi.fn().mockResolvedValue({ text: "file1\nfile2", ok: true }),
  };
}

function openaiTurn1Chunks() {
  return [{
    choices: [{
      delta: { tool_calls: [{ index: 0, id: "c1", type: "function",
        function: { name: "shell", arguments: '{"command":"ls"}' } }] },
      finish_reason: "tool_calls",
    }],
  }];
}
function openaiTurn2Chunks() {
  return [{ choices: [{ delta: { content: "Done." }, finish_reason: "stop" }] }];
}

function anthropicTurn1Chunks() {
  return [
    { type: "content_block_start", index: 0,
      content_block: { type: "tool_use", id: "tu_1", name: "shell", input: {} } },
    { type: "content_block_delta", index: 0,
      delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ];
}
function anthropicTurn2Chunks() {
  return [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
  ];
}

describe("provider parity (mocked SDKs)", () => {
  it("OpenAIProvider and AnthropicProvider produce the same AgentEvent shape", async () => {
    // ---- OpenAI run ----
    let oaiTurn = 0;
    const openaiClient = {
      chat: { completions: { create: vi.fn().mockImplementation(() => {
        const chunks: object[] = oaiTurn++ === 0 ? openaiTurn1Chunks() : openaiTurn2Chunks();
        return Promise.resolve(asAsync(chunks));
      }) } },
    } as unknown as ConstructorParameters<typeof OpenAIProvider>[0]["client"];

    const events1: AgentEvent[] = [];
    const db1 = openInMemoryDb();
    seedAllowAllRule(db1);
    const tool1 = makeShellTool();
    await runAgent({
      prompt: "list", abort: new AbortController(), emit: (e: AgentEvent) => events1.push(e),
      runId: "r1", sessionId: "s1", db: db1,
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider: new OpenAIProvider({ client: openaiClient }), tools: [tool1] } as never,
    } as never);

    // ---- Anthropic run ----
    let anTurn = 0;
    const anthropicClient = {
      messages: { create: vi.fn().mockImplementation(() => {
        const chunks: object[] = anTurn++ === 0 ? anthropicTurn1Chunks() : anthropicTurn2Chunks();
        return Promise.resolve(asAsync(chunks));
      }) },
    } as unknown as ConstructorParameters<typeof AnthropicProvider>[0]["client"];

    const events2: AgentEvent[] = [];
    const db2 = openInMemoryDb();
    seedAllowAllRule(db2);
    const tool2 = makeShellTool();
    await runAgent({
      prompt: "list", abort: new AbortController(), emit: (e: AgentEvent) => events2.push(e),
      runId: "r1", sessionId: "s1", db: db2,
      deps: { chrome: null as never, pidfiles: null as never, fsRoots: [],
        memoryDir: makeMemDir(), provider: new AnthropicProvider({ client: anthropicClient }), tools: [tool2] } as never,
    } as never);

    // Full event-stream equality (kinds and payloads).
    expect(events1).toEqual(events2);
    expect(events1.find((e) => e.kind === "final")?.payload).toEqual({ text: "Done." });

    // Both ran the tool with the same args
    expect(tool1.run).toHaveBeenCalledWith({ command: "ls" }, expect.objectContaining({ runId: "r1" }));
    expect(tool2.run).toHaveBeenCalledWith({ command: "ls" }, expect.objectContaining({ runId: "r1" }));
  });
});
