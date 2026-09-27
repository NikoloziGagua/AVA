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

## Notes library and remaining boundaries

Notes now uses a dark-default Silver Silk library, open folder/file rails and
a readable document plane. Phone navigation drills from library to files to
reader, with explicit Back controls. Versioned persistence, derived pagination,
full text, Study files, exact handoff, Board and Project Brief survive. The
editor uses simple fields and shows failures inside its dialog. See [Notes](notes.md).

Calendar
now opens its real server-authoritative Month/Week/Day workspace with an open
event editor, selected-day agenda and explicit attendance. Standalone reminders
are still reachable separately; event-linked notifications remain unavailable.
See [Calendar C2](calendar.md#c2-the-actual-calendar-workspace) for exact limits.
No sample events, preview localStorage, demo responses, schemas or API writes
are imported from the preview. The rejected boxed event form is not
being reused. The old standalone previews remain design references only.

Home and Voice now share a lazy forward-moving star layer over a static Nocturne
line ground. Only stars animate in the background; the line canvas repaints on
size/look changes, with no frame loop. Other pages keep the slow Silk field. Voice
has a larger flexible portrait and metal control pill. The existing measured
audio/face signals, microphone, provider, exact text, approval and session logic
are unchanged. Short screens can scroll to every control rather than clip them.
The dots' expression/drift is the existing face animation, not new audio evidence.

The bottom message bar rests at up to 480px and expands to 720px on focus, menu,
Talk, dictation, a pending reply or any non-empty draft. It is the same mounted
textarea. Voice's compact menu shows “Draft kept” when unsent words exist; this
means kept in this mounted App, not persisted to disk. Menu/keyboard focus and
explicit-send/IME rules remain. A closed menu no longer leaves a wide backing
behind the narrower pill. Remaining advanced workspaces are not all migrated.

Stars use Canvas2D (240 points below 600px, 480 otherwise), at most 30 paints/sec,
DPR 1.5 and 2560×1600 logical pixels. They stop hidden/offscreen/unmounted, draw
a static frame under Reduced and omit artwork in forced colours. Failed lazy
loading/canvas leaves the static background and controls. Face remains the sole
WebGL renderer; star/atmosphere canvases do not acquire its context.

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
It saves ignored screenshots/results under `data/builds/atelier-presence-browser`
(or the optional second argument). It also checks actual moving/static stars,
bounded counts, one WebGL face, bar width/expansion, no closed-menu backing,
Voice controls at short heights, the same textarea after Voice and no stars on
other screens. A fixture-rejected microphone exercises the real Voice failure
screen without audio/provider access. Desktop Edge phone-viewport frame samples
are recorded, not presented as physical-phone performance. This is not a real
account/provider, microphone or physical-device test.
An optional final numeric argument (bounded to 300 seconds) runs a Home motion
soak: JavaScript heap after explicit garbage collection and the live context
count. It does not measure total GPU/process memory.

Production build budgets and offline precache remain mandatory. Runtime
promotion is separate from a source commit. Consult the board for exact build,
commit, browser and release evidence. Claude has returned for independent exact
reviews; acceptance is recorded separately for each commit, never implied.
