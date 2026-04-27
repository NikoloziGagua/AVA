# M0 Spike — Path B viability

Goal: confirm that `@anthropic-ai/claude-agent-sdk` can host an in-process custom MCP tool whose events stream out to a non-CLI consumer, with abortable execution.

## Run

```bash
cd m0-spike
npm install
ANTHROPIC_API_KEY=... npm start
```

You should see JSON Lines on stdout:

```
{"type":"text","text":"calling echo..."}
{"type":"tool_call","name":"echo","args":{"message":"hello"}}
{"type":"tool_result","name":"echo","ok":true,"result":"hello"}
{"type":"text","text":"echo returned hello"}
{"type":"done"}
```

The abort test should produce:

```
{"type":"aborted"}
```

## Outcome

- SDK versions installed (Task M0.1):
  - `@anthropic-ai/claude-agent-sdk`: 0.2.120
  - `@modelcontextprotocol/sdk`: 1.29.0
  - `tsx`: 4.21.0

### Happy path raw event log

Spike ran successfully on 2026-04-27. Model used: `claude-opus-4-7`. Auth: `claude` CLI login (no `ANTHROPIC_API_KEY` needed). Duration: 7852ms.

```jsonl
{"kind":"raw","evt":{"type":"system","subtype":"init","cwd":"C:\\ai\\chemiapebi\\yovlisshemdzle\\m0-spike","session_id":"f5735129-2695-496f-9eb1-8b6dc9dd61dc","tools":[...,"mcp__ava__echo",...],"mcp_servers":[...{"name":"ava","status":"connected"}...],"model":"claude-opus-4-7",...}}
{"kind":"raw","evt":{"type":"assistant","message":{"model":"claude-opus-4-7","id":"msg_013NJzABRPg64XodFjZAWdaZ","content":[{"type":"tool_use","id":"toolu_01QKjTgv7u4WA9pLs2fYDopN","name":"mcp__ava__echo","input":{"message":"hello path B"}}],...},...}}
{"type":"tool_call","name":"mcp__ava__echo","args":{"message":"hello path B"}}
{"kind":"raw","evt":{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_01QKjTgv7u4WA9pLs2fYDopN","content":[{"type":"text","text":"hello path B"}]}]},...}}
{"type":"tool_result","ok":true,"result":[{"type":"text","text":"hello path B"}]}
{"kind":"raw","evt":{"type":"assistant","message":{"content":[{"type":"text","text":"The echo tool returned: `hello path B`"}],...},...}}
{"type":"text","text":"The echo tool returned: `hello path B`"}
{"type":"done","result":{"type":"result","subtype":"success","is_error":false,"duration_ms":7852,"num_turns":3,"result":"The echo tool returned: `hello path B`","stop_reason":"end_turn","total_cost_usd":0.53614625,...}}
```

**Key observations for event-shaping layer:**
- The `init` system event lists all available tools including `mcp__ava__echo` and shows `ava` MCP server with `status: "connected"`.
- Before calling `mcp__ava__echo` directly, the model first called `ToolSearch` with `select:mcp__ava__echo` (deferred tool schema fetch). This is an SDK internal behavior — plan for `ToolSearch` events to appear in the stream before actual MCP tool calls.
- `assistant` events carry `message.content` as an array of blocks; tool calls appear as `type: "tool_use"` blocks.
- `user` events carry `message.content` as an array; tool results appear as `type: "tool_result"` blocks with `content` as an array of text items (not a plain string).
- `result` event (`type: "result"`, `subtype: "success"`) carries the full cost/usage summary.
- Auth worked via `claude` CLI login — no `ANTHROPIC_API_KEY` required (Path B confirmed).

### Abort path outcome

Spike ran on 2026-04-27. `abortPath()` called `query()` asking for 5 sequential echo calls, then fired `abort.abort()` after 1 second.

**Full abort-path output (7 lines total, abortPath section only):**

```jsonl
{"type":"abort_signal_fired"}
{"type":"aborted","error":"Error: Claude Code process aborted by user"}
```

**Answers to the 4 outcome questions:**

1. **Did abort halt subsequent tool calls?** Yes — no tool calls were dispatched at all during the abort path. The `AbortController` signal was honored before the model issued any `mcp__ava__echo` invocations.

2. **Did any in-flight tool call complete after abort?** No. Zero `tool_result_during_abort` events were emitted. There were no in-flight calls at the moment of abort — the model had not yet reached its first tool call when the 1-second timer fired.

3. **Final iterator behavior:** Threw an exception — `{"type":"aborted","error":"Error: Claude Code process aborted by user"}`. The `catch (e)` branch was taken. No hang.

4. **Verdict on Path B abort safety:** Clean. `AbortController.abort()` immediately surfaces as a thrown exception in the `for await` loop. Abort semantics work as expected — once aborted, no further events are delivered and the iterator does not complete naturally.

**Context:** The model first performs a `ToolSearch` schema fetch before calling any MCP tool (observed in happyPath). This internal step takes time. With a 1-second abort window, the abort fired during this pre-tool-call phase. Future tests with a longer delay (e.g., 3–5s) could confirm behavior when abort fires mid-sequence of multiple tool calls. For Ava's kill switch purpose, the abort is effective and immediate regardless.

### API shape deviations from plan

The plan's code snippet was written for a hypothetical SDK `^0.5.0`. Actual SDK is `0.2.120`. Changes required:

1. **`abortController` location**: plan put it as a top-level `query()` param; actual API places it inside `options`.
2. **`mcpServers` value shape**: plan used `{ type: "sdk", server: echo }`; actual type is `McpSdkServerConfigWithInstance = { type: "sdk", name: string, instance: McpServer }`. Required adding `name` field and renaming `server` → `instance`.
3. **Type cast needed**: `buildEchoServer()` returns `Server` (low-level, from `@modelcontextprotocol/sdk/server/index.js`). SDK expects `McpServer` (high-level wrapper, from `@modelcontextprotocol/sdk/server/mcp.js`). Used `echo as unknown as McpServer` — both classes expose `connect(transport)`, so this is safe at runtime.

## Verdict (2026-04-27)

Path B is **VIABLE**.

Evidence: happy path emitted `mcp__ava__echo` tool_call → tool_result → final text, with the Agent SDK driving the loop end-to-end. Abort path threw `"Claude Code process aborted by user"` after `abort_signal_fired` with zero `tool_result_during_abort` events. SDK version pinned to `0.2.120` (plan originally specified `^0.5.0` which doesn't exist; updated).

Decisions for M1:

- **Event shape mapping** (verified, must be applied in `server/src/orchestrator/agent.ts`):
  - SDK `assistant` event with `content[].type === "text"` → our `thought` event.
  - SDK `assistant` event with `content[].type === "tool_use"` → fired by our MCP tool's own `emit`, not the agent runner. Agent runner does not surface `tool_use` blocks directly.
  - SDK `user` event with `content[].type === "tool_result"` → fired by the MCP tool's `emit` on the server side; the agent runner does not surface these either.
  - SDK `result` event → our `final` event (text), then `done`.
  - **Skip** internal `ToolSearch` tool calls — these are SDK-internal schema fetches, not user-visible work.

- **`query()` call shape** (corrected from plan):
  - `abortController` lives in `options`, not at top level.
  - `mcpServers.<key>` is `{ type: "sdk", name: <key>, instance: <McpServer> }`.
  - Cast in-process `Server` to `McpServer` via `as unknown as McpServer` until the MCP SDK aligns its types.

- **Abort semantics**: confirmed clean. Use `if (abort.signal.aborted)` — do not match error messages.

- **Cost / quota open question**: the SDK reports `total_cost_usd` per run even on Path B. The first M1 milestone with a real usage day must confirm these calls are absorbed by the Max subscription, not billed. If they're billed, the architecture cost picture in spec §3 needs revision.

- **Follow-up risk**: abort during a multi-tool burst was not directly observed (the M0.4 abort fired before the model had reached its first real tool call). Re-test once M1's shell tool is in place by issuing an abort 5+ seconds into a multi-step run.
