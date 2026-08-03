# Task result receipts — first vertical slice

## Purpose

Niko asked for visibility to be treated as part of every AVA improvement. The
first bounded implementation adds a compact receipt to the typed chat execution
path. It answers, in plain language:

- What AVA was asked to do
- What was actually observed
- Whether the run is still active, awaiting approval, finished, blocked,
  cancelled, or failed
- Whether the outcome is verified, partial, unverified, or failed
- The last proven-good operational stage
- The first failure or uncertainty observation point
- Whether the cause is known, likely, unknown, or not applicable
- The recommended recovery action
- The task ID used to find the durable Mission Control trace

The compact card expands into expected-versus-actual details, a bounded
evidence trail, counts, timing, root-cause status, and the task ID.

## Selected path

The first path is a typed `POST /api/chat` agent run. It was selected because it
already has:

- One server-owned run ID
- One operational event seam used by every tool
- Existing approval, cancellation, Explorer, and Mission Control integration
- An authenticated SSE stream to the conversation UI
- A final-response boundary that the UI can observe independently of AVA's
  prose

No Explorer or Forge code is changed.

## Flow

```text
Typed request
  → chat route creates run/task ID
  → TaskReceiptBuilder observes sanitized AgentEvents
  → approval snapshot or terminal receipt emitted over chat SSE
  → MessageList shows compact TaskReceiptCard
  → user expands evidence and recovery details
```

`TaskReceiptBuilder` ignores reasoning and streamed token deltas. It never
copies raw tool arguments or full successful tool output. Failed/uncertain
details are secret-scrubbed, whitespace-normalized, and capped before entering
the receipt.

## Honest verification boundary

Lifecycle and outcome quality are separate dimensions.

| Example | Lifecycle | Outcome |
| --- | --- | --- |
| Conversational response reached the chat stream | finished | verified — response delivery only |
| Tool returned success but no independent outcome check ran | finished | unverified |
| Some work succeeded before a failed/uncertain step | finished | partial |
| Protected action denied or expired | blocked | failed |
| Agent runtime returned an error | failed | failed |
| Niko pressed Stop after some work | cancelled | partial |

A successful tool return is recorded as operational evidence, but it does not
automatically verify an external effect. The receipt explicitly says where
evidence stopped. The first slice does not yet recognize workflow-specific
verifiers for browser, file, Instagram, WhatsApp, or desktop actions.

## Transport and retention

- Receipt event: `receipt` on the existing authenticated chat SSE stream.
- Correlation: the `taskId` returned by `POST /api/chat` is sent back when the
  browser opens the stream.
- Fast-finish race: the latest sanitized terminal receipt is kept in process
  memory for at most five minutes per session so an agent that finishes before
  EventSource connects can still replay it.
- The short replay cache is not durable. A restart clears it.
- No new database table, retention policy, authentication rule, or permission
  is introduced.
- Mission Control remains the existing durable technical trace. The receipt's
  task ID is the Mission Control run ID.

## Files

- Server model and classifier: `server/src/receipts/task-receipt.ts`
- Chat SSE integration and bounded replay: `server/src/routes/chat.ts`
- Frontend event contract: `web/src/chat/task-receipt.ts` and
  `web/src/chat/useChatStream.ts`
- Conversation UI: `web/src/chat/TaskReceiptCard.tsx` and
  `web/src/chat/MessageList.tsx`

## Verification

Tests deliberately use synthetic AgentEvents and an isolated fake chat runtime.
They do not disrupt a live tool or external service.

Covered cases:

- Verified conversational delivery without an external-success claim
- Successful action tool that remains unverified
- Partial outcome
- Runtime failure
- Awaiting-approval and blocked lifecycle states
- Manual cancellation
- Secret redaction
- Fast-finish SSE replay with exact task correlation
- Rejection of a stale receipt from a different task ID
- Compact and expanded UI rendering
- Lifecycle and outcome displayed separately

## Known limitations

- The first slice is visible for current/recent typed chat runs. Receipts are
  not reconstructed as cards after the five-minute replay window or a server
  restart; Mission Control still holds the technical trace.
- Voice uses the same underlying agent for delegated computer actions, but the
  voice UI does not render this card yet.
- Tool success is deliberately conservative. Workflow-specific independent
  verification must be added one capability at a time.
- A tool's error is a failure observation point. It is not automatically a
  confirmed root cause.

## Disablement and reversion

The feature can be reverted as one scoped commit. At runtime there is no new
stored state to migrate or delete. Removing the `receipt` SSE emission and the
`TaskReceiptCard` render restores the prior conversation behavior; Mission
Control and Explorer remain unchanged.
