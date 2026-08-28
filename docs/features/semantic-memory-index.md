# Semantic memory index

## Status

Implemented as a conservative automatic-and-explicit beta with immutable linked
Idea checkpoints and source-verified automatic recall across chat and voice. It is a retrieval
layer for substantial research, developed ideas and decisions; it does not
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
4. In another chat or OpenAI voice turn, a shared pre-response gate searches by
   meaning, selects only the latest checkpoint in each lineage, and rechecks the
   original source before injecting any context. Hume applies the same gate at
   connection from the active chat's latest user context.
5. Automatic retrieval explains its used/no-match/suppressed/unavailable result
   in Mission Control. AVA may rely only on `usable=true` results.
6. Automatic recall opens a bounded recent portion of the authoritative source;
   the compact summary is a discovery locator and never substitutes for source
   verification. Explicit `memory_index_open` remains available for deeper detail.
7. Sir can say **"forget that indexed idea"**. AVA searches when needed, then
   calls `memory_index_forget` with the exact ID and current version.

The Memory screen's **Index** tab lists recent entries and supports query plus an
optional project boundary. Each card shows the compact record, source health and
checkpoint position, plus an expandable **Why AVA found this** explanation with
thread, parent, change type and plain-language checkpoint reason.

## Data model and authority

SQLite remains canonical:

- `memory_index_entries`: bounded sanitized title, summary, conclusions, open
  questions, next steps, tags, scope, version, embedding state, thread ID,
  parent entry ID, sequence, checkpoint type and checkpoint reason.
- `memory_index_sources`: source session, exact first/last message IDs, message
  count and SHA-256 content fingerprint.
- `memory_index_embeddings`: replaceable float vector plus provider, model,
  dimensions and sanitized-input hash.
- `memory_index_auto_events`: content-free, assistant-message-keyed processing
  receipt used to make automatic capture idempotent. It stores only category,
  status, bounded reason and resulting entry IDâ€”never a transcript or raw prompt.

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
a claim. Each result rereads the referenced messages and recomputes the source
fingerprint:

- `verified`: the exact range still exists and matches; result is usable.
- `changed`: the range exists but its content fingerprint differs; unusable.
- `unavailable`: the session/range no longer exists; unusable.

No transcript body is duplicated into these tables. Deleting a source chat leaves
the compact record visible as unavailable evidence rather than silently turning it
into truth. A matching fingerprint proves source integrity, not that a generated
summary is semantically perfect; AVA should consult the linked source when detail
or stakes make that distinction important.

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
- Forget is version-checked, immediately deletes the vector and prevents an exact
  forgotten range from being silently resurrected.

## API and tools

Authenticated HTTP routes:

- `GET /api/memory/index?project=&limit=`
- `POST /api/memory/index/capture`
- `POST /api/memory/index/search`
- `GET /api/memory/index/:id`
- `POST /api/memory/index/:id/forget`

Agent tools:

- `memory_index_capture`
- `memory_index_search`
- `memory_index_open`
- `memory_index_forget`

The tools are present only when the current persisted chat session and index
service are available. They work through the same chat route used by text and
voice, so both modalities address the same SQLite index.

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

Current checkpoint routing deliberately follows the most recent verified
automatic Idea thread in a source conversation. A sufficiently developed distinct
Idea starts a new thread, but returning later to an older one of several Idea
threads in the same chat is not yet semantically re-routed to that older thread.
The authoritative checkpoint source range also remains capped at 80 messages.

## Deliberately deferred

- deterministic current-utterance semantic retrieval for Hume (connection-time
  chat-to-voice retrieval is implemented; the existing EVI bridge receives the
  transcript only after Hume has started the response);
- user-governed correction, pinning and supersession controls for checkpoints;
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
- `server/src/memory-index/embedding.test.ts`
- `server/src/routes/memory.test.ts`
- `server/src/routes/chat-memory-retrieval.test.ts`
- `server/src/tools/memory-mcp.test.ts`
- `web/src/memory/MemoryIndexSection.test.tsx`

The repeatable manual boundary smoke is:

```powershell
npm.cmd -w server run smoke:memory-retrieval
```

It creates a temporary on-disk AVA database, captures personal and project
memories, closes and reopens SQLite, then exercises the shared gate as fresh
chat, OpenAI voice and Hume voice. It also checks semantic paraphrase recall,
irrelevant-memory suppression, project isolation and removal of all smoke data.
No external credentials or consequential actions are used.

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
