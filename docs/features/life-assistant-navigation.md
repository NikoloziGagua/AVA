# Life-assistant navigation: Today, Talk, Schedule, Notes, Ideas

## What it does

AVA opens on **Today**, a single screen that shows what Sir is in the middle of:
the three latest conversations, the newest ideas, other recent notes and the
next reminders with their honest status. Talking to AVA (by voice or typing) is one tap away.

The sidebar is organised around everyday life instead of AVA's own machinery:

| Primary | What it opens |
|---|---|
| **Today** | The default screen after the intro |
| **Talk** | The current conversation exactly, or "Your conversations" if there is none |
| **Schedule** | One-off reminders: add one at an exact time, see what happened to each ([Reminders](reminders.md)) |
| **Notes** | The existing Notes workspace |
| **Ideas** | Idea notes: capture one, open one |

Every earlier destination still exists under a collapsed **System** group:
Activity (Mission Control, in its own window), Explore AVA, Watches, Memory,
Visual explanations, Settings & rules and Self development. The development
room is part of AVA's chat/voice flow rather than a second conversation page.

## Why it exists

AVA is meant to be a personal assistant and life manager for uni, projects,
ideas and reminders. The previous home screen and navigation led with AVA's
developer tools. Sir had to go looking for his own conversations and notes, and
every reload replayed a 1.7-second intro. Today puts his own material first. In
the local fixture harness (headless Chrome on the dev PC), a reload now shows
Today's command bar in about 75 ms instead of about 2.4 s. That is
time-to-interactive-screen, not the time for data or a reply to arrive.

## How Sir interacts with it

1. **Today** loads each section on its own. A slow or failed section shows its
   own loading or error state and never blanks the rest of the page.
   - *Continue talking* lists Sir's three latest conversations (`scope=human`),
     never automation runs or unclassified history.
   - *Recent ideas* and *Recent notes* show up to three live notes each.
     Archived notes are excluded. Tapping one opens **that exact note** in Notes.
   - *Schedule* lists the next three upcoming one-off reminders with their
     receipt status (for example "Scheduled", or why nothing can be sent yet). It
     is read-only, refreshes every 15 seconds while visible and on focus, and
     says so when a refresh fails instead of silently showing old statuses.
   - The capture box starts a new chat seeded with what Sir typed. The orb
     ("Talk to AVA") opens voice on the current conversation, or continues the
     latest one.
2. **First run.** When every section loaded successfully and is empty (no
   conversations, notes or reminders), Today
   shows a welcome with three starter prompts and a setup list. Phone
   notifications are listed as not available yet. The copy describes the
   screen; it never claims AVA knows nothing, since durable memories may exist.
   A load error never triggers the welcome.
3. **Ideas** saves a thought as a `kind=idea` note. While the save is pending,
   the text box is read-only. After success it clears only if the text is
   unchanged. A failed save keeps the words and says why. Long unbroken text,
   such as a pasted URL, wraps inside its card.
4. **Talk** goes back to the remembered conversation exactly (the I1 binding
   rules). With nothing remembered it shows Sir's conversations.
5. **The intro** plays once per browser tab and never under AVA's reduced
   motion. Once a tab has loaded, by any route, reloads go straight to Today.
   If the browser blocks session storage, the tab cannot remember that, so the
   intro plays on every load with full motion; reduced motion still skips it.
6. **On a phone or tablet** (below 1024 px, where the open drawer covers the
   page), choosing anything from the drawer closes it.

## Edge cases and limitations

- A note that was deleted or archived since Today loaded opens Notes on General
  with "That note is no longer available". The handoff runs once, so the
  periodic Notes refresh never reopens it.
- When voice reports its conversation unavailable, AVA forgets the conversation
  voice was bound to in that visit, or the one it was entered with. It only
  forgets it if it is still the remembered chat.
- The voice background is decorative. It loads after the voice controls, never
  loads under reduced motion or without WebGL, and falls back to a static
  backdrop if its code fails to load or its renderer fails later (a frame or a
  resize).
- Reminder statuses stop at the notification service: "Accepted" never means
  the phone showed it. The full receipt model is in [Reminders](reminders.md).

## Technical decisions

- **No new router or server API.** Views remain App state
  (`today | ideas | schedule | notes{noteId, handoff}` …). Today reads
  `GET /api/sessions?scope=human&limit=3` and the existing notes snapshot.
- **Exact note handoff** is an optional `initialNoteId` prop on `NotesScreen`. It
  is consumed once after the first successful load. Each navigation remounts
  Notes with a new `handoff` key.
- **Splash bookkeeping.** `shouldPlaySplash()` reads the tab-scoped
  `sessionStorage` key `ava:splash-seen` and the AVA motion preference. `App`
  writes the key on its first mount.
- **Voice visit binding.** `App` stores `{ visit, sessionId }` from
  `onSessionBound`, keyed to the voice view object, so an earlier visit's
  binding can never decide what a later visit forgets.
- **Bundle.** `DottedSurface` (Three.js) is imported only lazily by
  `VoiceScreen`, and the bundle verifier requires it to stay a deferred chunk.
  Today, Ideas and Schedule are eager routes: I3a added about 11 KB and the
  I4 reminder UI about 20 KB, leaving 874,451 of 900,000 eager bytes. Lazy-
  loading the non-default routes is the next budget lever.
- **DottedSurface containment.** Frames and resizes run outside React, so a
  thrown error there is caught locally. The surface stops the loop, releases
  each GL resource once (each release isolated), removes the canvas and calls
  `onError` once.
- **Collapsed rail CSS.** In the collapsed state only, the destination grids use
  `minmax(0, 1fr)` and drop label gaps, so hidden labels cannot widen the rail
  and make it scroll sideways when a destination has focus.

## Verification

- Unit/component: `App.new-chat.test.tsx`, `AppSidebar.test.tsx` (width-aware
  `matchMedia`), `today/`, `ideas/`, `schedule/`, `NotesScreen.test.tsx`,
  `VoiceScreen.surface.test.tsx`, `DottedSurface.test.tsx`.
- Browser (fixture database, no provider): `.verify/claude-i3a-browser-check.mjs`
  checks 1440/800/390 px, keyboard-only navigation, reduced and full motion, rail
  containment, the long-URL card, the exact note handoff, the Talk/voice pointer
  and time-to-Today, with zero console errors.
