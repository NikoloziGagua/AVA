// m0-spike/src/spike.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildEchoServer } from "./echo-tool.js";

function emit(event: unknown) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

async function happyPath() {
  const abort = new AbortController();
  const echo = buildEchoServer();

  // Deviation from plan: abortController is inside options (not a top-level param).
  // Deviation from plan: mcpServers value shape is { type, name, instance } not { type, server }.
  // echo-tool returns Server (low-level), SDK expects McpServer (high-level wrapper).
  // Both have connect(transport), so the cast is safe at runtime.
  const result = query({
    prompt:
      "Call the echo tool with the message 'hello path B'. Then say what it returned.",
    options: {
      abortController: abort,
      mcpServers: {
        ava: {
          type: "sdk",
          name: "ava",
          instance: echo as unknown as McpServer,
        },
      },
      allowedTools: ["mcp__ava__echo"],
      // Path B: orchestrator on Max subscription. Worker auth = `claude` CLI login.
    },
  });

  for await (const evt of result) {
    emit({ kind: "raw", evt });
    if (evt.type === "assistant" && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block.type === "text") emit({ type: "text", text: block.text });
        if (block.type === "tool_use")
          emit({ type: "tool_call", name: block.name, args: block.input });
      }
    }
    if (evt.type === "user" && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block.type === "tool_result") {
          emit({
            type: "tool_result",
            ok: !block.is_error,
            result:
              typeof block.content === "string"
                ? block.content
                : block.content,
          });
        }
      }
    }
    if (evt.type === "result") emit({ type: "done", result: evt });
  }
}

await happyPath();

async function abortPath() {
  const abort = new AbortController();
  const echo = buildEchoServer();

  const result = query({
    prompt: "Call the echo tool 5 times in a row with messages '1','2','3','4','5'.",
    options: {
      abortController: abort,
      mcpServers: {
        ava: {
          type: "sdk",
          name: "ava",
          instance: echo as unknown as McpServer,
        },
      },
      allowedTools: ["mcp__ava__echo"],
    },
  });

  // Abort after 1 second
  setTimeout(() => {
    abort.abort();
    emit({ type: "abort_signal_fired" });
  }, 1000);

  try {
    for await (const evt of result) {
      if (evt.type === "user" && Array.isArray(evt.message?.content)) {
        for (const block of evt.message.content) {
          if (block.type === "tool_result") emit({ type: "tool_result_during_abort" });
        }
      }
    }
    emit({ type: "iterator_completed_naturally" });
  } catch (e) {
    emit({ type: "aborted", error: String(e) });
  }
}

await abortPath();
