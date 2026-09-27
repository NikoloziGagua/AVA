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
- `DELETE /api/calendar/events/:id?expectedVersion=N` (archives future occurrences; does not delete history)
- `PUT /api/calendar/events/:id/occurrences/:originalDate`
- `POST /api/calendar/events/:id/split`

Queries are limited to 90 days and 500 projected occurrences. Weekly series must end within one year. Returned snapshots carry `fetchedAt`, the resolved window, event/exception versions and the exact stable occurrence keys needed for later writes.

## History and concurrency

Once a series has begun, a normal series patch cannot rewrite its schedule or descriptive history. Use an occurrence exception for one occurrence or split the series for this-and-following. Past occurrences may receive an explicit attendance outcome, but cannot be moved or cancelled after the fact.

Every write uses the current event version; occurrence writes also use the current exception version. A stale writer receives `stale_version` rather than overwriting another edit. Split keeps prior occurrences on the old definition and transfers future exception rows to the new definition.

## Reminder boundary

`reminderMinutesBefore` is only an event preference in C1. `calendar_remind` says that the preference was saved and explicitly does **not** claim that delivery is active. C3 will project those offsets into the existing reminder/watch authority, which owns retries, receipts and truthful `Accepted by notification service (receipt unconfirmed)` language.

Standalone reminders are not migrated or rewritten. Existing PC-zone reminder semantics remain visible and separate.

## Privacy and limitations

Calendar stores bounded schedule fields, stable source/session lineage and optional Notes-folder links. Typed errors never echo private titles, locations or malformed zone input.

Not implemented: push materialisation, Google/Outlook/CalDAV sync, all-day events, recurrence other than weekly, multiple reminder offsets, attendees/invitations or timetable scraping. Niko's university timetable is imported only after he supplies or confirms the real titles, local times, locations and term end; AVA never fabricates them.

## C2: the actual Calendar workspace

Calendar in the main navigation now opens `web/src/calendar/CalendarScreen.tsx`, not the old reminder Schedule. It reads the existing authenticated C1 routes: no second event store, migration, or new endpoint. Month is a Monday-first six-week grid; Week and Day show overlap-aware time columns plus a chronological text list. A selected-day agenda exposes descriptions, event/display time zones, cancellation, attendance plan and separately recorded outcome. The display zone is Europe/Dublin; the editor accepts explicit IANA event zones. Month arrows and keyboard arrows navigate wall dates without changing events.

New event opens an unboxed, accessible sheet with title, date, time, duration, zone, type, bounded weekly repeat, attendance plan and location. Description, Notes-folder link and repeated-clock choice are disclosed separately. A future, not-yet-started series can be edited. Started series remain protected: the UI offers occurrence attendance and future cancellation, not a misleading whole-series edit. Moving/splitting/archiving remain existing API/tool capabilities, not new drag or delete controls in this UI.

Saves are explicit and deduplicated while pending. Edits carry expected event/exception versions. A stale or uncertain result locks Save until the editor is closed and the calendar refreshed; nothing is automatically replayed. Late completions after unmount are ignored. Reads reject partial, malformed, duplicate and incorrectly correlated snapshots; older range responses cannot replace newer views. Focus/visibility refreshes only when no editor is open. There is no calendar SSE or continuous polling claim.

Standalone reminders remain reachable through **Reminders** in Calendar and retain their own scheduling/delivery semantics. The event editor explicitly says linked notifications are unavailable; it does not turn a saved event into a claimed reminder. Existing offsets and folder links are preserved when not edited.

The default dark Nocturne presentation uses design tokens, native controls, visible focus and the existing reduced-motion preference. Narrow screens stack the agenda; Week's horizontally scrollable grid has the text alternative. A short event's minimum visual height is for legibility, not a duration claim. DST repeated hours keep exact timestamp labels/order, but the visual wall-clock grid is not an elapsed-time scale.

Verification: focused `calendar/*.test.*` covers wall dates, overlap/DST, authenticated contract validation, stale writes, uncertain outcomes, keyboard focus, loading/error, old response suppression and explicit saves. `node web/src/calendar/verify-calendar.mjs <built-web> <built-server-dist>` runs the built App against actual Calendar routes and a disposable SQLite file, including create/edit/attendance, reopen persistence and stale writes at 1440/390/320 widths. Other API responses are labelled fixtures. It never uses the live AVA database or sends notifications. Exact gate results and source/runtime promotion state are in BOARD.md.
