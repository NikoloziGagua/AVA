# Semantic memory index

## Status

Implemented as a conservative automatic-and-explicit beta. It is a retrieval
layer for substantial research, developed ideas and decisions; it does not
replace AVA's compact preference/observation memory or copy complete transcripts.

## User contract

1. A successfully completed research turn or an idea meaningfully developed by
   both Sir and AVA is offered to the automatic memory gate. Greetings, routine
   execution, incomplete work and ordinary conversation are rejected locally.
2. A conservative side-model editor may produce a bounded compact record. It can
   decline the candidate; its failure never changes or delays chat/voice delivery.
3. Sir can still say **"remember this"** or **"index this discussion"** for
   anything worth keeping outside the two automatic categories. AVA calls
   `memory_index_capture` with a bounded source range and a compact
   summary containing useful conclusions, open questions and next steps.
4. In another chat or voice turn, AVA calls `memory_index_search` for prior
   research, ideas or decisions before claiming it cannot recall them.
5. Retrieval explains the match and rechecks the original message range. AVA may
   rely only on `usable=true` results.
6. AVA calls `memory_index_open` when the question needs source detail beyond the
   compact locator summary. The authoritative range is loaded only then.
7. Sir can say **"forget that indexed idea"**. AVA searches when needed, then
   calls `memory_index_forget` with the exact ID and current version.

The Memory screen's **Index** tab lists recent entries and supports query plus an
optional project boundary. Each card shows the compact record, source health and
an expandable **Why AVA found this** explanation.

## Data model and authority

SQLite remains canonical:

- `memory_index_entries`: bounded sanitized title, summary, conclusions, open
  questions, next steps, tags, scope, version and embedding state.
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
Failed, partial, uncertain, cancelled, interrupted, disconnected and
`persist:false` delegated-action turns are not automatic-memory candidates.

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
entry. A first developed-idea checkpoint suppresses overlapping automatic copies
in this phase; linked revisions are the next phase.

## Deliberately deferred

- automatic topic-change/decision checkpoints;
- linked revisions and supersession for an idea that continues evolving;
- automatic retrieval injection into ordinary turns (search remains an explicit
  AVA tool decision in this phase);
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
- `server/src/memory-index/embedding.test.ts`
- `server/src/routes/memory.test.ts`
- `server/src/tools/memory-mcp.test.ts`
- `web/src/memory/MemoryIndexSection.test.tsx`

The tests cover sanitized compact storage, semantic paraphrase recall, lexical
fallback, source changes/deletion, project isolation, deduplication, automatic
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
   automatic idea card links the full range. Repeat through voice and confirm the
   provenance says AVA voice.
4. Start another chat and ask for the idea using different wording.
5. Confirm AVA reports what matched and grounds the answer only in a verified
   source. With no embedding provider, confirm it openly reports keyword fallback.
6. Edit/delete the source in a test database or remove the source conversation;
   confirm the card becomes changed/unavailable and is not treated as usable.
