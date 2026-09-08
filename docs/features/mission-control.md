# AVA Mission Control

Status: first observability vertical slice implemented  
Authority: AVA  
First proving ground: OpenAI Realtime voice → AVA action agent → tool execution

Mission Control is AVA's operational view of what is happening, why it is happening, what is waiting, what failed, and what has actually been verified. It opens in a separate browser window beside voice chat but remains part of the same AVA application. Both views consume the same AVA-owned runtime and event stream.

## Experimental Microsoft UFO evidence

The Microsoft UFO integration reuses Mission Control rather than creating a
parallel journal. Synthetic counter requests remain
`experimental_computer_use_fixture` child runs. A genuine bounded Notepad run
is one `experimental_computer_use_runtime` child correlated to the initiating
chat run. Boundary, start, terminal, verification, timeout, cancellation,
restart, and fail-closed events use stable request IDs and dedupe keys.

Real-runtime evidence is deliberately compact: pinned provider release/commit,
fixed fixture/operation, task ID, bounded step count, process exit, independent
Windows UI Automation verification, and the disposable resource reference.
The terminal event says `microsoftUfoRuntime: executed`; it does not infer real
execution from installation health or synthetic success. Usage and cost remain
`not_reported` because this adapter does not receive trustworthy provider
accounting.

UFO's raw task directory can contain prompts, responses, screenshots, and UI
state. AVA extracts only the bounded facts above and deletes that directory
before completing the adapter boundary. Raw stdout/stderr, provider payloads,
secrets, screenshots, UI trees, arbitrary arguments, and hidden reasoning do
not enter the durable event model. Late/replayed events cannot change terminal
projections. Existing retention, export re-redaction, SSE replay, and
action-accounting rules apply unchanged. The initiating tool call owns the
action; the child is evidence-only. See
[`microsoft-ufo-experiment.md`](microsoft-ufo-experiment.md) for the exact
runtime, setup, approval, and verification contract.

## Settled design decisions

These are defaults, not unanswered questions.

| Question | Decision |
| --- | --- |
| Forge boundary | Forge remains a separate control-plane runtime and is also an AVA-integrated subsystem. AVA observes it through an explicit adapter contract. AVA does not reach into Forge's database, bypass its journal, or add a hidden command route. |
| Agent roles | The wire model accepts arbitrary role strings. Canonical role families support stable filtering. The present Forge roster is: specification, repository-analyst, architect, backend-engineer, frontend-engineer, test-engineer, code-reviewer, safety-reviewer, ui-verifier, documentation-writer, and integrator. |
| Run ownership | AVA owns the user/root task, routing, policy, approvals, and root outcome. Forge owns internal scheduling inside an AVA-authorized Forge run. A child agent owns its assigned subtask. Only the executor owns the actual external action and provider usage. |
| Approval ownership | AVA is the sole approval authority. Forge, Codex, Claude Code, and nested agents may request an approval but may not resolve one through a private route. Risky operations use separate typed endpoints. |
| Retention | Sanitized detailed events are retained for 30 days. The objective and event payloads are then removed, leaving a compact outcome for 365 days. Raw secrets are never retained. |
| Default visibility | Operational summaries are visible. Sanitized prompts, responses, messages, and diff bodies are collapsed. Heartbeats and low-level system events are hidden unless technical signals are enabled. Hidden chain-of-thought is neither requested nor stored. |
| Stop behavior | Stop is always scope-explicit. Stopping a root run cascades through its owned current child work. Stopping a child targets only that child when the runtime adapter supports it. Every Stop includes the selected run's expected version, so a stale window cannot stop replacement work. |
| Agent-message privacy | Metadata and a concise sanitized summary are visible by default. Full sanitized content is collapsed. Secrets and hidden reasoning are prohibited. |
| Uncommitted diffs | File names, counts, status, and summary may be visible; sanitized diff content is collapsed. A diff is an artifact, not proof that an outcome is correct. |
| Offline behavior | A connected adapter may locally spool already-authorized, low-risk events using producer sequence numbers. New risky actions and new approvals wait for AVA. Reconnection replays from AVA's acknowledged sequence. This policy is specified but not part of the first slice. |
| v1 controls | The interface is read-only except for a dedicated Stop endpoint. There is no generic mutation endpoint. |
| Window behavior | Mission Control is manually opened from voice. It does not auto-open a popup. The default is a desktop three-pane layout: run tree, live timeline, evidence/context. |
| Screenshots | Off by default. If selective checkpoint capture is added later, avoid credentials/payment surfaces and use a shorter seven-day retention unless explicitly preserved as an artifact. |
| Cost display | Show actual leaf provider usage when the provider supplies it. Show “not reported” instead of manufacturing a number. Parent/run totals are query-time rollups, never re-ingested costs. |
| Direct agent communication | Allowed only among agents inside one AVA-authorized Forge run and only through Forge's recorded router. Cross-environment direct messaging is prohibited; it must route through AVA. |
| Evidence export | A selected run or its AVA-derived trace can be downloaded as bounded JSON. Export is authenticated, read-only, re-sanitized, fixed to a durable high-water cursor, and generated in the browser without a duplicate server-side file. |

## Authority and runtime boundaries

```text
Niko
  ↓
AVA root task / policy / approvals
  ├── AVA voice runtime
  │     └── AVA action agent
  │            └── tool / provider leaf execution
  ├── Forge adapter
  │     └── Forge control plane
  │            ├── Claude Code agents
  │            └── possible hosted Codex agent
  └── future Codex adapter / Codex Forge
```

AVA assigns the root `trace_id`. Each nested run receives a `parent_run_id`; operations receive `span_id`, `parent_span_id`, and `causation_event_id`. Adapters retain stable producer IDs and producer sequence numbers for replay and out-of-order detection.

Codex running inside Forge does not become two executions. Forwarding/router observations use `action_owner=observer|router`. The actual terminal executor event alone uses `action_owner=executor`. Provider request IDs and action IDs remain stable across runtime boundaries. This prevents duplicate actions, cost, token usage, latency, or outcomes.

## Event and storage architecture

```text
runtime wrappers / adapters
          ↓
sanitization before persistence
          ↓
SQLite append-only observability_events
          ├── run projections and metrics
          └── authenticated SSE cursor stream
                         ↓
                Mission Control UI
```

SQLite is authoritative. SSE provides immediacy and cursor replay; the browser does not construct authoritative state by folding untrusted transient messages. A newly opened window starts at the current durable cursor instead of replaying 30 days of heartbeats, while a disconnected window resumes after its last received sequence. Server replay pages through the complete offline gap without a fixed 2,000-event loss boundary. Every meaningful event contains:

- global sequence and stable event ID;
- run, trace, span, parent span, and causation IDs;
- producer ID, producer event ID, and producer sequence;
- runtime, host runtime, actor, and extensible role;
- type, status, title, concise operational summary, and timestamps;
- sanitized payload/error, privacy and visibility classifications;
- action/accounting ownership and stable action/provider IDs;
- duration, token usage, actual provider cost when available;
- terminal, late, and projection-applied flags.

Duplicate producer events are idempotent. Events received after a producer sequence has advanced or after a run is terminal remain in immutable history as `late`, but cannot rewrite the run projection. Startup marks abandoned non-terminal runs `orphaned`. If a Stop owner disappears or rejects a signal, AVA records the failed control event and restores the prior run state instead of leaving a false permanent `cancelling` state.

## Privacy boundary

Sanitization happens before SQLite and is applied again on read. Mission Control never stores or exposes:

- passwords, API keys, cookies, authorization headers, tokens, OTPs, or private keys;
- raw microphone audio or response audio bytes;
- hidden chain-of-thought;
- unsanitized tool arguments/output;
- screenshots captured around credential or payment interfaces.

The frontend has no “request unredacted data” capability. Prompt/response and source-sensitive content is collapsed by default. Evidence export applies the same sanitizer again at export time, excludes collapsed objective and non-detail payload bodies by default, and removes raw audio, screenshots, provider payloads, authorization material, and hidden-reasoning fields even if a legacy record was contaminated.

## Privacy-preserving evidence export

Mission Control exposes one authenticated read-only endpoint:

```text
GET /api/mission-control/runs/:anchorRunId/export?scope=run|trace&format=json
```

The selected run is the authority for both scopes. `scope=trace` derives the
trace ID from that run; clients cannot submit a free-form trace ID. Missing and
removed anchors return the same bounded 404 response. Unknown filters, malformed
run IDs, and unsupported formats return 400.

Every successful document includes:

- API, observability, and export schema versions;
- generation time and the selected run/derived trace scope;
- the durable global event high-water cursor and retained event bounds;
- applied content filters and deterministic run/event ordering;
- run, trace, parent, span, causation, actor, runtime, action, provider, and
  verification/accounting provenance already present in Mission Control;
- exact row counts, observed time span, active runs at the snapshot, and the
  configured limits;
- 30-day detail / 365-day compact retention metadata;
- explicit complete-at-snapshot or partial-due-to-retention state;
- an export-time redaction notice and disclosure rule.

The first version is JSON-only. It permits at most 1,000 combined run/event
rows, 1,000,000 serialized bytes, and a 30-day observed execution span. AVA
returns a typed 413 error rather than silently truncating rows, bytes, or time.
`truncated` is therefore always false in a successful v1 document. A compacted
run is still exportable, but the document says that detailed evidence is partial
and contains only the retained compact outcome.

The SQLite read transaction fixes `highWaterEventSeq` before selecting the
scope. Events arriving afterward remain authoritative history but belong to a
future export; they cannot drift into an in-progress file. Exports do not create
events, change run versions, replay actions, or write files on the server. The
web client creates a temporary Blob from the authenticated response and revokes
its object URL after download.

Default export content is deliberately narrower than the expanded UI. It
includes operational summaries and bounded `detail` evidence; objectives and
non-detail payload bodies are represented only by availability/disclosure
markers. Raw secrets, cookies, authorization data, environment secrets, raw
audio, screenshots, raw provider payloads, unsanitized tool data, and hidden
reasoning are prohibited.

## Implemented vertical slice

The first slice covers:

1. An OpenAI Realtime voice session root run.
2. Accepted, rejected, pending, and expired transcript decisions.
3. Per-utterance child runs.
4. Response start, first-audio latency, completion, token usage, upstream errors, barge-in, cancellation, and disconnects.
5. `do_on_computer` delegation as a router/observer span.
6. The nested `/api/chat` action run with shared trace and causation context.
7. Every AVA agent tool call/result through one instrumentation seam.
8. Sanitized SQLite storage and 30-day detail / 365-day compact retention.
9. Authenticated replayable SSE.
10. A desktop-first run tree, live timeline, status, latency, usage, errors, evidence, and scoped Stop.
11. Authenticated, bounded, export-time-sanitized JSON evidence for a selected run or trace.
12. Source-verified memory retrieval decisions for chat and OpenAI voice, including
    actual search mode, selected checkpoint/source provenance, and an honest reason
    when memory was suppressed or unavailable. Retrieved text and the user query
    are never copied into observability.
13. Agent-driven memory correction, pin, supersession and conflict actions through
    the existing normalized tool-call seam. Direct Memory UI mutations are not
    represented as fake agent runs; their durable append-only governance events
    expose actor, time, reason, target and resulting version on the memory card.

Coverage is deliberately honest:

- OpenAI Realtime voice and AVA chat/action agent: instrumented vertical slice.
- Hume voice: not yet instrumented.
- Forge, Codex, and Claude Code: adapter contract exists, live ingestion is not connected yet.

Deep-research visual creation reuses this same normalized run/event store. The
initiating AVA run receives idempotent `research.visual.planning`, `validated`,
`persisted` or `failed` events. Mission Control can therefore show form
selection, evidence/entity counts, artifact revision and the exact failure
boundary while the final visual remains attached to Chat. Raw research prompts,
source bodies, generated renderer output and secrets are not telemetry. Codex or
Claude activity remains in its existing correlated communication trace; visual
generation does not create a hidden agent channel or double-count their work.

Tool verification evidence now crosses the same normalized boundary as the
executor result. A tool returning `ok` remains an executor report. When a tool
also supplies a bounded, sanitized verification record, Mission Control emits a
separate `verification.evidence.recorded` event with its state, scope, method,
time, and provenance. Task-outcome evidence can project a run as verified;
operation-only evidence projects partial verification. A contradiction or a
later failed tool prevents a mixed run from being promoted to verified. These
events are the evidence source for the playbook verified-learning gate; final
assistant prose is never treated as proof.

## Forge adapter contract

Forge's append-only journal remains authoritative for its internal state machine. An AVA registration supplies:

- AVA trace, parent run/span, and causation context;
- AVA-authorized Forge change/run ID;
- Forge instance and runtime IDs;
- declared roles and adapter schema version;
- the last sequence AVA durably acknowledged.

Forge events are mapped rather than reinterpreted. Unknown future roles remain valid and receive a general role family until classified. A later connection should use an authenticated adapter endpoint with an AVA-issued short-lived runtime lease, batch replay, maximum payload sizes, producer-sequence guards, and no control capability beyond typed requests routed back to AVA.

## Milestones after this slice

1. Instrument Hume with the same voice event grammar.
2. Extend the implemented verification/evidence wrapper beyond the initial filesystem and social-workflow producers.
3. Connect Forge journal ingestion and show its 11 stations, assignments, messages, approvals, artifacts, and test/review outcomes as nested runs.
4. Add explicit Codex and Claude Code adapters, including prompts/responses as sanitized collapsed messages and artifacts/diffs as typed resources.
5. Add health aggregation, latency percentiles, retry/error signatures, cost trends, and stale adapter/agent panels.
6. Add immutable annotations/reviews and links from Mission Control traces into Explorer capability workflows.

## Risks and dependencies

- Provider event schemas and usage fields can change; adapters need contract tests and must display unknown usage honestly.
- A long-running runtime needs heartbeats without turning them into UI noise or inflating action metrics.
- Retention compaction runs at startup and every six hours; future distributed adapters must not assume their own local retention replaces AVA's authoritative policy.
- Forge integration depends on an authenticated push/pull transport and durable acknowledgement protocol.
- Cross-runtime Stop depends on each runtime implementing an idempotent, scope-aware cancellation handler.
- Verification quality depends on tools emitting evidence rather than merely success prose.

## Acceptance criteria for this release

- A voice request and its delegated AVA action appear under one trace with parent/causation links.
- The UI updates live from SSE and recovers from a cursor reconnect without duplicates.
- Tool starts/results expose sanitized inputs, results, duration, and error state.
- Raw audio, credentials, cookies, auth headers, and hidden reasoning are absent from storage and UI.
- A late or out-of-order event cannot rewrite a terminal run.
- A nested executor action and provider request are counted once even if observed by a parent/router.
- Stop is the only Mission Control mutation, is run-scoped, and rejects stale `expectedVersion`.
- Root voice Stop cascades to its current voice turn/action; child Stop does not indiscriminately cancel unrelated work.
- Screenshots are off and cost is shown only when reported.
- Forge is represented as a separate AVA-integrated runtime, with no AVA changes made to Forge for this slice.
