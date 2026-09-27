# AVA Design Atelier / 03

An isolated, interactive comparison for Niko. Current round: **six new card structures, four animated navigation studies, three text-chat compositions, and dark Notes**. The approved Calendar and Notes layouts remain. Nocturne and Silver Silk alternate by page; the first four card proposals remain only as a rejected-design archive. **Not connected to live AVA.**

From the AVA repository root:

```powershell
node docs/design/previews/ava-atelier-2026-09-27/serve.mjs 5176
```

Open **http://127.0.0.1:5176/**. No compilation, installation or internet connection is required once AVA and its bundled fonts are present. `file://` is not supported: native modules need the local server. This is not a service-worker-installed PWA.

## Try it

1. **Cards:** compare Open form, Signal, Cut / 03, Time object, Twin plane and Living index. Shortlist directions, open a sample day or note, and expand the index with pointer or keyboard. A subtle light on the dial is decorative, not event progress. Previous Materials are accessible from the footer/Research archive link; old recommendations are not current approval.
2. **Navigation:** try Liquid rail, Proximity dock, Command capsule and Light trace. Selection changes the sample destination in place. The capsule closes on selection/Escape and returns focus; no AVA route is changed. Keyboard focus raises dock icons too; paused/reduced motion removes that movement.
3. **Talk:** compare Quiet voice, Thinking studio and Editorial thread with any navigation style. Type a draft, switch designs, reload: the exact draft survives. Suggestions fill, never send. Enter adds a local preview message; Shift+Enter inserts a newline; composing Enter is ignored. No fake assistant answer or provider call follows. The source drawer and activity disclosure are explicitly sample context, not real tools or reasoning.
4. **Calendar:** the approved Nocturne layout retains Day/Week/Month, previous/next/Today, create/edit/attendance/location and linked lecture notes. Mouse-drag blank time to draft a range; drag an event to move it and Undo. Touch/keyboard users have the same form actions.
5. **Notes:** now dark throughout, including the editor, on Silver Silk. Search, browse, pin, focus, create/edit/reorganise remain unchanged. Ctrl/Cmd+K opens search. Small screens retain the library/reader switch and folder selector.
6. **Research:** first-party sources and design interpretation, plus a clearly marked previous-round archive.

Pause motion in the header. OS reduced motion selects a static frame. Forced-colors mode removes the decorative backdrop. Native dialogs support Escape, focus containment and cancel-focus return. Text is at least 12px in the checked layouts. This is not a full WCAG certification or a physical-device performance claim.

## Data and boundaries

- Sample events, notes, materials and shortlist use only this origin's `localStorage` key `ava:atelier:20260927:v1`.
- The new designs, card shortlist, exact draft and last 12 local preview messages use `ava:atelier:studies:20260927:v1`. Draft/message bounds: 2,000 characters each; maximum serialized payload 200,000 characters (including JSON escapes). Unknown fields/identifiers are discarded; invalid schema/oversized input resets these disposable preferences. Old Calendar/Notes storage is not migrated or overwritten.
- Nocturne: Cards, Talk, Calendar, Research. Silver Silk: Navigation, Notes. These are fixed page decisions, not random background cycling. The previous Materials archive still supports its original four-background comparison.
- Reload restores fixture content and design preferences; transient search, selected date/note and open editors are not restored. Clear that key to reset the fixture.
- No AVA API calls, provider calls, private data, cookies or accounts. No real reminders, AI answers or live calendar updates. All external source links require an explicit click.
- Dates use a fixed illustrative September 2026 week; the sample “now” line is not a live clock.
- Calendar: one-off, same-day, 15-minute minimum; up to 200 sample events. No recurrence or timezone conversion. The grid is 80 pixels/hour, shared with its pointer coordinate conversion.
- Notes: basic escaped headings/lists/paragraphs; one folder level; up to 100 notes, 30,000 characters per body. Invalid, unknown-version or oversized stored fixture payloads (>250,000 characters) reset to defaults. This is disposable concept storage, not a durable data system.
- One Canvas2D backdrop, 420 desktop / 180 small-screen stars, maximum DPR 1.5. No WebGL, shader libraries, animation frameworks, CDNs or new packages.
- Original code and visuals; existing AVA Geist fonts are reused. No external site assets or component source copied.
- Live AVA, production bundles, package configuration and backend remain unchanged. The scrolling catalogue is not a proposed scrolling Home.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Accessible shell, material studies, workspace layout and responsive styles |
| `app.mjs` | Tab routing, comparison controls, shortlist, local state and dialog orchestration |
| `backdrop.mjs` | Four original animated/static Canvas2D backgrounds |
| `studies.mjs`, `studies.css` | Original card/nav/chat interactions, motion, responsive presentation and dark Notes overrides |
| `studies-model.mjs` | Bounded versioned local design/draft/message preferences, separate from sample notes/calendar |
| `calendar.mjs` | Sample time canvas, month/day navigation, editor, drag range/move/undo |
| `notes.mjs` | Sample hierarchy/list/reader, search, editing, pinning, focus and contextual handoff preview |
| `model.mjs`, `icons.mjs` | Typed-by-validation fixture model, interval/date helpers, safe formatting and original SVG icons |
| `serve.mjs` | Loopback-only static preview server; no write endpoints |
| `model.test.mjs`, `verify.mjs` | Node tests and independent Edge browser verification |
| `studies.test.mjs`, `verify-studies.mjs` | New model, all card/nav/chat variants, exact drafts, semantic keyboard, dark Notes and reduced-motion browser checks |
| `capture.mjs`, `research-capture.mjs` | Optional local screenshots of the preview and public research references |

## Verify

Run from the repository root. Browser verification reuses AVA's installed Playwright and Edge, with an isolated temporary browser context and an ephemeral local port. It neither changes your preview preferences nor calls live AVA.

```powershell
node --test docs/design/previews/ava-atelier-2026-09-27/model.test.mjs
node --test docs/design/previews/ava-atelier-2026-09-27/studies.test.mjs
node docs/design/previews/ava-atelier-2026-09-27/verify.mjs
node docs/design/previews/ava-atelier-2026-09-27/verify-studies.mjs
```

Node coverage: valid/invalid storage, schema compatibility, bounded fields, dates, drag snapping, overlap columns, inert HTML, Markdown semantics, folder identity, read-only static server and local fonts.

Browser coverage: all 16 pairings, shortlist download/reload, real animation/pause, Calendar creation/cancellation/focus/save/reload/edit/month-to-day, actual mouse range creation, dispatched native drop/Undo, deletion, exact note linkage, search/edit/HTML escaping/reload/new note/folder/pin/focus/keyboard, browser Back, narrow layouts at 390/320px, reduced motion, forced colors and no external/API traffic or console errors. Native event moving is tested with a dispatched HTML5 drop; the drag-range path uses actual pointer events. Neither is a physical touch-device test.

Generated screenshots and `results.json` are local, disposable evidence in ignored `data/builds/atelier-verification/`. Public-site captures are in `data/builds/atelier-references/`. Do not commit generated captures or Niko's input screenshots.

First-round verification was 18 Node tests + 125 browser assertions. This round retains those regression checks and adds the studies suites above. New screenshot/results evidence is in ignored `data/builds/atelier-studies-verification/`. Final exact counts and committed rerun evidence are recorded in `coord/BOARD.md`, rather than treating an in-progress run as final. Tests use local headless Edge at 1440/390/320px, not physical phones. The browser checks inspect viewport overflow, a 12px text floor, sampled Notes metadata contrast, navigation alignment and actual motion; they are not a full WCAG audit. Full AVA server/web suites and production builds are not rerun for this isolated, unimported docs-only preview. Live `web/dist` remains unchanged.

Research and recommendation: [Design Atelier research](../../ava-atelier-research-2026-09-27.md).
