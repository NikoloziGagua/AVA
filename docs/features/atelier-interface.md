# Atelier interface — production migration

Niko selected Cut /03, Time object, Twin plane and Light trace from the local
Atelier preview. Quiet voice is the chosen text conversation layout. Nocturne
and Silver Silk are the two atmosphere families; Notes is intended to be dark
by default. This document distinguishes implemented product code from previews.

## First increment

- The persistent bottom composer now has a six-destination Light trace row.
  It delegates to App's existing navigation; New chat and all operational
  destinations remain in the menu. The same textarea, draft, dictation, Stop,
  exact conversation binding, shortcuts and recent-conversation list survive.
- Home uses Nocturne, a larger flexible face area and compact real-data cards.
  Calendar occurrences use Time object; reminders use Cut; pinned notes use
  Twin plane. Existing priority ranking and unknown-source failure handling
  are unchanged. There is no invented duration, progress or confirmation.
- Suggestions are behind “A few starting points”. Ordinary portrait/desktop
  Home fits its viewport. At short landscape/zoom heights, scrolling is allowed
  rather than hiding content. Opening suggestions is deliberate disclosure.
- Today uses Silver Silk, open section headings and the selected card structures
  over the existing human conversations, notes, ideas and reminder feed. Reminder
  receipts keep their original meanings and remain read-only here.
- Talk uses Quiet voice spacing and a quiet token-based ground. Markdown,
  inline visuals, receipts, approvals, context disclosures, errors, streaming
  and persisted history retain their original components and logic.

## Architecture

```
existing APIs → existing screen state → MetalObject (Cut / Time / Twin)
App navigation + draft → mounted BottomBar → LightTrace (selection only)
AVA motion/look preferences → Atmosphere → decorative Canvas2D / static ground
```

`web/src/design/metal/` contains the presentation components. Colours and
materials live only in `design/tokens.css`. Ink remains the default; an explicit
Paper preference is respected. Buttons are native buttons with visible focus;
there are no nested interactive cards or arbitrary HTML. Light trace arrow and
Home/End keys move focus, not the destination. Enter/Space activate normally.

Atmospheres use one bounded Canvas2D per mounted Home/Today, not another WebGL
context. Lines are capped at 36 on narrow screens / 64 otherwise, DPR at 1.5,
resolution at 2560×1600 logical pixels, paint cadence at at most 25fps. Animation
stops hidden/offscreen/unmounted and is static under AVA's Reduced preference.
Forced colours omit the artwork. If Canvas2D is unavailable, the static CSS
ground remains. The existing face renderer, live speech signal and asset are
unchanged. No shader per button or new dependency was added.

## What is not yet migrated

The approved Calendar workspace/event editor and full dark Notes composition
are subsequent increments. The current Calendar destination still opens the
legacy Schedule/reminders screen; only Home reads actual calendar occurrences.
No sample events, preview localStorage, demo responses, schemas or API writes
are promoted by this first increment. The rejected boxed event form is not
being reused. The old standalone previews remain design references only.

Existing App workspace navigation is in-memory, not a browser-history router.
Browser Back does not traverse those workspace changes, and reload opens Home;
the remembered exact human chat remains selectable through Talk. This increment
does not claim to add history restoration or persistent unsent drafts.

## Verification and release

Focused `design/metal/Atelier.test.tsx` covers variants, inert text, exact actions,
navigation focus/selection, capped Canvas2D, StrictMode cleanup, hidden/offscreen,
reduced-motion, forced-colours and unavailable-canvas behaviour. Existing Home,
Today, bar, chat and full web tests cover the preserved data/session behaviours.

`node web/src/design/metal/verify-atelier.mjs <built-web-directory>` exercises
the built production App in Edge at 1440/390/320, Ink and Paper. All API responses
are disposable browser fixtures; it rejects writes, checks moving/static pixels,
layout, retained draft, remembered chat, keyboard menu/focus and console errors.
It saves ignored screenshots/results under `data/builds/atelier-m1-browser`.
This is not a real account/provider, microphone or physical-device test.

Production build budgets and offline precache remain mandatory. Runtime
promotion is separate from a source commit. Consult the board for exact build,
commit, browser and release evidence; no Claude acceptance is implied while he
is unavailable.
