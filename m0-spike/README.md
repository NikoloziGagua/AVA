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

(Spike run results filled in by Task M0.5.)
