# AVA Design Atelier / 02

An isolated, interactive comparison for Niko: four moving backgrounds, four card designs, and redesigned Calendar/Notes concepts. **Not connected to live AVA.**

From the AVA repository root:

```powershell
node docs/design/previews/ava-atelier-2026-09-27/serve.mjs 5176
```

Open **http://127.0.0.1:5176/**. No compilation, installation or internet connection is required once AVA and its bundled fonts are present. `file://` is not supported: native modules need the local server. This is not a service-worker-installed PWA.

## Try it

1. **Materials:** use the two selectors in the hero to compare 16 pairings. Lower down are the four visual swatches and a side-by-side card comparison. Keep a pairing, then open My shortlist and download your choices. The living folio's next button cycles three sample events.
2. **Calendar:** try Day/Week/Month, previous/next/Today, create a time block, edit attendance or location, and open a connected lecture note. Mouse-drag blank time to draft a range; drag an event to move it and use Undo below the grid. Touch and keyboard users can use New event and the form instead.
3. **Notes:** search, browse spaces/folders, read connected notes, pin, enter focus mode, create/edit/reorganise a note. Ctrl/Cmd+K opens note search. Small screens have a library/reader switch and folder selector.
4. **References:** inspect the actual sources and the design interpretation.

Pause motion in the header. OS reduced motion selects a static frame. Forced-colors mode removes the decorative backdrop. Native dialogs support Escape, focus containment and cancel-focus return. Text is at least 12px in the checked layouts. This is not a full WCAG certification or a physical-device performance claim.

## Data and boundaries

- Sample events, notes, materials and shortlist use only this origin's `localStorage` key `ava:atelier:20260927:v1`.
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
| `calendar.mjs` | Sample time canvas, month/day navigation, editor, drag range/move/undo |
| `notes.mjs` | Sample hierarchy/list/reader, search, editing, pinning, focus and contextual handoff preview |
| `model.mjs`, `icons.mjs` | Typed-by-validation fixture model, interval/date helpers, safe formatting and original SVG icons |
| `serve.mjs` | Loopback-only static preview server; no write endpoints |
| `model.test.mjs`, `verify.mjs` | Node tests and independent Edge browser verification |
| `capture.mjs`, `research-capture.mjs` | Optional local screenshots of the preview and public research references |

## Verify

Run from the repository root. Browser verification reuses AVA's installed Playwright and Edge, with an isolated temporary browser context and an ephemeral local port. It neither changes your preview preferences nor calls live AVA.

```powershell
node --test docs/design/previews/ava-atelier-2026-09-27/model.test.mjs
node docs/design/previews/ava-atelier-2026-09-27/verify.mjs
```

Node coverage: valid/invalid storage, schema compatibility, bounded fields, dates, drag snapping, overlap columns, inert HTML, Markdown semantics, folder identity, read-only static server and local fonts.

Browser coverage: all 16 pairings, shortlist download/reload, real animation/pause, Calendar creation/cancellation/focus/save/reload/edit/month-to-day, actual mouse range creation, dispatched native drop/Undo, deletion, exact note linkage, search/edit/HTML escaping/reload/new note/folder/pin/focus/keyboard, browser Back, narrow layouts at 390/320px, reduced motion, forced colors and no external/API traffic or console errors. Native event moving is tested with a dispatched HTML5 drop; the drag-range path uses actual pointer events. Neither is a physical touch-device test.

Generated screenshots and `results.json` are local, disposable evidence in ignored `data/builds/atelier-verification/`. Public-site captures are in `data/builds/atelier-references/`. Do not commit generated captures or Niko's input screenshots.

Builder verification on 27 September 2026: **18 Node tests + 125 browser assertions passed**, zero browser errors or external/API requests. All `.mjs` files passed `node --check`. Screenshots were inspected at 1440, 390 and 320px. A 120-frame sample at the 390px viewport measured 16.7ms median / 16.9ms p95 frame intervals on this machine; it is not a physical-phone benchmark. Browser checks also exercise malformed-storage recovery and an explicit unavailable-storage warning. Full AVA server/web suites and production builds are not rerun for this isolated, unimported docs-only preview. Live `web/dist` is unchanged.

Research and recommendation: [Design Atelier research](../../ava-atelier-research-2026-09-27.md).
