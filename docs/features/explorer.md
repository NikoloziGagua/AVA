# AVA Explorer

AVA Explorer is the operational view behind the existing **Explore** navigation
item. It connects AVA's source-declared capability model to current runtime
evidence and durable execution traces.

## First instrumentation release

This release implements the foundation required for Explorer to be truthful:

- a data-driven registry of 22 domains and 29 capabilities;
- a top-down operational workflow tree for every declared capability, including
  explicit branches, fallbacks, stop conditions and verification steps;
- a deeper Instagram tree that starts at opening Instagram and branches into
  profile and messages work before recipient resolution, reading, sending and
  verification;
- separate static definition, readiness, health and execution evidence;
- append-only operational events for newly started AVA runs;
- Task Inspector and Live views backed by runtime data;
- a Learned Workflows view populated directly from AVA's durable procedural
  playbooks and refreshed while Explorer is open;
- current capability health with evidence sources and confidence;
- Atlas depth levels: overview, detailed and technical;
- persistent Atlas breadcrumbs, one-level Back controls and a direct return to
  the full system map;
- visible Reviews and Evolution foundations without fabricated history.

Explorer deliberately does **not** reconstruct tool traces from old chat prose.
AVA did not persist those events before this release. The UI and API return a
coverage note explaining that only newly instrumented chat-agent lifecycle and
tool events are available. Direct realtime voice turns, session-persistence
side effects, memory writes outside the agent event seam and detached subsystem
internals are not presented as complete traces.

## Runtime data flow

```text
POST /api/chat
  -> create task using the run ID
  -> central AgentEvent emitter
      -> redact operational event
      -> append Explorer event to SQLite
      -> publish existing chat SSE event
  -> record terminal task state
  -> Explorer read APIs
  -> Atlas / Tasks / Live / Health
```

`server/src/routes/chat.ts` is the first instrumentation seam because chat tool
calls and results already pass through it. Text actions and voice
computer-action handoffs that enter `/api/chat` use the recorder. Other
subsystems must emit their own structured events before Explorer can claim
complete coverage of them.

## Persistence

`explorer_tasks` stores the current task projection. `explorer_events` stores
the ordered append-only event history. Event sequence is unique within a task.

Deleting or later purging a chat session sets the task's `session_id` to null;
it does not silently erase Explorer history. Event rows are removed only if an
Explorer task itself is explicitly removed in a future deletion workflow.

On server startup, any task still marked `running` receives an interruption
event and is closed as `interrupted`.

## API

All Explorer endpoints require the normal device token:

- `GET /api/explorer/meta`
- `GET /api/explorer/tasks`
- `GET /api/explorer/tasks/:id`
- `GET /api/explorer/live`
- `GET /api/explorer/capabilities`
- `GET /api/explorer/workflows`
- `GET /api/explorer/meta`
- `GET /api/explorer/workflows`

The task list supports `limit`, `offset` and `status`, and returns `total` plus
`hasMore`. Task Inspector can load records beyond the latest 100 without
silently dropping old history. Live state comes from the in-memory active-run
registry; the SQLite database remains authoritative for durable task detail.

`/api/explorer/workflows` reads the same procedural-memory files used by AVA's
playbook recall system. A newly captured or revised playbook therefore appears
in Explorer on its next refresh; it is not copied into a hand-maintained UI
catalogue. The response keeps stored steps, recall counters, outcome counters
and provenance separate. The present playbook schema does not store canonical
capability IDs or originating task IDs, so Explorer labels those links as not
recorded instead of guessing.

`/api/explorer/meta` identifies the running Explorer API version. Unknown API
routes return structured JSON. This allows the interface to distinguish an
empty registry from a stale server process and give an actionable rebuild and
restart instruction rather than an opaque “unavailable” message.

`/meta` identifies the Explorer API version and the time the serving backend
started. The web client reports an actionable build-mismatch error when a newer
Explorer interface is accidentally served by an older, still-running backend.
Unknown `/api/*` routes return JSON rather than Express's HTML fallback.

`/workflows` reads AVA's current procedural-memory playbooks on every request.
It does not insert demo workflows. Each result identifies its durable source,
stored steps, revision and recall counters. The response also states the
current evidence gap honestly: the playbook format does not yet persist
canonical capability IDs, linked task IDs or how the playbook was created.

## Privacy boundary

Explorer redacts before persistence and redacts again on read:

- key-shaped passwords, tokens, API keys and authentication fields;
- Authorization, cookie and API-key headers in objects, tuples, JSON strings
  and raw HTTP text;
- complete private-key blocks, including their encoded bodies;
- common inline shell forms such as secret flags, environment assignments and
  URL user information;
- known secret formats handled by the shared secret scrubber;
- spoken or textual password/passcode/key phrases;
- approval arguments, which are never copied into Explorer;
- oversized values, which are truncated.

Raw provider thoughts and streaming text deltas are never persisted as Explorer
events. Explorer records operational actions, concise event titles and the
final response—not hidden reasoning.

## Evidence semantics

A recorded event proves only that the runtime observed that event. A successful
tool return or final AVA response is not automatically independent verification.
Until dedicated verification events are emitted, a run that produces a final
response is `finished_unverified`, or `finished_with_errors_unverified` when
tool errors were recorded. The interface labels this as **Final response
recorded**, not “completed,” and displays `not_recorded` verification.

Current capability checks may prove configuration, a local-store read, a
dependency state or a runtime probe. They must not be interpreted as a complete
end-to-end test unless the evidence explicitly says so.

## Next slices

1. Add explicit verification and artifact records.
2. Attach stable tool-call IDs and parent event relationships.
3. Persist review observations and approved lessons immutably.
4. Persist canonical capability and originating-task IDs when playbooks are
   captured, then link learned workflows bidirectionally.
5. Overlay actual task events on the matching workflow nodes.
6. Record semantic release changes and compare capability health over time.
7. Add task/event streaming keyed by task ID for instant live replay.
8. Consolidate the server runtime registry and the detailed Atlas registry into
   one shared contract; the current build enforces their tool-ID bridge with
   `scripts/validate-explorer-contract.mjs`.
