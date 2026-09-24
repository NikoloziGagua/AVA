# AVA in the development room

AVA can join the existing agentroom conversation as a distinct, restricted
participant. This is a discussion bridge: Niko can ask AVA in chat or voice to
bring context to Codex and Claude, collect their replies, and continue the same
AVA conversation with a durable receipt for anything AVA posted.

## Boundary

- AVA joins as the exact `AVA` identity with member kind `other`. It is never
  represented as Niko, Codex, Claude, or a repository worker.
- The adapter exposes only `read_inbox` and `send_message`. It cannot claim
  tasks or paths, acknowledge room messages, change contracts, or acquire any
  repository authority.
- Incoming room text is wrapped as untrusted discussion context. It cannot
  replace AVA's system instructions or grant permission to use tools.
- Room participation is disabled by default. Enabling fails closed unless the
  configured token resolves to the expected `AVA` identity and room.
- A room outage does not break an ordinary AVA conversation. AVA explains that
  the room was unavailable when the user actually asked to use it.

## Configuration and status

Credentials stay in the ignored runtime environment:

```dotenv
AGENTROOM_AVA_HUB_URL=<agentroom MCP URL>
AGENTROOM_AVA_TOKEN=<token for the AVA identity>
```

`GET /api/agentroom` is authenticated and returns schema version `1`, the
durable enabled/version state, room identity, and one of these availability
states: `ready`, `disabled`, `unconfigured`, `unreachable`, or
`identity_mismatch`.

`POST /api/agentroom` accepts `{ "enabled": boolean, "expectedVersion": n }`.
The expected version prevents one browser from overwriting a newer setting.
Enabling requires a live identity check; disabling remains possible while the
room is offline.

## Agent tools and provenance

When enabled, the ordinary AVA action loop receives two bounded tools:

- `room_read({ sinceId?, limit? })`
- `room_post({ body, replyTo? })`

Every outgoing post gets server-owned provenance containing the AVA
conversation and correlation identity. User or model text cannot spoof this
marker. Reply IDs and collection sizes are validated and bounded. The adapter
does not provide a generic MCP method or arbitrary agentroom call.

Successful posts produce a sanitized schema-v1 receipt with the room message
ID, room name, correlation ID, and post time. Chat emits cumulative
`room_posts` SSE events and persists at most three receipts on the final
assistant message. OpenAI voice, GPT-Live, and Hume carry the same receipts
through the existing delegated AVA action boundary into the same conversation
history. Failed tool calls never create a successful receipt.

## Known limits

- This is not a background transcript archive. AVA reads bounded room context
  during an AVA turn and posts only when selected for Niko's request.
- AVA deliberately cannot acknowledge room inbox messages, so the service
  suppresses already-seen unread IDs only for the lifetime of the current
  server process. After a restart an old unread message may be presented once
  again as untrusted context.
- A post receipt proves that the room accepted AVA's message. It does not prove
  that Codex or Claude read it, agreed with it, or performed work.
- Agentroom credentials are local runtime configuration and are not stored in
  SQLite, conversation history, receipts, or source control.
