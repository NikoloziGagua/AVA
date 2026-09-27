# Atelier — everyday release review

This is the assembled **production-code candidate**, not the original preview.
Source commits and independent acceptance are recorded in `coord/BOARD.md`.
Building or accepting this candidate does not promote it to the running AVA.
Runtime promotion remains a separate decision with Niko.

## What to try

1. **Home:** large face, forward stars, quiet Nocturne ground, real priorities.
   The bottom message pill expands when focused or when it contains words.
2. **Today → Talk:** Silver Silk overview and quiet conversation. Type an unsent
   draft and move among destinations; it stays in the same mounted composer.
3. **Notes:** dark-default folder library, named files and a readable document
   plane. On a narrow screen, move library → files → reader and use its Back
   controls. Editing retains the whole source, not only its displayed page.
4. **Calendar:** Month, Week and Day, selected-day agenda, open event editor,
   attendance intention and outcome. Use Reminders for standalone notifications;
   they are not represented as calendar events or linked alerts.
5. **Ideas:** explicit capture and Twin-plane cards. Open a card to its exact
   Notes file. Read failures can be retried without replaying a write.
6. **Reminders:** open essential fields and full delivery caveats. “Accepted”
   means accepted by the notification service, not proof the phone displayed it.
7. **Voice:** larger face and metal controls; Keyboard returns to the shared
   conversation. An existing unsent draft is visibly marked “Draft kept”.

Ink remains the default; an explicitly selected Paper look remains respected.
Older advanced workspaces are still dark legacy screens, without the Paper
navigation glow. They have not all been redesigned.

## Reproducible integrated gate

Use a clean archive of **one commit**, with both root and web workspace dependency
directories available. The client build must resolve web's Vite 7, not silently
substitute root's PWA-worker Vite 5. Build into an isolated tree, never over the
live assets during review. Preserve the canonical output before the managed build.

```text
npm -w web test -- --maxWorkers=4 --minWorkers=1
npm -w server test -- --maxWorkers=4 --minWorkers=1
node node_modules/typescript/bin/tsc -b web/tsconfig.json --pretty false
npm -w web run build
npm -w web run build:managed
npm -w server run build
git diff --check
```

Run each browser harness against **both** outputs and the same built server,
with separate ignored evidence directories:

| Harness (`web/src/`) | Authority and purpose |
| --- | --- |
| `calendar/verify-calendar.mjs` | Real authenticated routes, disposable SQLite; event/attendance/edit semantics and responsive editor |
| `notes/verify-atelier-notes.mjs` | Real Notes routes; full document, pagination, editing, stale versions and persistence |
| `ideas/verify-ideas.mjs` | Real Notes routes; filtered retrieval, explicit/uncertain saves, exact-file handoff and source changes |
| `schedule/verify-reminders.mjs` | Real watch routes, no scheduler; explicit saves/deletes, uncertainty, receipt layouts and legacy contrast |
| `reminders/verify-pause.mjs` | Real persisted reminder state; pause, expiry and resume copy |
| `design/metal/verify-atelier.mjs` | Read-only browser fixtures; complete App journey, same draft, exact chat, Voice failure, pixels/context bounds |

The first five take `<web-output> <server-dist> <evidence-directory>`.
The final harness takes `<web-output> <evidence-directory> [soak-seconds]`.
It exercises Ink/Paper at 1440, 390 and 320 pixels; it checks reduced motion,
forced colours, keyboard focus, no unintended writes and browser errors. The
Ink/390 journey also makes twenty Home → Notes → Home round trips, checks the
same buffer/program baseline each time and rejects context-limit warnings.
The test uses weak canvas references so its own instrumentation does not prevent
native context collection. This stress check does not force garbage collection.
The
optional soak is capped at 300 seconds. Keep screenshots for human visual review,
not only numerical assertions. None of these harnesses use Niko's accounts or
the live database. No physical microphone, paid model or push recipient is used.

Then boot the exact committed server with an empty isolated data directory,
no external credentials, matching build identity, successful shell response and
authenticated-route rejection. `ready: false` is expected without credentials;
health alone is not workflow acceptance. Stop only that fixture process.

Claude reviews the same exact commit independently. A subsequent product fix
invalidates acceptance for affected scope; rerun and obtain another sign-off.
Record commands, results, warnings, exact build/commit identity and limitations
at the board's physical EOF with the repository writer.

## Deliberate boundaries

- Workspace navigation is still App state, not a new browser-history router.
  Reload opens Home; Talk retains the remembered exact human session. Unsaved
  drafts are retained while the App is mounted, **not across reload**.
- Desktop Edge at phone dimensions is not a physical iPhone performance,
  microphone, audio, notification or lock-screen acceptance test.
- Notes/Ideas remain bounded snapshots, with honest partial notices; this is
  not global pagination. An uncertain save is not automatically retried.
- Calendar-linked notifications remain unavailable. Reminder service acceptance
  is distinct from device receipt; there is no claim of exactly-once display.
- Motion respects Reduced, hidden/offscreen and forced-colour policies. The face
  is the sole WebGL renderer; backgrounds use bounded Canvas2D. The Home JavaScript
  heap soak is not a GPU/process-memory measurement. Journey checks track live
  buffer/program ownership, including detached canvases, not native context GC.
- Canonical eager/chunk and PWA-precache guards stay enforced. The managed build's
  intentionally large single-file advisory is retained, not suppressed.
- No redesign of every advanced workspace, new provider integration, backend
  scheduling policy or automatic release is bundled into this review.
