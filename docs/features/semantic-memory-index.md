# Semantic memory index

## Status

Implemented as a conservative automatic-and-explicit beta with immutable linked
Idea checkpoints, source-verified committed improvement records, automatic recall
across chat and voice, and append-only user governance. It is a retrieval layer
for substantial research, developed ideas, decisions and shipped AVA changes; it does not
replace AVA's compact preference/observation memory or copy complete transcripts.

## User contract

1. A successfully completed research turn or an idea meaningfully developed by
   both Sir and AVA is offered to the automatic memory gate. Greetings, routine
   execution, incomplete work and ordinary conversation are rejected locally.
2. A conservative side-model editor may produce a bounded compact record. It can
   decline the candidate; its failure never changes or delays chat/voice delivery.
   After an Idea has a first checkpoint, only a deterministic change signal can
   ask the editor for another. The editor must identify a material decision,
   conclusion, topic shift, open question, next step or substantive revision.
3. Sir can still say **"remember this"** or **"index this discussion"** for
   anything worth keeping outside the two automatic categories. AVA calls
   `memory_index_capture` with a bounded source range and a compact
   summary containing useful conclusions, open questions and next steps.
4. Every reachable Git commit that changes AVA product code is reconciled into
   one immutable `improvement` entry. A successful Self swap also indexes its
   exact resulting commit. Failed, uncommitted, test-only and documentation-only
   work is not promoted into improvement memory. Conversation tools cannot
   manufacture an improvement entry.
5. In another chat or OpenAI voice turn, a shared pre-response gate searches by
   meaning, selects only the latest checkpoint in each lineage, and rechecks the
   original conversation or exact reachable Git commit before injecting any
   context. Hume applies the same gate at connection from the active chat's
   latest user context.
6. Automatic retrieval explains its used/no-match/suppressed/unavailable result
   in Mission Control. AVA may rely only on `usable=true` results.
7. Automatic recall opens a bounded recent portion of the authoritative source;
   the compact summary is a discovery locator and never substitutes for source
   verification. Explicit `memory_index_open` remains available for deeper detail.
8. Sir can say **"forget that indexed idea"**. AVA searches when needed, then
   calls `memory_index_forget` with the exact ID and current version.
9. Sir can correct the compact current view, pin an important current thread,
   mark one thread as explicitly replaced, or pause contradictory memories until
   choosing a winner. These actions require the visible governance version and a
   reason. They append history; they never rewrite the original checkpoint.

The Memory screen's **Index** tab lists recent entries and supports query plus an
optional project boundary. Each card shows the compact record, source health,
checkpoint position and current/history/conflict state. Current cards expose
version-guarded **Pin**, **Correct**, **Mark obsolete** and **Mark conflict**
controls. The expandable **Why AVA found this** section preserves the original
record beside any correction and lists who changed governance, when and why.

## Data model and authority

SQLite remains canonical:

- `memory_index_entries`: bounded sanitized title, summary, conclusions, open
  questions, next steps, tags, scope, version, embedding state, thread ID,
  parent entry ID, sequence, checkpoint type and checkpoint reason.
- `memory_index_sources`: typed conversation or improvement source, source
  reference, exact first/last message IDs where applicable, and SHA-256 content
  fingerprint.
- `improvement_records`: one sanitized immutable record per exact Git commit,
  including source kind, actor, capability labels, committed product-file
  boundary and bounded verification evidence. Unique source and commit keys make
  boot reconciliation and Self-swap replay idempotent.
- `memory_index_embeddings`: replaceable float vector plus provider, model,
  dimensions and sanitized-input hash.
- `memory_index_auto_events`: content-free, assistant-message-keyed processing
  receipt used to make automatic capture idempotent. It stores only category,
  status, bounded reason and resulting entry IDâ€”never a transcript or raw prompt.

- `memory_index_thread_state`: versioned projection of the current checkpoint,
  pin, explicit replacement and unresolved conflict state for one lineage.
- `memory_index_governance_events`: append-only correction/pin/supersession/
  conflict records with actor, bounded reason, stable request key, related thread,
  resulting version and timestamp. Correction payloads are sanitized and bounded.

Each entry also records whether capture was `explicit` or `automatic` and a
sanitized provenance reason. The source range remains the authority in either
case.

An initial record starts a thread whose ID is its own memory ID. A material later
Idea refinement appends a new entry with the same thread ID, the prior entry as
parent and a monotonic sequence. Entries are not edited into a new meaning.
Continuation summaries are standalone current-state snapshots, while the
expanding source range and previous checkpoint make their provenance inspectable.
An unrelated Idea developed later in the same chat starts a different thread.

The vector is a discovery aid. It is never canonical memory and never validates
a claim. Each result rereads the referenced messages or improvement record,
recomputes its source fingerprint, and (for an improvement) verifies that the
exact commit remains reachable from current AVA `HEAD`:

- `verified`: the exact range still exists and matches; result is usable.
- `changed`: the range exists but its content fingerprint differs; unusable.
- `unavailable`: the session/range no longer exists; unusable.

No transcript body is duplicated into these tables. Improvement entries synthesize
a bounded source excerpt from the immutable commit record; they never fabricate a
conversation. Deleting a source chat leaves
the compact record visible as unavailable evidence rather than silently turning it
into truth. A matching fingerprint proves source integrity, not that a generated
summary is semantically perfect; AVA should consult the linked source when detail
or stakes make that distinction important.

### Governance and conflicts

The original `memory_index_entries` row and its source fingerprint remain
immutable under governance. A correction is an overlay used for the compact
current view and search embedding. The API always returns both `entry` (effective
view) and `originalEntry`, and labels the correction as user/AVA governance rather
than source evidence. If the source later changes or disappears, the corrected
view remains visible in history but is unusable for automatic recall.

Pinning adds only a small ordering hint after a candidate has already passed the
relevance gate; it cannot make an unrelated memory relevant. Explicit
supersession retains the old thread as inspectable history and makes the selected
source-verified replacement current. Opening a conflict suppresses both threads
from automatic recall. Resolution names one source-verified winner and
supersedes the loser; AVA does not merge contradictory text. V1 conflicts are
pairwise so a partially resolved multi-party graph cannot leave hidden stale
edges.

Every mutation includes `expectedVersion`, a stable replay key, actor and reason.
Stale writes fail with the current version, repeated delivery of the same request
returns the original event, and a replay key cannot be reused across threads or
privacy scopes.

## Retrieval

Search is deliberately hybrid:

- exact phrase and normalized keyword overlap provide deterministic local recall;
- when configured, an embedding of the sanitized compact record and query adds
  semantic similarity for differently worded requests;
- incompatible providers/models/dimensions are never compared;
- provider failure degrades to lexical search with an explicit notice.

The built-in adapter uses OpenAI `text-embedding-3-small` and the documented
floating-point embeddings response. The adapter is behind `MemoryEmbedder`, so a
future local or hosted provider can replace it without migrating canonical entries.

### Automatic retrieval gate

`server/src/memory-index/auto-retrieve.ts` is the one provider-neutral gate used
by typed chat, OpenAI Realtime and Hume. It:

- ignores greetings and low-relevance matches;
- searches latest checkpoints only, so an older idea snapshot cannot override a
  newer one;
- excludes the current source session because normal conversation history already
  carries that context;
- enforces personal/project scope before search and again before source read;
- rejects changed or unavailable sources and never falls back to an older
  checkpoint whose newer source is unhealthy;
- opens a bounded, scrubbed recent source excerpt and labels the summary as
  non-authoritative discovery text;
- marks recalled text as reference-only, so old instructions cannot become new
  actions; and
- fails open for the live conversation but closed for memory injection.

OpenAI Realtime waits at the accepted-transcript boundary, injects one system
reference item, then sends `response.create`. A monotonic epoch invalidates slow
lookups when Niko interrupts, replaces, stops, or disconnects a turn. Hume begins
reasoning before its final transcript reaches AVA, so its deterministic v1 path
preloads recall from the active chat's latest typed/user context on connection.
Current spoken-only Hume semantic lookup is not claimed in this phase.

Each chat/OpenAI turn records a bounded `memory.retrieval.*` event in Mission
Control. The event contains status, mode, source IDs/health and match explanation,
but never the query or retrieved transcript text. Replayed recording is idempotent.

### Inline memory context receipts

The same provider-neutral retrieval gate now projects a versioned, sanitized
`memoryContext` receipt onto the assistant message it informed. Typed chat emits
that projection as a live `memory_context` SSE event before model work and stores
it with the final or error reply. OpenAI and Hume voice attach it to the spoken
assistant turn they persist in the shared conversation. Returning from voice to
the chat therefore shows the same durable receipt after reload; internal
`persist:false` action handoffs still create no duplicate transcript or receipt.

The collapsed chat capsule distinguishes `used`, `no_match`, `suppressed`,
`unavailable` and `error`. Expanded detail can show retrieval mode, whether
semantic search was available, selected memory titles/kinds/projects, source
health, bounded match explanation and truncation. It deliberately cannot contain
the retrieval query, source-session ID, message range, source excerpt, generated
prompt, similarity score, transcript, provider payload or hidden reasoning.
Receipts are schema-validated and re-scrubbed before persistence and again when
message history is read. A `used` claim is rejected unless at least one valid
source-addressable selection survives validation.

Fast chat runs retain the same safe projection in memory for five minutes so an
SSE connection opened after completion receives the context before the final.
The requested task ID scopes that replay. SQLite message metadata remains the
restart-safe history authority; Mission Control remains the deeper operational
record. Hume's receipt reflects its documented connection-time lookup from the
active chat's latest user context, not an unimplemented per-utterance lookup.

## Privacy and boundaries

- `scrubSecrets` runs before summary persistence, before embedding calls and
  automatic-editor calls, and again when records are materialized for
  API/tool/UI output.
- Embedding input contains only the bounded compact record, never the underlying
  transcript range.
- Personal entries are included in normal recall. Project entries require an
  explicit matching project and are excluded from default or other-project search.
- Capture is capped at 80 authoritative messages. Summaries, lists, tags, search
  queries and result counts all have hard bounds.
- Improvement capture is internal-only, personal-scoped and requires a full
  reachable 40-character commit SHA. Boot reconciliation serializes embedding
  work so a historical backfill cannot burst the configured provider.
- Forget is version-checked, immediately deletes the vector and prevents an exact
  forgotten range from being silently resurrected.

## API and tools

Authenticated HTTP routes:

- `GET /api/memory/index?project=&limit=`
- `POST /api/memory/index/capture`
- `POST /api/memory/index/search`
- `GET /api/memory/index/:id`
- `POST /api/memory/index/:id/forget`
- `POST /api/memory/index/:id/correct`
- `POST /api/memory/index/threads/:threadId/pin`
- `POST /api/memory/index/threads/:threadId/supersede`
- `POST /api/memory/index/threads/:threadId/conflict`
- `POST /api/memory/index/threads/:threadId/resolve-conflict`

Agent tools:

- `memory_index_capture`
- `memory_index_search`
- `memory_index_open`
- `memory_index_forget`
- `memory_index_correct`
- `memory_index_pin`
- `memory_index_supersede`
- `memory_index_conflict`

The agent tools require exact entry/thread IDs, visible governance versions and
explicit reasons. Their executions flow through the normal tool/Mission Control
observability seam. Direct UI changes remain visible in each card's append-only
governance history rather than manufacturing a fake agent run.

The tools are present only when the current persisted chat session and index
service are available. They work through the same chat route used by text and
voice, so both modalities address the same SQLite index.

`memory_index_capture` and its HTTP equivalent accept only `research`, `idea`
and `remembered`. `improvement` is deliberately not a user/agent input kind; it
is created only by the Git/Self shipment boundary.

Automatic capture is wired to the post-turn boundary of persisted chat and both
realtime voice providers. It is offered only after a complete assistant response.
Failed, contradicted, cancelled, interrupted, disconnected and `persist:false`
delegated-action turns are not automatic-memory candidates. A completed read-only
research turn may still carry honestly `unverified` executor evidence; that does
not by itself discard the research summary, but its source limitations remain in
the authoritative conversation and the conservative editor may decline it.

`memory_index_capture.start_marker` is resolved chronologically to the first
matching message. This is deliberate: the later capture instruction often
quotes the marker while saying “index the discussion beginning …”; that quote
must not replace the actual discussion as the verified source boundary.

## Idempotency and failure behavior

A source fingerprint includes session, exact range, content hash and privacy
scope. Repeating capture for the same range returns the existing entry. Embedding
write is replaceable and failure leaves the canonical entry searchable by keyword.
Search never upgrades an unavailable source to usable. Version conflicts on forget
return a stale-state error rather than applying an outdated request.
Soft-deleting the linked chat immediately makes its source unavailable even
while AVA retains the underlying rows for the normal deletion-retention window.
Automatic events use the persisted assistant message ID as a stable claim key,
so replaying a response cannot call the memory editor twice or create another
entry. Parent version and latest-thread checks prevent concurrent completions from
forking a sequence. When a broader later checkpoint wins first, an older late
completion is marked skipped and linked to the checkpoint that already covers it.
Superficial turns never call the editor. Editor-declined change candidates produce
only a content-free decision event.

Governance request keys are globally unique but bound to the original memory
thread. Replaying a completed mutation is idempotent; attempting to reuse that key
for a different thread fails closed. Replacement and conflict-winner selection
require matching privacy scope and verified source evidence. Normal search and
automatic recall omit history, superseded threads and unresolved conflicts;
explicit UI history search may show them with non-retrievable state labels.

Current checkpoint routing deliberately follows the most recent verified
automatic Idea thread in a source conversation. A sufficiently developed distinct
Idea starts a new thread, but returning later to an older one of several Idea
threads in the same chat is not yet semantically re-routed to that older thread.
The authoritative checkpoint source range also remains capped at 80 messages.

## Deliberately deferred

- deterministic current-utterance semantic retrieval for Hume (connection-time
  chat-to-voice retrieval is implemented; the existing EVI bridge receives the
  transcript only after Hume has started the response);
- Mem0 or another second canonical memory store;
- background re-embedding and embedding-model migration UI;
- a large memory administration dashboard;
- transcript deletion from an index-forget action.

These should follow only after automatic-and-explicit capture/retrieval quality
is measured on real AVA conversations.

## Verification

Deterministic coverage lives in:

- `server/src/memory-index/store.test.ts`
- `server/src/memory-index/auto-capture.test.ts`
- `server/src/memory-index/auto-retrieve.test.ts`
- `server/src/memory-index/improvement-index.test.ts`
- `server/src/memory-index/governance.test.ts`
- `server/src/memory-index/embedding.test.ts`
- `server/src/routes/memory.test.ts`
- `server/src/routes/chat-memory-retrieval.test.ts`
- `server/src/tools/memory-mcp.test.ts`
- `web/src/memory/MemoryIndexSection.test.tsx`

The repeatable manual boundary smokes are:

```powershell
npm.cmd -w server run smoke:memory-retrieval
npm.cmd -w server run smoke:memory-governance
npm.cmd -w server run smoke:improvement-index
```

It creates a temporary on-disk AVA database, captures personal and project
memories, closes and reopens SQLite, then exercises the shared gate as fresh
chat, OpenAI voice and Hume voice. It also checks semantic paraphrase recall,
irrelevant-memory suppression, project isolation and removal of all smoke data.
No external credentials or consequential actions are used.
The governance smoke appends a correction, pins/unpins, pauses and resolves a
conflict, supersedes an obsolete thread, reopens SQLite, confirms source history
and current state, then deletes its temporary database.
The improvement smoke scans real reachable AVA commits into a disposable SQLite
database, reopens it, proves replay does not duplicate entries, searches for the
genuine Microsoft UFO update, verifies its exact Git source, and cleans up.

The tests cover sanitized compact storage, semantic paraphrase recall, lexical
fallback, source changes/deletion, project isolation, latest-lineage selection,
cross-chat injection, chat/voice transport, interruption-safe ordering,
observability deduplication, automatic
research and multi-turn idea gates, editor decline/failure isolation, voice/chat
provenance, replay idempotency, versioned forget, embedding validation,
authenticated routes and user-visible match reasons.

Manual acceptance:

1. In a disposable chat, ask AVA to research a small topic and let the answer
   finish. Open **Memory > Index** and confirm one `captured automatically`
   research card says `source verified`.
2. Send an ordinary greeting in a fresh disposable chat and confirm no memory is
   created.
3. Develop an idea with AVA over at least two turns each and confirm exactly one
   automatic idea card links the full range. Make a material decision or add a
   next step and confirm checkpoint 2 follows checkpoint 1. Send a superficial
   thanks and confirm no new checkpoint appears. Repeat through voice and confirm
   the provenance says AVA voice.
4. Start another chat and ask for the idea using different wording.
5. Confirm AVA reports what matched and grounds the answer only in a verified
   source. With no embedding provider, confirm it openly reports keyword fallback.
6. Edit/delete the source in a test database or remove the source conversation;
   confirm the card becomes changed/unavailable and is not treated as usable.
7. Correct a disposable card and confirm the original summary remains visible in
   **Why AVA found this**. Refresh/restart and confirm the correction persists.
8. Pin a relevant memory and confirm it moves ahead only for related results.
9. Mark two disposable memories as conflicting; confirm neither is recalled in a
   new chat. Resolve the conflict and confirm only the selected winner returns.
10. Mark an obsolete memory as replaced and confirm normal recall omits it while
    the Memory Index still shows it as preserved history.
11. Ship a committed AVA product change, restart AVA, and open **Memory > Index**.
    Confirm one `improvement` card appears with the exact Git commit in **Why AVA
    found this** and no fake **Open source chat** control.
12. In a fresh chat or voice turn, ask what the shipped update changed. Confirm
    AVA can retrieve its committed evidence. A removed or unreachable commit must
    be shown as unavailable rather than trusted.
