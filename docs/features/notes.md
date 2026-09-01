# Structured Notes

## Purpose

Notes is AVA's visible, shared place for capturing and organising ideas,
requirements, priorities, decisions and stable project context. It is separate
from implicit durable memory: Notes is deliberately user-visible, editable and
arranged for project work.

## Workspace model

- **General** is always available for uncategorised capture.
- **Projects** are explicit records, so an empty project space remains visible.
- Every project presents four lightweight template sections:
  - **Quick capture** for ideas and requirements.
  - **Pinned priorities** for the few items that deserve persistent focus.
  - **Decisions** for choices and the reasons behind them.
  - **Documentation** for stable context that should outlive a single task.
- The Kanban board uses **Ideas**, **Doing**, **Review**, and **Done**. Archived
  items stay in storage but do not clutter the normal board.

Each note may contain a title, rich plain-text content, kind, section, stage,
tags, safe HTTP(S) links, pinned state, source metadata and a bounded change log.

## Connected project brief

Selecting a project opens a collapsible **Project brief** above its existing
template and Kanban board. The Brief is a read-only composition over data AVA
already owns:

- priorities, open work, decisions and stable context come from the current
  project Notes;
- indexed knowledge comes from the existing authenticated memory-index route,
  explicitly scoped to the project's name;
- a second client-side scope check excludes personal and other-project entries;
- every memory shows verified, changed, unavailable or governance-excluded
  status, with its evidence reason in collapsed details;
- conversation-backed memory can return directly to its source chat.

The Brief does not generate an AI summary, copy records into a new project
database, or make memory-governance changes. A failure in memory retrieval is
shown locally and never hides or disables project Notes. Async responses are
versioned in the client so a slow result from a previously selected project
cannot appear in the current workspace.

## Working with AVA

AVA exposes four Notes tools in text and voice task runs:

- `notes_capture` creates a note and creates a named project space when needed.
- `notes_search` finds notes and returns their current versions.
- `notes_update` edits, pins, categorises or moves a note using optimistic
  version checks.
- `notes_promote` turns a note into a prefilled task or explicitly requests a
  self-improvement while preserving the source note and lineage.

Natural requests such as "put this idea in Notes", "save that under the AVA
project", or "move this note to Review" are routed to the Notes tools. A capture
defaults to General and Quick capture when no project or section is specified.

## Promotion and safety

Task promotion creates a prompt for a separate AVA task. It does not claim that
the work has begun or completed. Self-improvement promotion is explicit and uses
AVA's existing approval-gated queue; Notes cannot bypass that boundary.

Only HTTP and HTTPS links are accepted. Raw secrets must not be stored in Notes.
Notes can contain sensitive personal and project information, so the API requires
normal AVA device authentication.

## Persistence and concurrency

`note_projects` and `notes` live in AVA's SQLite state database. Existing legacy
collections are migrated into explicit project spaces. Legacy stages are mapped
from Inbox to Ideas and Active to Doing.

Every note has a monotonically increasing version. Updates and deletes require
the caller's current version. A stale write returns the latest note rather than
silently overwriting another edit. The change log is bounded to the most recent
100 entries.

## API

- `GET /api/notes` returns projects, notes and template metadata.
- `POST /api/notes/projects` creates or ensures a project space.
- `PATCH /api/notes/projects/:id` updates project metadata.
- `POST /api/notes` captures a note.
- `PATCH /api/notes/:id` performs a version-checked edit.
- `DELETE /api/notes/:id?version=...` performs a version-checked delete.
- `POST /api/notes/:id/promote` promotes to `task` or `self_improvement`.

## Verification

The feature is covered at four boundaries:

- State tests cover migration, project templates, rich details, version
  conflicts, safe links and promotion lineage.
- Route tests cover authentication, CRUD, stale writes and promotion.
- Tool tests cover natural AVA capture/search/update/promotion behaviour.
- UI tests cover project templates, quick capture and task promotion.

Explorer declares Notes as a real beta capability and links the implementation,
workflow, evidence and limitations. The runtime truth check verifies that all
four Notes tools and the `/api/notes` route are represented.
