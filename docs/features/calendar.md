# Calendar

AVA Calendar is the schedule authority for events, lectures and time blocks. It is deliberately separate from notification delivery: Calendar says **when something happens**; the existing Watches/Reminder occurrence pipeline says **whether a notification was attempted or accepted**.

## C1: event authority and conversational access

The first increment provides:

- one-off and bounded weekly definitions in SQLite;
- `Europe/Dublin` as the default, while persisting an explicit IANA time zone on every event;
- strict wall-clock validation at daylight-saving changes (gaps fail; repeated times require `earlier` or `later`);
- stable occurrence keys (`<eventId>:<original-local-date>`) even when one occurrence moves;
- version-guarded series updates, per-occurrence exceptions and this-and-following splits;
- attendance intent (`undecided`, `attend`, `skip`) separately from an explicit outcome (`unknown`, `attended`, `skipped`, `missed`);
- authenticated bounded event routes and the shared chat/OpenAI-voice/Hume tools `calendar_query`, `calendar_add`, `calendar_update`, `calendar_set_attendance` and `calendar_remind`.

The route surface is:

- `GET /api/calendar/events?from=<epoch-ms>&to=<epoch-ms>[&timeZone=<IANA>]`
- `POST /api/calendar/events`
- `PATCH /api/calendar/events/:id`
- `DELETE /api/calendar/events/:id?expectedVersion=N[&includeHistory=true]` (hides the whole definition; retains its stored history)
- `POST /api/calendar/events/:id/restore`
- `POST /api/calendar/events/:id/end`
- `POST /api/calendar/events/:id/extend`
- `PUT /api/calendar/events/:id/occurrences/:originalDate`
- `POST /api/calendar/events/:id/split`

Queries are limited to 90 days and 500 projected occurrences. Weekly series must end within one year. Returned snapshots carry `fetchedAt`, the resolved window, event/exception versions and the exact stable occurrence keys needed for later writes.

## History and concurrency

Once a series has begun, a normal series patch cannot rewrite its schedule or descriptive history. Use an occurrence exception for one occurrence or split the series for this-and-following. Past occurrences may receive an explicit attendance outcome, but cannot be moved or cancelled after the fact.

Every write uses the current event version; occurrence writes also use the current exception version. A stale writer receives `stale_version` rather than overwriting another edit. Split keeps prior occurrences on the old definition and transfers future exception rows to the new definition.

## Calendar v3 backend: unchanged edits and reversible series actions

This backend increment repairs full-field echoes from strict tool calls. Existence,
archive and version checks run before comparing values, in an immediate SQLite
transaction. The complete candidate is validated and normalized first. Equal
fields are removed before history checks: an unchanged title/date/time echoed
alongside a changed reminder preference no longer blocks that preference.

- Series PATCH returns `{event, changed}`. A no-op has `changed:false`, retaining
  the event version and timestamps exactly.
- Occurrence PUT returns `{exception, changed}`. `exception` can be `null`: an
  all-default echo must not create an exception row. With no row, the expected
  exception version must be `null` or `0`; a different version is stale even
  when the payload is unchanged. Echoing the effective attendance intent does
  not pin an inherited value. Explicit `null` still clears a stored override.
- Split still requires a real change, returns `{previous,next,changed:true}`,
  and never rewrites original dates or prior outcomes. A no-change split is
  `bad_request`. Anchor/recurrence-kind changes are outside following scope.
- HTTP mutation bodies and archive query parameters reject unknown fields,
  rather than dropping them and reporting a successful write.

History means a non-cancelled occurrence whose **original or effective moved
start** is at or before now, or any occurrence with a recorded attendance
outcome. Time passing alone never invents an outcome. Historical series edits
fail with `series_started`; occurrence schedule rewrites fail with
`occurrence_started`. Attendance outcomes remain explicitly recordable.

| Operation | Authenticated request | Response and effect |
| --- | --- | --- |
| End a weekly series | `POST /events/:id/end {expectedVersion,fromOriginalDate}` | `{event,endedFromOriginalDate,previousRecurrenceUntilDate}`. Caps the series to the preceding weekly date. The boundary must be a future original occurrence after the anchor. |
| Extend / undo end | `POST /events/:id/extend {expectedVersion,recurrenceUntilDate}` | `{event,previousRecurrenceUntilDate}`. Adds original `anchor + 7k` dates, even when the old end date was a different weekday. |
| Remove from the schedule | `DELETE /events/:id?expectedVersion=N&includeHistory=true` | `{event}`. Soft-archives the complete definition; history requires explicit inclusion. Unstarted definitions need no flag. |
| Restore / undo removal | `POST /events/:id/restore {expectedVersion}` | `{event}`. Clears the archive timestamp and advances the version. |

All paths above are relative to `/api/calendar`. Undo must use the version
returned by the original write, not a cached earlier version. Ending keeps
future exceptions stored but hidden; extending makes them visible again with
the same original keys and exception versions. End rejects `history_conflict`
if any affected occurrence was moved into the past or has an outcome. Extend
requires every re-added original **and** effective start to be future, with no
recorded outcome, even for a retained cancelled exception. It refuses extensions
that add no occurrence (`no_occurrence_added`) or exceed the existing 366-day
bound. DST validation remains strict across every re-added date.

Archive hides all occurrences from range queries and exact occurrence lookup,
not just future dates. Definitions, exceptions and outcomes are not deleted.
Archiving an already archived definition is unchanged only with its **current**
version. Restore rejects a non-archived definition (`not_archived`); ordinary
mutations reject archived records (`archived`). End/extend require a weekly
definition (`not_weekly`). No migration or second schedule store is introduced.

Errors remain bounded `{error,message}` responses: missing event or occurrence
is HTTP 404, stale version is 409, other calendar errors are 400. Malformed
HTTP schemas return `{error:"bad_request"}` without reflecting input. Writes
roll back together on failure. Nothing in these operations schedules a push,
changes a standing policy rule, or modifies standalone reminders.

**Integration boundary:** this commit supplies services/routes only. The agent
tool expansion, human-facing recovery copy and Calendar action/Undo controls
are a separately reviewed follow-up. Until those land, the old tool layer does
not expose end/remove, and the existing Calendar UI does not expose these new
actions. Restore/extend are intended to remain HTTP/UI-only in v3. Source
completion is not evidence that the running server has been promoted.

Tests cover started-series full echoes, nullable no-row echoes, stale writers,
history/moved/outcome guards, end/extend/restore/replay, weekday/DST boundaries,
strict authenticated requests, rollback, restart and competing SQLite readers
writing against the same version. Exact command results belong in BOARD.md.

## Reminder boundary

`reminderMinutesBefore` is only an event preference in C1. `calendar_remind` says that the preference was saved and explicitly does **not** claim that delivery is active. C3 will project those offsets into the existing reminder/watch authority, which owns retries, receipts and truthful `Accepted by notification service (receipt unconfirmed)` language.

Standalone reminders are not migrated or rewritten. Existing PC-zone reminder semantics remain visible and separate.

## Privacy and limitations

Calendar stores bounded schedule fields, stable source/session lineage and optional Notes-folder links. Typed errors never echo private titles, locations or malformed zone input.

Not implemented: push materialisation, Google/Outlook/CalDAV sync, all-day events, recurrence other than weekly, multiple reminder offsets, attendees/invitations or timetable scraping. Niko's university timetable is imported only after he supplies or confirms the real titles, local times, locations and term end; AVA never fabricates them.

## C2: the actual Calendar workspace

Calendar in the main navigation now opens `web/src/calendar/CalendarScreen.tsx`, not the old reminder Schedule. It reads the existing authenticated C1 routes: no second event store, migration, or new endpoint. Month is a Monday-first six-week grid; Week and Day show overlap-aware time columns plus a chronological text list. A selected-day agenda exposes descriptions, event/display time zones, cancellation, attendance plan and separately recorded outcome. The display zone is Europe/Dublin; the editor accepts explicit IANA event zones. Month arrows and keyboard arrows navigate wall dates without changing events.

New event opens an unboxed, accessible sheet with title, date, start and duration. **More details** reveals time zone, type, bounded weekly repeat, attendance plan, location, description, Notes-folder link and repeated-clock choice. Invalid hidden fields reopen that disclosure before correction. Keyboard focus underlines fields rather than nesting another box; forced colours retain a system-colour underline. A future, not-yet-started series can be edited. Started series remain protected: the UI offers occurrence attendance and future cancellation, not a misleading whole-series edit. Moving/splitting/archiving remain existing API/tool capabilities, not new drag or delete controls in this UI.

Saves are explicit and deduplicated while pending. Edits carry expected event/exception versions. A stale or uncertain result locks Save; closing the editor automatically rereads the authoritative calendar before edits unlock, without replaying a write. Outcome-only or cancellation changes do not pin an inherited attendance plan; **Same as series** explicitly clears an override through the existing nullable API field. Late completions after unmount are ignored. Reads reject partial, malformed, duplicate and incorrectly correlated snapshots; older range responses cannot replace newer views. Same-range refresh keeps the last snapshot visible with “Refreshing” and disabled edits; failed/range-changing reads clear it. Save confirmation does not replace the timestamp and clears on the next refresh. Week/Day begin at 07:00 but remain fully scrollable. Focus/visibility refreshes only when no editor is open. There is no calendar SSE or continuous polling claim.

Standalone reminders remain reachable through **Reminders** in Calendar and retain their own scheduling/delivery semantics. The event editor explicitly says linked notifications are unavailable; it does not turn a saved event into a claimed reminder. Existing offsets and folder links are preserved when not edited.

The default dark Nocturne presentation uses design tokens, native controls, visible focus and the existing reduced-motion preference. Narrow screens stack the agenda; Week's horizontally scrollable grid has the text alternative. A short event's minimum visual height is for legibility, not a duration claim. DST repeated hours keep exact timestamp labels/order, but the visual wall-clock grid is not an elapsed-time scale.

Verification: focused `calendar/*.test.*` covers wall dates, overlap/DST, authenticated contract validation, stale writes, uncertain outcomes, keyboard focus, loading/error, old response suppression and explicit saves. `node web/src/calendar/verify-calendar.mjs <built-web> <built-server-dist>` runs the built App against actual Calendar routes and a disposable SQLite file, including create/edit/attendance, reopen persistence and stale writes at 1440/390/320 widths. Other API responses are labelled fixtures. It never uses the live AVA database or sends notifications. Exact gate results and source/runtime promotion state are in BOARD.md.
