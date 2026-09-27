# AVA metal remodel — production implementation plan

Requested by Niko on 2026-09-25 after reviewing the complete interactive metal
preview (`3a843ad`). Codex owns implementation. This plan does not treat demo
fixtures as production features or replace working application behavior.

## The experience

AVA remains a personal assistant, not a dashboard of machinery. Home and Voice
are spacious: a large expressive portrait, a quiet status, moving points in the
distance, and one clear way to speak or type. The surrounding application uses
graphite surfaces and silver materials, with readable content and restrained
motion. Notes, time, ideas and conversations stay within immediate reach.

The demo is the reference for materials and composition, not an API contract.
Its tiny labels become production-sized text. No shader per button, fake status,
scripted assistant answer, pretend approval, or localStorage substitute for the
authoritative server data is promoted.

## Architecture and rollout

### 2026-09-27 selected direction

Niko has selected the later Atelier /03 designs: Cut /03, Time object and Twin
plane cards; Light trace navigation; Nocturne and Silver Silk; the Calendar and
dark Notes compositions. Codex chooses Quiet voice for Talk. Heavy nested event
form boxes are rejected. These supersede the earlier general-purpose slabs.

Production migration is now in progress under task58: first the shared visual
language and real-data Home/Today/Talk; then a genuine Calendar workspace and
unboxed editor against the existing calendar-events contract; then Notes layout.
See [implemented behaviour and limits](../features/atelier-interface.md).

| Increment | Implementation | Preserved boundary | Acceptance |
|---|---|---|---|
| 1. Materials | Extend `design/tokens.css`; use graphite/silver for Ink, light metal for Paper. Keep existing preference values. Resting surfaces use layered CSS; shared buttons keep their handlers. | Preferences API/versioning; severity colours; contrast and focus | Token/guard/component tests; both looks; forced colours; build budgets |
| 2. Living presence | Isolated bounded Canvas2D stars; mount only on Home/Voice. Enlarge existing lazy FaceStage; amplify dot drift without replacing measured speech energy. | One WebGL context; existing asset; provider status, face-signal, motion preference, fallback | Motion/cleanup/context tests; actual frame checks; reduced/hidden states |
| 3. Persistent bar | Keep the same mounted BottomBar and textarea. Narrow at rest, expand on focus/menu/dictation; collapse only without losing draft or focus. | App draft/session ownership; busy Stop; explicit send; IME; dictated draft; exact voice text | Existing bar/chat/voice suites plus focus/collapse/navigation tests |
| 4. Everyday screens | Adapt Today, Talk/history, Notes, Calendar/Schedule and Ideas using shared primitives. Keep full documents and operational states accessible. | Server persistence, stale-write handling, identity, source links, undo | Each screen's full existing suite; live read-only navigation and isolated fixture CRUD |
| 5. Remaining screens | Memory, watches, Explorer, visuals, Activity, Self and Settings receive the same material treatment. Retain complex controls and progressive disclosure. | Memory verification; watch receipts; approval gates; evidence; real availability | Relevant full suites and before/after screen audit |
| 6. Release verification | Build exact committed source; exercise all destinations and failure states, then verify integration before runtime promotion. | Existing PWA, offline artifacts, managed fallback, no deployment from partial tree | Full web tests, server build if impacted, both web builds, browser inspection, diff check |

### What deliberately does not change

- No database schema, new API shape, model/provider selection, or approval policy.
- No new calendar implementation disguised as a restyle: the live Schedule
  boundary stays until a separately tested Calendar integration is agreed.
- Dormant Strategy Room routes do not become operational merely because the demo
  includes an illustrative room. Existing Dev Room remains the supported entry.
- No imports from `godui-preview/demo-model` or workspace fixtures.
- No animation packages, broad dependency upgrades, budget increases or weakening
  of the design ratchet.
- No deletion of the old components until usage is checked and regression tests
  prove they are no longer needed.

## Production motion and performance

Use AVA's existing Full / Reduced / System preference. Reduced motion draws a
static star frame and a static face; hidden/offscreen animation stops. Stars use
a bounded 2D canvas with capped device pixel ratio, not Three.js. Metal controls
use CSS gradients/reflections so they do not compete with the face for WebGL.
The large face remains lazy. Backgrounds outside Home/Voice stay quiet.

Preserve the 900,000-byte / four-artifact eager budget and 500,000-byte individual
artifact budget. Every deferred artifact must remain PWA-precached. Verify the
managed single-file build separately. Never equate a green build with successful
voice, messaging, scheduling or automation.

## Test matrix

- Desktop 1440px, phone 390px, narrow 320px, landscape, 200% zoom and safe areas.
- Ink/Paper; Full/Reduced/System; no WebGL; disconnected server; empty records.
- Keyboard menu, Escape/focus return, visible labels, IME and multiline input.
- Same exact chat across Home → Talk → Voice → Talk; unsent draft retained;
  back navigation; reload and missing/deleted session behavior unchanged.
- Error/loading/empty/conflict states, approvals and countdown semantics retained.
- Verify local form writes only in disposable fixtures; no social messages,
  emails, worker launches or approvals of consequential actions for visual QA.
- New visual unit tests plus complete web suite, TypeScript, production builds,
  bundle/offline verifier and real browser screenshots/resource checks.

## Coordination and current status

Proposal38 was accepted as `ui-remodel` v4, assigning production presentation to
Codex. Task58 supersedes the stale task53 waiting note for this first increment.
The explicit user selections are now accepted as `ui-remodel` v5 (proposal39,
room811). Niko authorised solo progress while Claude was unavailable; Claude is
now independently reviewing the exact commits. Contract acceptance is not
product acceptance. Existing data models/endpoints remain unchanged.

Status: materials, Home/Today/Quiet Talk, real Calendar C2 and dark Notes have
landed in separate source commits. Task61 mounts the star layer lazily on Home
and Voice, enlarges Voice's existing portrait, and narrows the resting bar while
preserving its draft and controls. Stars are capped at 240/480 points, DPR1.5,
2560×1600 logical pixels and 30 paints/sec; no WebGL allocation. They pause when
hidden/offscreen, are static under Reduced and omitted in forced colours.
Nocturne/Silk remain the selected background family. Home/Voice freeze the
Nocturne line ground so stars are their only animated background layer.
No new face expression
algorithm or invented measured speech was introduced. Advanced workspaces and
runtime promotion remain separate gates; see the board for exact completion.
The 19-destination demo remains independently usable at `?godui-preview` and is
not evidence that every production destination has been migrated.

Checks: `npm test -w web -- src/design/metal src/design/design-guard.test.ts`,
TypeScript, full suites, canonical/managed builds and exact-commit boot. The
built-App `verify-atelier.mjs` now checks production Home/Voice with disposable
API fixtures, no physical microphone or provider calls. The earlier
`verify-starfield.mjs` remains a candidate-only historical helper, not release
evidence. Screenshots, actual frame timings and limits are recorded in the board.
