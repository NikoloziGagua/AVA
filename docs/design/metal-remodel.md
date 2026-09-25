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

Room task53 claims the production presentation paths. Proposal38 amends the prior
`ui-remodel` visual/ownership contract, which currently specifies static
backgrounds and assigns shared components to Claude. No backend/model contract
change is proposed. Until that review is recorded, preparation may add isolated,
unmounted tested components and this plan, but cannot silently replace contracted
production screens. No independent review or deployment is claimed by this plan.

Status: plan written; isolated production-candidate `design/metal/Starfield.tsx`
and deterministic `particles.ts` implemented with unit tests. The component is
not imported by App/Home/Voice, so the production bundle and screens are
unchanged. Motion uses existing preferences, has no WebGL allocation, caps the
particle count/pixel ratio, and stops its frame loop when hidden/unmounted.
Integration has not shipped. The completed 19-destination demo remains
independently usable at `?godui-preview`.

Candidate checks: `npm test -w web -- src/design/metal src/design/design-guard.test.ts`,
`npx tsc -b web`, `npm run build -w web`. With the local Vite server running,
`node web/src/design/metal/verify-starfield.mjs` mounts the candidate only inside
an ephemeral browser test profile: real moving pixels, reduced static pixels,
unmount, zero page errors/non-GET requests. It does not edit production routing.
