# AVA · Calendar series actions mockup (28 Sep 2026)

This is the UI mockup that calendar-events v3 requires before its web actions are built ("The exact design is shown to Niko before it is built"). Niko approved the calendar repair scope in room message 1598. Codex builds the server part, and this page is for Niko to approve the screens.

**It is a mockup, not a feature.** Every action is labelled proposed. The events, dates and names are invented. The page follows the look of the current Calendar (black glass, metal primary button, bottom sheet), but it imports no AVA code, makes no network requests and saves nothing.

## Open it

From the AVA repository root:

```powershell
node docs/design/previews/ava-calendar-series-actions-2026-09-28/serve.mjs 5186
```

Then open http://127.0.0.1:5186/.

## What it shows

- **The event sheet gains a "Whole series" section** with two actions:
  - **End series from here:** this occurrence and every later one stop, and past ones stay. This maps to `POST …/end`. Undo calls `extend`.
  - **Remove series…:** for a duplicate or a mistake. For a series that has started, the confirmation says plainly that its past occurrences are hidden too. This maps to `DELETE …?includeHistory=true`. Undo calls `restore`.
- **A history conflict is explained in plain words.** For example, a later tutorial was moved earlier and has already happened, so ending would hide it. The page suggests a safe date instead of showing a generic failure.
- **What AVA says by voice** for removing, ending, a conflict, and a request that changes nothing.
- **Three decisions for Niko,** each with a proposed default.

## Boundaries

- Static HTML and CSS plus one inline script. It reuses the Future hub's `shared.css` and `shared.js`.
- Reduced motion is respected, and Escape or tapping the scrim closes the sheet.
- `serve.mjs` serves only this folder, the hub's shared files and AVA's bundled fonts, read-only, on 127.0.0.1. A malformed URL gets a 400 response.
