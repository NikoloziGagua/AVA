# AVA next: a proactive life and project assistant (proposal)

This is a joint Claude and Codex proposal for Niko, dated 2026-09-27. Nothing is built yet.
It is based on Niko's direction:
- He is a builder and entrepreneur, not study-focused.
- He wants capture of anything, a life-focused daily rhythm, and above all AVA messaging him first when
  she has something worth his time.
- Hosting is deferred (Niko, room #1077).
- He can't live-test tonight (#1078), so development proceeds on automated gates only.

## Principle
One connected AVA, built on the existing chat, calendar and Notes. There are no new dashboards and no
parallel "life database". Project hubs improve the existing Notes, Ideas and ProjectBrief views.

Three distinctions are kept everywhere:
- an intention, booked time and a completed activity are different things;
- a push accepted by the notification service is not proof he saw it on the phone;
- a suggested next step is not an executed action.
Requested, reversible local work (saving notes, calendar entries) keeps its current authority, and
consequential actions keep the existing approvals.

## Now

### M1. Capture anything (medium)
- Text and links from the phone go into the right Notes project folder. AVA asks when she is unsure where something belongs.
- Every save gets an exact receipt. An offline retry never creates duplicates, and the saved item links back to its source.
- Share-sheet (PWA share target), an iOS Shortcut ("Hey Siri, tell AVA…"), photos and voice memos are added one at a time. Each is verified on the real iPhone once Niko can test.

### M2. AVA starts a conversation (medium). The headline, proven early.
- Trigger: a new capture, or a project Niko has marked active. This is a small bounded trigger, not a big engine.
- AVA re-reads the actual source notes, then opens a normal chat containing:
  - the idea;
  - why it matters now;
  - links to the notes it came from;
  - a suggested next step, with Discuss, Later and Not useful responses.
- A push notification opens that exact chat.
- Limits: at most one a day to start, never in quiet hours, and nothing is sent if nothing is well-grounded.
- The model's own score only ranks candidates. Niko's replies and feedback decide what "useful" means.
- Honest limit: this works only while the PC is awake, until hosting is done.

### M4. Life rhythm (medium)
- Morning: Niko says his plan ("gym at 10, build X, run at 6"). AVA turns it into optional time blocks with gentle nudges.
- Evening: "How did it go?" Missed items are re-planned, and the day goes into a short journal and the project progress logs.
- Planned, deferred and done stay distinct. There are no inferred streaks and no invented times.

### Alongside
- The warmer personality (approved; docs/design/ava-personality-v2.md).

## Later
- **Always-on hosting (M3, large):**
  - a single-owner core on a server, with the PC as optional "hands";
  - one scheduler only and Europe/Dublin times;
  - SQLite and the source files migrate together;
  - backups, restore and restart tests;
  - about €5–10 a month plus capped model usage, to verify.
- **Speed:** a live latency measurement, then fast-model routing, once Niko can test.

## How we work while Niko can't test
- Contracts come first: a capture receipt and source envelope, the initiative record (source versions, expiry, disposition, budget), and a daily intention referencing existing records.
- Our normal automated gates apply: unit, fixture and browser tests, and exact-commit cross-review.
- No real provider or model calls in any test.
- Nothing that needs Niko's live acceptance goes live until he has tested it.

## Honest caveats
- calendar_remind currently saves a preference only. Pre-event nudges are not delivered until that is built.
- Push "accepted" means the notification service took the message, not that the phone showed it.

## Ownership
Codex owns the durable, runtime and API pieces. Claude owns the conversation-first UX, prompts and
copy. Every increment gets an exact-commit cross-review.

## Decisions for Niko (when he's back)
1. The order: M1 capture, then M2 AVA messages first, then M4 life rhythm.
2. Quiet hours.
3. Which projects count as "active", so AVA knows what to think about.
