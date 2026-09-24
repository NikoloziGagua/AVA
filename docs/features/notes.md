# Structured Notes

## Purpose

Notes is AVA's visible, editable knowledge workspace. It is where Niko keeps
named documents for university, projects, ideas and ordinary life context.
Notes is authoritative content; semantic Memory may later point to a Note but
does not replace or silently rewrite it.

## Folder and document model

- `General` is the stable built-in top-level folder for uncategorised capture.
- Any number of other top-level folders may be created, such as `University`,
  `AVA`, or a personal area.
- Folders may be nested to six levels, for example
  `University/Agile Development/Lectures`.
- Names are case-insensitively unique among siblings. Folder names cannot
  contain `/` because slash separates path segments.
- Folder create, rename, move and empty-only delete operations are versioned.
  Moves reject cycles and depth overflow.
- Notes are named documents with stable IDs, Markdown content, a document type,
  source evidence, safe links, tags, a bounded change log and an optimistic
  version.
- Each document has an explicit stable page position within its folder. New
  documents append; moving a document to another folder appends there unless a
  position is supplied; editing content never silently reshuffles page order.

`documentType: "study"` uses one canonical Markdown body with the headings Key
concepts, Explanations, Questions and weak areas, Examples, Conclusions and
Sources. AVA searches for a matching lecture/topic document before creating
one, then version-updates it as the discussion develops. There is no parallel
JSON study body that could disagree with what Niko sees.

## Compatibility and migration

The hierarchy migration is additive and non-destructive:

- every existing General note receives folder `notes_general`;
- every existing `note_projects` row becomes a top-level folder with the same
  stable ID;
- every existing note keeps its ID, title, body, source, version, change log
  and promotion lineage;
- existing documents receive deterministic page positions from their original
  creation order, with stable ID as the tie-breaker;
- historical project, section, kind and Kanban-stage fields remain during v1;
- legacy duplicate titles do not block, rename or merge migration.

The current optional Board metadata remains Ideas, Doing, Review, Done and
Archived. General, Ideas, Today, Project Brief and exact-note links continue to
read the compatibility fields while the Finder-style Notes interface is built
in the next increment. Similar-looking folders are never merged automatically.
The current Agile course folders are presented for an explicit, versioned move
into `University/Agile Development` so the data change is reviewable.

## Working with AVA

AVA exposes five Notes tools in chat and voice:

- `notes_capture` creates a document. `folder_path` may explicitly create
  missing path segments when Niko asks to save into that path.
- `notes_search` searches title, content and tags, optionally within one folder
  or subtree, and returns stable IDs, breadcrumbs and current versions.
- `notes_update` version-updates content or moves a document to an existing
  folder, and can reorder a page through `document_position`.
- `notes_folders` lists or explicitly creates, renames, moves and deletes-empty
  folders. Rename/move/delete require the current folder version.
- `notes_promote` turns a document into a task draft or an explicit
  approval-gated self-improvement request while preserving source lineage.

A folder listing is read-only. Local note/folder changes are low-risk local
persistence. Self-improvement retains its separate approval boundary.

## Persistence and concurrency

`note_folders`, `note_projects` (compatibility) and `notes` live in AVA's SQLite
database. General has a fixed ID. Migrated project IDs are reused as folder IDs.
New top-level folders maintain a project compatibility projection so the old UI
does not hide their documents; nested documents appear under their top-level
folder until the new UI takes over.

Every folder and document has a monotonically increasing version. Stale writes
return the latest record rather than overwriting it. A document move updates
its legacy top-level project projection without changing the document ID, and
appends it to the destination unless an explicit page position is supplied.

Notes are scrubbed at persistence. Only HTTP(S) links without credential-like
material are retained. All HTTP routes require normal AVA authentication.

## API

- `GET /api/notes/tree` returns ordered folders (version, breadcrumb, direct
  document count), bounded document summaries, a snapshot version/timestamp and
  migration compatibility evidence.
- `GET /api/notes/:id` returns one authoritative document and breadcrumb.
- `GET /api/notes` remains backward compatible and adds `folderId`,
  `subtree=true` and `documentType` filters.
- `POST /api/notes/folders` creates a folder.
- `PATCH /api/notes/folders/:id` performs a versioned rename/move/edit.
- `DELETE /api/notes/folders/:id?expectedVersion=...` deletes only an empty,
  non-built-in folder.
- Existing project routes remain available during compatibility.
- Existing note create/update/delete/promote routes remain, with `folderId` and
  `documentType` and `documentPosition` added to create/update.

Typed hierarchy failures distinguish missing/stale records, sibling-name
conflicts, non-empty folders, invalid moves and excessive depth.

## Verification and current boundary

State, route and tool tests cover legacy migration (including duplicate titles
and deterministic page order),
General/root identity, sibling uniqueness, nested paths, subtree search, study
documents, cycles, depth, optimistic concurrency, compatibility projection,
empty-only deletion, privacy scrubbing and tool round trips. A separate
live-database-copy verifier hashes all authoritative note fields before and
after migration and removes its temporary copy.

This increment is the server/tool foundation. The Finder-style folder tree,
book/page reader with previous/next navigation and editor are the next
separately reviewed UI increment. Until
that lands, nested hierarchy operations are available conversationally and via
the authenticated API, while the existing Notes Board remains the visible
compatibility view.
