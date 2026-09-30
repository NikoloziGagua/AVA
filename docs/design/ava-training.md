# AVA Training tab: build spec

Status: **design approved by Niko on 2026-09-30.** Build from this document.
If something here is unclear or missing, ask Niko; don't guess.

## Sources

- The approved mockup, built from AVA's real components:
  - code: `web/training-preview.tsx` and `web/training-preview.html`. These are
    scratch files, never committed. Serve them with Vite from `web/`
    (`npx vite --port 5199`) and open `/training-preview.html`.
  - screenshots: `data/builds/claude-training-mockup/` (`plan.png`,
    `methods.png`, `progress.png`, `log.png`, `phone.png`).
- A sample of his real calendar used by the mockup:
  `data/builds/claude-training-mockup/calendar.json`.
- Workspace layout and code to copy: the Projects tab (`web/src/projects/`,
  `server/src/projects/`) and Calendar (`web/src/calendar/`).

## What Niko decided

- **What he trains:** mobility, fighting (MMA, boxing, jiu-jitsu, kickboxing),
  gym sessions and running.
- **No main goal and no fixed targets.** Sessions are designed together with
  AVA as they go.
- **A 7-day cycle** (the mockup shows 10 days; change it to 7).
- **A daily check-in** ("how are you feeling?") is fine, by voice or tap.
- **Watch data** (sleep, heart rate) comes later. It is not part of this build.
- **The part he liked most:** linking techniques (methods) to real sessions.
- **The calendar rule:** AVA reads his calendar and proposes sessions around
  it, but **adds nothing until he approves**, and adapts when the calendar
  changes.

## What it is

A Training tab where AVA plans the next 7 days of sessions around Niko's
lectures and existing bookings. He approves, skips or changes each session. He
logs sessions and checks in by voice or tap. He captures techniques from videos
or classes and tests them in real sessions until each is proven or dropped.
AVA uses his logs and check-ins to keep the plan sensible (load, soreness,
rest).

## Screens

The layout is the approved mockup: the Calendar v6 workspace, with a left
rail, main tabs and a right AVA panel. Move the mockup's `tr-*` styles into
`web/src/design/tokens.css` as `ds-training-*`.

**Left rail**
- Readiness today, from the check-in (ring plus a word: Fresh, OK, Tired,
  Sore, Injured).
- "This cycle": done and planned counts per discipline, with a small bar each.
  Because he has no targets, it shows **done / planned**, not a target.
- A short note.

**Tab: Plan**
- One row per day for 7 days. Each day lists:
  - calendar commitments (lectures: muted, labelled);
  - training already in his calendar ("In calendar");
  - AVA's proposals (dashed, with **Add** and **Skip**).
- **Approve all** adds every proposal at once.
- Warnings for odd calendar entries, with a fix button that he must press
  (e.g. two "Run" entries back to back: "Merge?").
- Each proposal has a one-line reason ("Free after lectures. Tests the
  slip-roll method.").

**Tab: Methods**
- A capture box: paste a link, describe the technique, or use the mic.
- Filter chips per discipline.
- A list with status tags: New, Testing, Proven, Dropped.
- The detail shows: source; AVA's key points; the test plan; results so far;
  and the buttons **Add to <next session of that discipline>**, **Mark
  proven** and **Drop it**.

**Tab: Log**
- Today's session as a MetalObject.
- Its plan blocks, and which method each block tests.
- Effort 1–10 (chips).
- "Did the new method work" (Yes / Sometimes / Not yet).
- Anything sore (chips), notes, and **Log session**.
- The voice hint: "did boxing, 75 minutes, felt heavy".

**Tab: Progress** (phase 3)
- Key numbers from logs, such as 5 km time, lifts and sparring rounds.
- Training load over 14 days (minutes × effort per day).
- Readiness trend.
- "What's working" and "watch out" receipts.

**Right panel: AVA**
- The status island ("N sessions waiting for your OK").
- Receipts for replans and new methods.
- The check-in chips.
- One suggestion.
- The ask-bar.

**Phone:** one column. The rail and panel become sections above and below the
tabs, the same as Projects on the phone.

## How AVA plans

Planning is a server call that uses a model with clear inputs and strict
validation. It never writes to the calendar.

**Inputs:**
- calendar occurrences for the next 7 days;
- training already booked in the calendar;
- the last 14 days of logs (discipline, minutes, effort, soreness);
- today's check-in;
- methods in Testing;
- what memory knows about his routine (e.g. a Tuesday 19:00–21:00 gym or
  jiu-jitsu slot).

**Output:** at most 7 proposals. Each has discipline, date, start, duration,
title, plan blocks (text, minutes, optional method id) and a one-line reason.

**Validated in code, not trusted to the model:**
- in the future, and between 07:00 and 22:00 Dublin time;
- no overlap with any calendar occurrence or other proposal, with a 30-minute
  buffer;
- at most one hard session (fighting with sparring, heavy gym, a long or fast
  run) per day, and never hard days back to back for the same body area;
- at least one rest or mobility day in the 7;
- if the check-in says Sore or Injured: lighter sessions, and nothing
  touching the named area;
- a proposal that fails validation is dropped, never "fixed" silently.

**Replanning:** when he opens the tab, or a calendar change touches the next 7
days, AVA:
- re-checks approved sessions against the calendar;
- marks any conflict and proposes a new time. Moving an approved session needs
  his OK;
- may re-propose unapproved proposals freely, and says so in a receipt with
  Undo.

## Calendar rules

- Training that is already in the calendar is recognised by its title
  (gym, run, jiu-jitsu or jujitsu, BJJ, boxing, kickboxing, MMA, mobility,
  stretch, training). It shows as booked and counts in the cycle. AVA never
  edits those events.
- **Approving** a proposal creates one calendar event:
  - kind `block`, `recurrenceKind: "none"`, Europe/Dublin;
  - source `ava_chat` or `ava_voice`;
  - description "Training, planned with AVA".
  The session stores `calendar_event_id` and that event's version.
  - The calendar table only allows `lecture | event | block`. Adding a
    `training` kind needs a table rebuild, so don't do that in this build.
- **Removing** an approved session from the calendar is its own endpoint. It
  archives the event with `expectedVersion`.
- Every calendar write names the version it saw and fails with `409` if it
  changed.

## Methods

- **Capture:** text, link or voice. For a link, reuse
  `server/src/projects/extract.ts` (`fetchPage`, which only fetches public
  URLs). Store a short title, 3–5 key points, and a test plan (what to drill,
  how many attempts, what counts as proven).
- **Be honest about videos:** AVA reads the page (title and description), not
  the video itself. The capture box says so, and asks him to describe what he
  saw.
- **Statuses:** new → testing (when added to a session) → proven or dropped.
  Proven and dropped are his call; AVA may suggest.
- **Trials:** logging a session that tested a method records the result
  (landed / sometimes / not yet) and a note. The method shows the running
  totals.

## Logging, check-in, readiness

- **Log:** discipline, minutes, effort 1–10, the result for each tested
  method, sore areas and notes. For runs, add optional distance and time.
  Logging the planned session for today marks it done. An unplanned session
  creates a done session.
- **Check-in:** one per day. Fields: feeling (fresh, ok, tired, sore,
  injured), sore areas, note, and hours slept (optional).
- **Readiness:** a simple, explainable score from today's check-in, with fresh
  90, ok 70, tired 50, sore 50, injured 20, and minus 10 when he slept under 6
  hours. No black-box numbers.

## Voice and AVA's tools

**Fast lane (`server/src/lookups/training-actions.ts`, the pattern of
`project-actions.ts`):** one action, done directly in about 2 s:
- log a session ("did boxing, 75 minutes, felt heavy, shoulder sore");
- check in ("I'm tired today");
- approve all or one proposal ("yes, add them");
- skip one;
- what's today / this week;
- add a method ("I learned a slip-roll counter today").

"Plan my week" runs the planner, then reads the proposals back. It may take
longer, and that's acceptable.

**Agent tools (`server/src/tools/training-mcp.ts`, both modes):**
`training_plan_week`, `training_list`, `training_approve`, `training_skip`,
`training_log`, `training_checkin`, `training_method_add`,
`training_method_update`, `training_add_to_session`. Also add a Training
section to the tool rubric.

## Data (all new tables; `CREATE TABLE IF NOT EXISTS`)

- **`training_sessions`:**
  - id, discipline, title;
  - status: `proposed | approved | done | skipped`;
  - local_date, start_local_time, duration_min;
  - plan (JSON blocks `{text, minutes, methodId}`), reason;
  - calendar_event_id, calendar_event_version;
  - log fields: minutes, effort, sore (JSON), notes, distance_km,
    duration_s, logged_at;
  - source, version, created_at, updated_at.
- **`training_methods`:**
  - id, name, discipline, status, source_url, source_note, key_points,
    test_plan;
  - version, created_at, updated_at.
- **`training_trials`:** id, method_id, session_id, result, note, created_at.
- **`training_checkins`:** id, local_date (unique), feeling, sore (JSON),
  sleep_hours, note, created_at, updated_at.

Disciplines: `mobility | bjj | boxing | kickboxing | mma | gym | run`.

## API (`/api/training`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/?from=YYYY-MM-DD` | the 7-day view: calendar items, booked training, proposals, approved and done sessions, conflicts, check-in, readiness, cycle counts |
| POST | `/plan` | run the planner and store the proposals |
| POST | `/sessions/:id/approve` | `{expectedVersion}`: writes the calendar event |
| POST | `/sessions/:id/skip` | skip a session |
| POST | `/sessions/:id/unschedule` | `{expectedVersion}`: archives the calendar event (its own endpoint) |
| PATCH | `/sessions/:id` | change time, duration or plan (proposals, or approved with a calendar update) |
| POST | `/sessions/:id/log` and `/log` | log a planned session, or an unplanned one |
| PUT | `/checkins/:date` | save the day's check-in |
| GET, POST, PATCH | `/methods` | list, capture and update methods |
| POST | `/methods/:id/add-to-session` | put a method into a session |

## Build phases (ship each one live)

**Phase 1: plan, approve, log, check in.**
- Tables, store, routes and tools.
- The planner with validation.
- The Plan tab, the Log tab, the readiness rail and the AVA panel.
- Voice fast lane: log, check-in, approve, today/this week.

Done when:
- planning a real week against his calendar produces valid proposals with no
  overlaps;
- nothing appears in the calendar until approved;
- approving one creates exactly one event, and unscheduling archives it;
- a stale approve returns 409;
- "did boxing 60 minutes, effort 7" by voice logs it in about 2 s.

**Phase 2: methods.**
- Capture (text, link, voice), link reading, statuses, trials from logs, and
  "Add to <session>".

Done when:
- a pasted link becomes a method with key points and a test plan;
- adding it to a session puts it in that session's plan;
- logging "sometimes" adds a trial.

**Phase 3: progress and adapting.**
- The Progress tab (load, readiness trend, key numbers).
- Automatic re-proposal after calendar changes.
- AVA asking for the check-in if there hasn't been one today (at the first
  voice or chat of the day).

Done when:
- adding a lecture that overlaps an approved session shows a conflict with a
  proposed new time, and nothing moves until he approves.

## Still to ask Niko (the build session asks, not guesses)

1. Does the 7-day cycle roll from today, or run Monday to Sunday?
2. What are his usual gym and club places and times, and how much travel time
   should AVA leave before and after?
3. Which fixed classes should AVA treat as always booked, even when they
   aren't in the calendar?
