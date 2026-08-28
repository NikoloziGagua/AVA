# Semantic memory index

## Status

Implemented as an explicit-capture beta. It is a retrieval layer for substantial
research, developed ideas and decisions; it does not replace AVA's compact
preference/observation memory or copy complete transcripts.

## User contract

1. Sir says **"index this discussion"** or otherwise explicitly asks AVA to
   preserve a developed research/idea segment.
2. AVA calls `memory_index_capture` with a bounded source range and a compact
   summary containing useful conclusions, open questions and next steps.
3. In another chat or voice turn, AVA calls `memory_index_search` for prior
   research, ideas or decisions before claiming it cannot recall them.
4. Retrieval explains the match and rechecks the original message range. AVA may
   rely only on `usable=true` results.
5. AVA calls `memory_index_open` when the question needs source detail beyond the
   compact locator summary. The authoritative range is loaded only then.
6. Sir can say **"forget that indexed idea"**. AVA searches when needed, then
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
  again when records are materialized for API/tool/UI output.
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

## Idempotency and failure behavior

A source fingerprint includes session, exact range, content hash and privacy
scope. Repeating capture for the same range returns the existing entry. Embedding
write is replaceable and failure leaves the canonical entry searchable by keyword.
Search never upgrades an unavailable source to usable. Version conflicts on forget
return a stale-state error rather than applying an outdated request.

## Deliberately deferred

- automatic indexing of every research answer;
- automatic topic-change/decision checkpoints;
- Mem0 or another second canonical memory store;
- background re-embedding and embedding-model migration UI;
- a large memory administration dashboard;
- transcript deletion from an index-forget action.

These should follow only after explicit capture/retrieval quality is measured on
real AVA conversations.

## Verification

Deterministic coverage lives in:

- `server/src/memory-index/store.test.ts`
- `server/src/memory-index/embedding.test.ts`
- `server/src/routes/memory.test.ts`
- `server/src/tools/memory-mcp.test.ts`
- `web/src/memory/MemoryIndexSection.test.tsx`

The tests cover sanitized compact storage, semantic paraphrase recall, lexical
fallback, source changes/deletion, project isolation, deduplication, versioned
forget, embedding validation, authenticated routes and user-visible match reasons.

Manual acceptance:

1. In a chat, develop a small idea and say **"Index this discussion as an idea
   called Test Recall."**
2. Open **Memory > Index** and confirm the card says `source verified`.
3. Start another chat and ask for the idea using different wording.
4. Confirm AVA reports what matched and grounds the answer only in a verified
   source. With no embedding provider, confirm it openly reports keyword fallback.
5. Edit/delete the source in a test database or remove the source conversation;
   confirm the card becomes changed/unavailable and is not treated as usable.
