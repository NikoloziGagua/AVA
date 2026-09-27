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
- Each document has an explicit stable file position within its folder. New
  documents append; moving a document to another folder appends there unless a
  position is supplied; editing content never silently reshuffles file order.

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
- existing documents receive deterministic file positions from their original
  creation order, with stable ID as the tie-breaker;
- historical project, section, kind and Kanban-stage fields remain during v1;
- legacy duplicate titles do not block, rename or merge migration.

The current optional Board metadata remains Ideas, Doing, Review, Done and
Archived. General, Ideas, Today, Project Brief and exact-note links continue to
read the compatibility fields alongside the folder/file workspace.
Similar-looking folders are never merged automatically.
The current Agile course folders are presented for an explicit, versioned move
into `University/Agile Development` so the data change is reviewable.

## Working with AVA

AVA exposes five Notes tools in chat and voice:

- `notes_capture` creates a document. `folder_path` may explicitly create
  missing path segments when Niko asks to save into that path.
- `notes_search` searches title, content and tags, optionally within one folder
  or subtree, and returns stable IDs, breadcrumbs and current versions.
- `notes_update` version-updates content or moves a document to an existing
  folder, and can reorder a file through `document_position`.
- `notes_folders` lists or explicitly creates, renames, moves and deletes-empty
  folders. Rename/move/delete require the current folder version.
- `notes_promote` turns a document into a task draft or an explicit
  approval-gated self-improvement request while preserving source lineage.

A folder listing is read-only. Local note/folder changes are low-risk local
persistence. Self-improvement retains its separate approval boundary.

## Persistence and concurrency

`note_folders`, `note_projects` (compatibility) and `notes` live in AVA's SQLite
database. General has a fixed ID. Migrated project IDs are reused as folder IDs.
New top-level folders maintain a project compatibility projection so legacy
Board and Project Brief reads do not hide their documents; nested documents
appear under their top-level folder in those compatibility views.

Every folder and document has a monotonically increasing version. Stale writes
return the latest record rather than overwriting it. A document move updates
its legacy top-level project projection without changing the document ID, and
appends it to the destination unless an explicit file position is supplied.

## Files and reading pages

The visible Notes hierarchy follows ordinary file semantics:

- folders may contain child folders and multiple named files;
- each SQLite `notes` row is one authoritative file/document;
- `documentPosition` orders files in a folder and never identifies a page;
- the desktop workspace shows folder tree -> file list -> document reader;
- the phone workspace stacks folder selection -> file list -> reader.

When one selected file is longer than the reader, the web client derives
book-like pages from its Markdown. It measures the reader width, prefers
Markdown block and heading boundaries, and splits only ordinary long prose at
safe word boundaries. Fenced code, tables and complex Markdown remain intact
and may scroll inside their page. The same file can therefore have a different
visual page count after a resize or font/layout change.

These page boundaries are disposable UI state. They are not stored in SQLite,
are not returned by Notes APIs, and are never used by AVA as source identity.
The canonical Markdown body remains unchanged. The browser may remember a
best-effort block anchor for reading continuity; a stale anchor falls back
safely. A **Show as one page** mode renders the complete canonical document for
screen readers, selection, printing and any content that does not paginate
cleanly. Editing always opens and version-updates the complete file.

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
and deterministic file order),
General/root identity, sibling uniqueness, nested paths, subtree search, study
documents, cycles, depth, optimistic concurrency, compatibility projection,
empty-only deletion, privacy scrubbing and tool round trips. A separate
live-database-copy verifier hashes all authoritative note fields before and
after migration and removes its temporary copy.

The folder hierarchy, explicit file list, derived in-document reader pages and
whole-file editor are available in the Notes interface. The optional Board
continues to use the compatibility metadata. Visual page boundaries remain a
presentation concern; no page CRUD or parallel page store exists.

## Atelier library presentation (2026-09-27)

Notes now uses the shared Ink-by-default design tokens and Silver Silk ground.
An explicit Paper preference still works. Desktop presents open folder and file
rails beside a readable document plane. Up to 850px, Library → Files → Reader
is an explicit local drill-down with Back controls. An exact-note handoff opens
the reader directly. The same canonical document, derived pages, full-document
mode, safe Markdown, versioned edits/moves, Study template, search, capture and
optional Board/Project Brief remain.

Notes-local primitives own presentation only. No preview fixture, page record,
subtitle field, generated illustration or fake connected thought is promoted.
Files retain identity/history. Responsive changes never change source data.
Reload still starts at the default folder unless an exact handoff is supplied;
per-file reading anchors remain local.

The editor uses simple underline fields, not nested boxes. Save errors appear
inside the dialog. Request-generation guards prevent older refreshes replacing
newer snapshots. Synchronous mutation locking prevents rapid duplicate actions.
Stale versions require reopening the authoritative file; no automatic retry or
invented success. The existing polling cadence and backend APIs are unchanged.

The five migrated Notes files are strict in the design guard: no sub-12px text,
raw colours or per-component blur. Optional Project Brief remains a legacy
component, not claimed fully redesigned. Native buttons, visible focus, safe
Markdown and the existing reduced-motion policy remain.

`node web/src/notes/verify-atelier-notes.mjs <built-web> <built-server-dist>`
exercises a nested folder and two documents through actual Notes routes in a
disposable SQLite database: pagination/full text, one explicit edit, DB reopen,
phone Back, reload, Ink/Paper and 1440/390/320 widths. Other APIs are fixtures;
no live data/model calls. Evidence is ignored under `data/builds`.
