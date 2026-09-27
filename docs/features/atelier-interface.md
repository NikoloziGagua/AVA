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

The production face (Home and Voice, `FaceStage`) now uses the lively profile
Niko asked for in room #773/#775. It had previously been wired only into the
preview (`LivingFace`). About every 1–3 s her attention moves: half the time
she looks back at you, and otherwise glances nearby, eyes first and the head
following. She breathes roughly every 4–5 s, and her dots are drawn slightly
more solid, at presence 1.12. The algorithms are the existing, reviewed
`FaceAnimator`/renderer ones; nothing new was invented. Her state and speaking
level still come only from AVA's real voice state and measured level; the
lively profile never fakes speaking. Under Reduced she is exactly still: no
breath, drift or pointer. Switching the motion preference restarts her looking
ahead. The calm profile remains the animator default and its recorded replay
is unchanged.

The bottom message bar rests at up to 480px and expands to 720px on focus, menu,
Talk, dictation, a pending reply or any non-empty draft. It is the same mounted
textarea. Voice's compact menu shows “Draft kept” when unsent words exist; this
means kept in this mounted App, not persisted to disk. Menu/keyboard focus and
explicit-send/IME rules remain. A closed menu no longer leaves a wide backing
behind the narrower pill. Remaining advanced workspaces are not all migrated.

Stars use Canvas2D (500 points below 600px, 900 otherwise), at most 60 paints/sec,
DPR 1.5 and 2560×1600 logical pixels. They stop hidden/offscreen/unmounted, draw
a static frame under Reduced and omit artwork in forced colours. Failed lazy
loading/canvas leaves the static background and controls. Face remains the sole
WebGL renderer; star/atmosphere canvases do not acquire its context.

After independent review, forward speed is 0.5 depth units/second (previously
0.13), with a 0.16 opacity floor before depth modulation. The scene is noticeably
alive without adding another WebGL context. The composer's 240ms max-width
transition is a deliberate small layout-animation exception; Reduced disables
it and all transition delays. Menu closing remains clip-animated while becoming
inert immediately. Light trace has an opaque label ground with a radial outer
scrim, and composer keyboard focus outlines the pill, not a second inner box.
Today has no second legacy composer: capture uses the same persistent bar.

Existing App workspace navigation is in-memory, not a browser-history router.
Browser Back does not traverse those workspace changes, and reload opens Home;
the remembered exact human chat remains selectable through Talk. This increment
does not claim to add history restoration or persistent unsent drafts.

## Verification and release

Ideas uses an open Silver Silk capture and Twin-plane cards backed by the existing
Notes API. Only non-archived `kind: idea` records appear, newest update first;
the query applies that existing server filter before the 250-row bound, so ordinary
notes no longer crowd them out. Today requests its ideas independently too, and
one failed ideas read does not hide its ordinary notes. At 250 ideas the UI warns
that other ideas may be omitted. The server selects pinned records first, so the
client's newest-first order is over returned records, not a promise of globally
complete recency. Other Recent notes remain over the existing bounded snapshot.
The Twin plate shows the real updated day/month, using the shared Dublin default;
the displayed Dublin timestamp is the recorded update time, not priority or
progress. Enter in the textarea is a newline. Only Save idea writes; a synchronous
in-flight guard prevents double submission. The 30,000-character limit matches
the existing endpoint. A successful write clears only the submitted draft and
announces “Idea saved.” independently of list refresh. Read failures can be retried
without re-sending the capture. Failed writes keep the draft visible. Older read
responses cannot replace a newer snapshot, and unmounted completions do not
refresh another screen. Cards open the exact note in Notes; editing remains there.
When that ID is outside Notes' bounded global list, Notes reads the existing
authenticated exact-ID endpoint. The selected file is resolved again on existing
10-second/focus refreshes, not preserved as a stale copy. Archived and missing
files share the unavailable notice; failed reads are not called deletion. An
exact-file failure shows a retry state in that reader while the library remains
usable. Stored tool-created long documents are accepted on read; the HTTP form's
30,000-character create limit is not retroactively imposed on existing records. Late
responses cannot replace a newer load or selection. Folder counts still come
from the authoritative tree; bounded/inconsistent lists are labelled partial,
and a supplemental selected file never inflates that count. This is not full
library pagination or global search; search over a bounded snapshot says so.
The shared Notes create client now requires a bounded note ID, positive version,
expected kind, known section/status, textual title/content, renderable collections
and finite recorded times
before returning a receipt. Malformed 2xx is an unconfirmed write, not success.
It does not compare content byte-for-byte because the server sanitizes it.
Ideas refreshes the list after network/5xx/malformed receipt errors and explains
that the save may have landed; no matching row is treated as proof, and no write
is replayed. A definite 400 remains a correctable validation error. Notes quick
capture/new-file callers retain their drafts and display the unconfirmed error.
This is not a new Ideas store, background indexing job or automatic send. Drafts
are still screen-local and are not promised across navigation/reload. Network
failure after server acceptance remains uncertain under the existing create API;
there is no new cross-request idempotency contract or automatic write retry.

`node web/src/ideas/verify-ideas.mjs <built-web> <built-server> <evidence-directory>`
uses actual authenticated Notes routes and disposable SQLite with the built App.
It seeds 260 unrelated pinned documents to prove server-filtered Ideas/Today
retrieval, and drops a successful write receipt to test uncertainty without replay.
It checks explicit capture, duplicate-submit suppression, exact Notes handoff,
restart/reload persistence, Ink/Paper at 1440/390/320, long words, keyboard focus,
Reduced/forced-colours and zero unexpected browser errors. Other endpoints are
fixtures, no provider or user data is accessed, and fixture note rows are cleaned.

### Reminders

Open Calendar, then Reminders. The existing Schedule destination is an open
Nocturne Reminders workspace: a
static line ground, essential writing/date fields, chronological receipt rows
and an expandable delivery explanation. There are no nested form cards. The
screen uses the existing one-off create/delete endpoints, exact wall-time
resolver, refresh hook and status presenter unchanged. The browser's named zone
is displayed explicitly; spring gaps are rejected and repeated autumn times
require a choice. Errors are associated with their date input for screen readers.
Unknown saves keep their words and are never automatically replayed. Delete still
requires its separate explicit confirmation. Service acceptance does not become
phone receipt, and historical/stale states keep their existing wording.

Schedule and Today explicitly select the token-based 12px-minimum receipt style.
Shared WhenField/ReminderStatusChip default to their readable dark legacy variant
for Watches and Memory, including when the app's global preference is Paper.
No Watch control, notification policy, recurrence or Calendar model was changed.
This is presentation over real data, not proof of physical phone delivery.

App explicitly distinguishes migrated Atelier surfaces from legacy dark ones.
On legacy pages the navigation's decorative radial scrim is omitted; the bar
and its opaque label ground still honour the selected look. Returning to an
Atelier page restores the scrim, without changing the look or remounting the
composer. This does not claim the older workspaces have been redesigned.
Memory's existing one-off reminder detail always wraps, including the full
phone-receipt caveat, across the row's full width. Receipt-bearing rows do not
dim their evidence after disabling; the switch and receipt words convey state.
Expanding the prompt is not needed to read it. Ordinary
watch-result truncation/expansion and all watch actions are unchanged.

`node web/src/schedule/verify-reminders.mjs <built-web> <built-server> <evidence-directory>`
uses real authenticated watch routes and disposable SQLite, with no scheduler or
push transport. It checks explicit create/confirmed delete, a lost create receipt,
database reopen/reload, stale and failed reads, empty state, responsive Ink/Paper,
keyboard/disclosure/forced-colours and legacy Watches/Memory hosts. Its acceptance
receipt is explicitly seeded test evidence, not a real notification. The existing
`reminders/verify-pause.mjs` separately checks persisted pause/expiry/resume copy.

Focused `design/metal/Atelier.test.tsx` covers variants, inert text, exact actions,
navigation focus/selection, capped Canvas2D, StrictMode cleanup, hidden/offscreen,
reduced-motion, forced-colours and unavailable-canvas behaviour. Existing Home,
Today, bar, chat and full web tests cover the preserved data/session behaviours.

Ideas capture, Notes Document/Links and Calendar Description associate their
visible static labels explicitly with the controlled textareas. Typed content
must not become part of a field's accessible name. Notes quick capture has a
natural destination-specific name (`Quick capture to <folder>`). Existing saves,
shortcuts, drafts and cancellation are unchanged. Browser checks re-query the
exact accessible names after filling the fields, in addition to unit coverage.

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
The integrated journey uses the actual App navigation through Home, Today, Talk,
Notes, Calendar, its Reminders subview and back, Ideas, Home and Talk. It keeps
the exact same unsent composer throughout. A labelled synthetic response-in-progress
SSE event exposes the existing busy-Talk voice control; entering Voice shows
“Draft kept”, and returning through Keyboard restores the exact chat and words.
No chat turn is sent. Reload intentionally loses the unsaved draft and opens Home;
Talk still resolves the remembered exact session. This does not simulate successful
speech or treat fixture content as a real AVA response. Separate route-backed
workspace harnesses test durable writes and reopen behaviour.
The journey also counts attached WebGL canvases and tracks buffer/program
allocation and deletion, including detached canvases. It expects one resource-owning
renderer on Home/Voice and none elsewhere. Native context garbage collection and
total GPU memory are outside this test; the renderer keeps its context during
effect cleanup so StrictMode can immediately reuse the same canvas.
An optional final numeric argument (bounded to 300 seconds) runs a Home motion
soak: JavaScript heap after explicit garbage collection and the live context
count. It does not measure total GPU/process memory.

Production build budgets and offline precache remain mandatory. Runtime
promotion is separate from a source commit. Consult the board for exact build,
commit, browser and release evidence. Claude has returned for independent exact
reviews; acceptance is recorded separately for each commit, never implied.
For the assembled everyday review and remaining boundaries, see
[Atelier everyday review](../design/atelier-everyday-review.md).
