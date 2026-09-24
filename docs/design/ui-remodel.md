# AVA UI remodel: "Ink and Paper" (v2, 2026-09-25)

Owner of this document: Claude (UI) with Codex (review, server, screens it owns).
Status: v2 incorporates Codex's review (#581) and Niko's answers. **Niko approved the plan on
2026-09-25** ("i aproove your ideas"). Binding decisions are in the agentroom contract `ui-remodel`.

## 0. What Niko decided (as of 2026-09-25)

| Topic | Decision | Source |
|---|---|---|
| Overall look | Premium, calm, readable. Inspired by Armory (restraint, big type), Fourmula (menu pill that grows), Avalon (glass buttons), Epiminds (particle face) | chat 2026-09-24 |
| Theme | **Black ("Ink") is the default. White ("Paper") is an option** in Settings, built from the same tokens | "black final whie option" |
| Separators | **No lines between things.** Use space, grouping and floating surfaces | "i dont like just the lines seperating" |
| Home | **Nearly empty**: face, greeting, one thing for today, a few suggestions, the bar | "main page to feel little more empty" |
| Navigation | **Menu pill at the bottom**, growing into the full menu | "menu pill on the bottom" |
| Face | AVA's face is Niko's AI portrait as a moving particle face: glowing dots in Ink, pen engraving in Paper | study 2.1 |
| Face realism | Blinking and talking are not convincing yet ("her face splits apart"). Fix later | 2026-09-25 |
| Scope | **Everything**, every screen and component, in one planned remodel | 2026-09-25 |
| Memory 3D brain | **Keep it**, as an optional tab under the one-canvas rule | "keep tje 3d nraom" |
| Home and Today | **Separate**: nearly empty Home plus a Today agenda | "home and today seperate" |
| Desktop navigation | **Bottom bar only**, no side rail | "bottom bar enough" |
| Mini face | **Yes**, the tiny face shows in the bar on every screen | "tiny face is a good idea" |

Reference mockups: study 1 (black vs white), study 2.1 (face, empty home, floating cards).

## 1. Why the current UI fails (measured)

- 488 text uses at 10px or smaller and 337 very faint text colours (white/20 to /40).
- 149 hard-coded hex colours in screens; `theme.css` (1,398 lines) owns only part of the look.
- Every `PanelShell` screen (19) runs a full-screen WebGL `NeuralField`; glass panels blur on
  top of it, so the blur is recomputed every frame. Three animation stacks (GSAP, Motion, three.js)
  with no shared timing.
- A glowing bordered box around almost everything, which flattens the hierarchy.

## 2. Principles and hard budgets

1. **Readable first.** No text below 12px. Body 15px. Secondary text at least 4.5:1 contrast.
2. **One live canvas.** At most one WebGL context on screen (the face, or one explicit visual). Page
   backgrounds are static.
3. **Cheap motion only.** Animate transform, opacity, clip-path and filter. One spring
   vocabulary (below). Respect reduced motion everywhere.
4. **Blur only when still.** `backdrop-filter` only on resting elements, at most two on screen, and
   never over moving content.
5. **No separator lines.** Hierarchy comes from space, grouping, surface and type. A hairline is
   allowed only inside data tables and code.
6. **Tokens only.** No raw colours, font sizes or shadows in screen code. Enforced by a test.
7. **Phone first.** Designed at 390px, then scaled up to 1440px.
8. **Truthful states.** Every screen has designed loading, empty, error, offline and conflict states.

Automated gates (new test file `web/src/design/design-guard.test.ts`):
- scans TS, TSX and CSS for text under 12px (`text-[8px]` to `text-[11px]`, or font-size under
  12px), raw `#hex`/`rgb(`/`hsl(` colours outside `web/src/design/`, and `backdrop-filter` on
  animated components;
- **ratchet, not a blanket switch:** zero violations are allowed in `web/src/design/**` and in every
  screen already migrated. Legacy screens are grandfathered through a committed baseline count per
  file, which can only go down. Accessibility-critical and status colours are never blanket-excluded;
  they move into tokens;
- fallbacks are required: without View Transitions, navigation swaps instantly; without
  `backdrop-filter`, a solid `--surface-strong` is used;
- performance budgets, checked in a Playwright run on the built bundle:
  - eager JS stays within the current 900 KB, and the face chunk is lazy;
  - LCP under 2.0 s on desktop and under 2.8 s on a mid phone profile;
  - interaction to next paint under 150 ms;
  - one WebGL context at most;
  - face GPU buffers under 8 MB, and JS heap growth under 30 MB after 5 minutes on Home.

## 3. Design tokens (`web/src/design/tokens.css`, replaces the colour part of `theme.css`)

Themes are data attributes on `<html>`: `data-look="ink"` or `data-look="paper"`. The preference
(section 9) is `ink` (default), `paper` or `system`. `system` follows the OS only when explicitly
chosen. The last accepted value is mirrored locally so the first paint never flashes the wrong look.

### Colour roles
| Token | Paper (option) | Ink (default) |
|---|---|---|
| `--bg` | #F4F4F1 | #050506 |
| `--bg-raised` | #FFFFFF | #0E0E10 |
| `--surface` | rgba(255,255,255,.78) | rgba(255,255,255,.055) |
| `--surface-strong` | #FFFFFF | rgba(255,255,255,.09) |
| `--text` | #0B0B0C | #F4F4F5 |
| `--text-2` | rgba(11,11,12,.68) | rgba(244,244,245,.72) |
| `--text-3` (min) | rgba(11,11,12,.56) | rgba(244,244,245,.56) |
| `--solid` / `--on-solid` | #0B0B0C / #F4F4F1 | #F4F4F5 / #050506 |
| `--glass-bg` | rgba(255,255,255,.66) | rgba(255,255,255,.07) |
| `--glass-edge` | rgba(0,0,0,.07) | rgba(255,255,255,.16) |
| `--glass-hi` (top highlight) | rgba(255,255,255,.95) | rgba(255,255,255,.26) |
| `--shadow-color` | rgba(25,25,45,.12) | rgba(0,0,0,.6) |
| `--focus` | #0B0B0C | #F4F4F5 |
| `--success` / `--warning` / `--danger` / `--info` | #1F7A4D / #9A6700 / #B42318 / #1F5FBF | #5FD39A / #E8B04B / #FF7A6B / #7FB2FF |

No brand accent colour: the solid ink/paper pair is the accent. Semantic colours only for status.

### Type (Geist and Geist Mono, self-hosted woff2 in `web/public/fonts/`, so it works offline)
| Token | Size/line | Use |
|---|---|---|
| `--t-display` | 40/1.02, 600, -0.035em | Home greeting on desktop |
| `--t-title` | 30/1.08, 600, -0.03em | Screen titles |
| `--t-heading` | 20/1.2, 600, -0.02em | Section headings |
| `--t-body-lg` | 17/1.4, 500 | Card titles |
| `--t-body` | 15/1.55, 400 | Body, messages |
| `--t-meta` | 13/1.4, 400 | Metadata |
| `--t-label` | 12/1, 500 mono, +0.12em, uppercase | Group labels, tags |

### Space, radius, elevation, motion
- Space: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72.
- Radius: `--r-sm` 10 (small controls), `--r-md` 14 (buttons), `--r-lg` 22 (cards), `--r-xl` 30 (sheets, bar), `--r-full` pills.
- Elevation (shadows, never borders): `--e1` controls, `--e2` cards, `--e3` bar and sheets. Each is an
  outer soft shadow plus the inset `--glass-hi` top highlight.
- Motion: durations 150 / 240 / 400 ms; easing `cubic-bezier(.22,1,.36,1)`; Motion springs
  `snappy` (stiffness 420, damping 34), `gentle` (170, 26), `bouncy` (300, 18, menus only).
  Screen changes use the View Transitions API with a 380 ms cross-fade and slide.

## 4. Component library (`web/src/design/`), owned by Claude and reviewed by Codex

Every screen is built only from these. Each ships with tests, both looks, 390 and 1440, and reduced motion.

| Component | Replaces | Notes |
|---|---|---|
| `AppFrame` | `PanelShell`, `AppSidebar`, all background effects | Page padding, max width, static background, safe areas |
| `BottomBar` | Sidebar, `Composer` placement, `CommandBar` | Conversation bar (orb, input, talk button) that grows into the menu. Menu holds destinations and recent chats. Ctrl+K opens it on desktop |
| `StatusIsland` | Header chips, `ThinkingIndicator` | Shows what AVA is doing: listening, thinking, speaking (with voice bars), working on a task, reminder due |
| `Face` | `Orb`, `MagicRings`, `NeuralField` on Home and Voice | One WebGL face (section 6), mounted once and moved between placements. Ink look: glowing dots; Paper look: engraving. The bar's mini face is a static image, not WebGL |
| `Page` / `PageHeader` | Screen headers | Title, optional subtitle, actions |
| `Surface` / `Card` | `BorderGlow`, bordered boxes | Floating, shadow-elevated, no border |
| `FloatingStack` | Lists of reminders and notifications | Stacked cards that fan out |
| `Tile` / `TileGrid` | Folder and space buttons | Two columns on phone |
| `Row` | Hairline lists | Spacing-separated row with leading, title, meta and trailing parts |
| `Button` | `components/ui/button` | Variants: `solid` (one per screen, shimmer allowed), `glass`, `quiet`, `danger` |
| `Chip` / `SuggestionChips` | Pills, tags | Suggestions, filters, status |
| `Segmented` | `SegmentedTabs` | Glass track with a sliding thumb |
| `Field`, `TextArea`, `Select`, `Switch`, `WhenField` restyle | Ad-hoc inputs | One style |
| `Sheet` | `Dialog` on phones | Bottom sheet on phone, centred dialog on desktop |
| `Toast` | Inline notices | Short and honest, with an undo where it applies |
| `EmptyState`, `Skeleton`, `ErrorState`, `OfflineBanner` | Ad-hoc states | Required on every screen |
| `Tag`, `Badge`, `NumberTicker`, `ProgressRing` | `badge` | |
| `Markdown` | `AssistantMarkdown` styling | New type scale; code blocks get their own surface |
| `Receipt` | `TaskReceiptCard`, `SavedItemsCard`, `RoomPostReceipt`, `MemoryContextCapsule`, `ToolCallChip` | One receipt family: icon, what happened, proof, action |
| `ApprovalSheet` | `ApprovalCard` | Risky-action approvals as a clear sheet |

Motion helpers: `web/src/design/motion.ts` (springs, `useReducedMotion`, view-transition navigate).
GSAP is removed from the UI (`lib/gsap.ts`, `deckMotion.ts`); Motion stays.

## 5. App shell and navigation

- The **left sidebar is removed** at every width. `BottomBar` floats bottom-centre, full width on
  phone and max 720px on desktop.
- The menu (grown from the bar) contains:
  - Primary destinations: Home, Today, Talk, Notes, Calendar, Ideas.
  - System destinations: Memory, Reminders and watches, Explore AVA, Visual explanations, Activity (Mission Control; optional pop-out), Self development, Settings.
  - Up to 5 recent conversations, plus "All conversations".
- Keyboard: Ctrl/Cmd+K opens the menu; Esc closes it; arrow keys move through it.
- Routing stays in `App.tsx` view state. Every view change goes through `navigate()` with a view transition.
- The `StatusIsland` sits at the top of Home, Talk and Voice. Other screens show the mini face in the bar.

## 6. The face (`web/src/design/face/`)

- Asset pipeline (Codex): a pinned offline developer script `server/scripts/face/build-face-assets.mjs`.
  - The source portrait is private developer input. It is never served, bundled or committed. It
    is AI-generated and not a real person.
  - The script runs MediaPipe face landmarks (478 points), Depth Anything v2 small (calibrated to
    the landmarks) and weighted Voronoi stippling (60k points), **only at build time**. No model is
    downloaded or run in the app.
  - Output: one bounded derived binary, schema-versioned (at most 1 MB), plus a manifest (schema,
    version, SHA-256, point count, licences). Both are written as a hashed static file in
    `web/public/face/` and precached by the service worker, so the face works installed and offline.
    There is no runtime API endpoint.
  - Licences are recorded in the manifest and `docs/design/licences.md`: MediaPipe (Apache-2.0),
    Depth Anything v2 small (Apache-2.0), Geist and Geist Mono (SIL OFL 1.1).
- **One canvas.** A single `FaceStage` owns the only WebGL context and moves (portal and FLIP morph)
  between placements: hero on Home and Voice, medium elsewhere if a screen asks for it. Everywhere
  else, including the bar's mini face, a static pre-rendered image is used. Memory's 3D brain tab
  takes the one context only while it is open, and the face pauses and releases it.
- Failure path: if the face chunk or WebGL fails, the static image is shown and nothing else changes.
- Renderer (Claude): one WebGL program. Point attributes are position, depth, tone and region weights
  (lids, iris, jaw, lip, brow, smile, head). The same animation state serves every size. Paper uses
  ink stipple; Ink uses glow.
- Motion model: idle blink and saccades, pointer gaze and head turn, and listening, thinking and
  speaking poses.
- **Known defect, deferred to phase F:** speech and blink tear the dot field ("her face splits
  apart"). The fix is a smooth deformation field from landmark handles (radial-basis warp instead of
  per-region offsets), a dark inner-mouth fill so an open mouth reads as a mouth, eyelid dots that
  slide over the eye instead of collapsing, and mouth motion from real voice energy smoothed into
  visemes.
- Live signal (Codex): a disjoint `web/src/voice/faceSignal.ts` external store (with tests)
  publishes AVA's output level and, while listening, the input level. `useRealtimeVoice` and
  `useLiveVoice` feed it. The face and island subscribe to it. Claude alone edits `VoiceScreen`.
- Budget: 60k points desktop, 42k phone, paused off-screen and on hidden tabs; static frame with
  reduced motion; fallback image when WebGL is unavailable.

## 7. Every screen

Each row is a unit of work: rebuilt on the new components, keeping current behaviour and tests.

| Area | Current files | New design | Owner |
|---|---|---|---|
| Splash | `splash/Splash.tsx`, `NebulaBackground` | Dots gather into the face, then Home. Once per install, skippable | Claude |
| Pairing | `auth/PairingScreen.tsx` | Calm centred card with the face, pairing code field | Claude |
| Home (new landing) | `today/TodayScreen.tsx` (landing part) | Face hero, greeting, **one thing** for today, 3 suggestions, bar. The one thing follows a fixed, truthful ranking over existing data, with no new inference: (1) the next calendar event today that hasn't started, (2) else a reminder due in the next 24 h, (3) else the most recently updated pinned note, (4) else "Nothing planned for today". Suggestions are fixed prompts tied to that item | Claude |
| Today | `today/TodayScreen.tsx` | Agenda of floating cards (lectures with Attend/Skip, blocks, reminders stack). Becomes the Calendar day view once C2 lands | Claude |
| Talk: conversation | `chat/*` (ChatScreen, MessageList, Composer, MessageActions, ActivityPanel, ThinkingIndicator, AssistantMarkdown, ToolCallChip, receipts) | Messages without bubbles for AVA (Markdown on paper), soft bubbles for Niko. Tool activity folds into the island and receipts. Composer is the `BottomBar` | Claude |
| Talk: list | `orbit/ChatListScreen.tsx` | Floating rows grouped by day, pinned first, search | Claude |
| Voice | `voice/VoiceScreen.tsx`, `HoldToTalkButton`, `VoiceExactTextDialog` | Full-screen face, island, live captions, hold-to-talk in the bar | Claude (all voice UI files); Codex supplies `voice/faceSignal.ts` only |
| Notes | `notes/*` (N3 by Codex) | Tile grid of folders, file cards, engraved reading pages. Restyle only, behaviour per notes-hierarchy v4 | Codex |
| Calendar (new, C2/C3) | none yet | Day and week built on the new system, attendance intent and outcome, reminders | Claude (UI) on Codex C1 |
| Schedule | `schedule/ScheduleScreen.tsx` | Merged into Calendar per calendar-events v2 ("Schedule labelled Calendar") | Claude |
| Reminders and watches | `watches/WatchesScreen.tsx`, `reminders/*`, `memory/WatchesSection.tsx` | One "Reminders" screen: upcoming stack, watches as tiles, restyled `WhenField` | Codex |
| Ideas | `ideas/IdeasScreen.tsx` | Masonry of idea cards, quick capture | Claude |
| Memory | `memory/*`, `MemoryBrain.tsx` | Sections as segmented tabs (About Niko, People, Playbooks, Index, **Map**). The 3D brain is kept as the lazy Map tab and takes the single WebGL context while open | Codex |
| Explore AVA | `explorer/*`, `capabilities/*` | Discover as tiles, the atlas and workflow map on paper, health as status cards. Registry content unchanged | Codex |
| Visual explanations | `visuals/*` | Viewer on paper; canvases keep their own layout | Codex |
| Settings and rules | `rules/*` incl. `DevRoomSection` | Grouped settings on floating surfaces: Look (Paper/Ink), Motion, Voice, Dev room, rules | Claude |
| Self development | `self/*` incl. transparency pilot | Journal as cards, pilot views on the new tables | Codex |
| Activity (Mission Control) | `mission-control/MissionControlScreen.tsx` | Available inside AVA as a normal screen, with an optional pop-out window. Dense but readable: 13px minimum here, status cards | Codex |
| Approvals | `approvals/*` | `ApprovalSheet` | Claude |
| Retired | `strategy/*` | Stays dormant, unregistered and unreachable, as `ava-room-member` v3 requires. No restyle and no deletion | nobody |
| Global states | many | Offline banner; service-worker update available, apply and recovery; auth expired and re-pair; server unreachable | Claude |
| Push | `push/register.ts`, reminder receipts | Permission and subscription flow in Settings. Receipts say truthfully whether a push was accepted by the push service or actually shown | Claude (UI) + Codex (receipt truth) |
| PWA | `vite.config.ts` manifest, icons | theme and background colours per look, new icon (engraved face) | Codex |

## 8. Removed at the end (phase G)

`NeuralField`, `DottedSurface`, `NebulaBackground`, `FlowingLines`, `MagicRings`, `PathsBackground`,
`BorderGlow`, `ShiningText`, `ContainerScroll`, `GlassFilter`, `EdgeFade` (if unused), `PanelShell`,
`AppSidebar`, `Orb` (replaced by the mini face), GSAP and `@gsap/react`. three.js **stays** for
Memory's 3D Map tab (lazy chunk only). The old colour and HUD rules in `theme.css` are removed as
each screen moves. Explorer registry source references and `verified-manifest.json` are updated in
the same commits. The Strategy Room source is **not** deleted (see section 7).

## 9. Server work (Codex)

- UI preferences: one authenticated singleton row.
  - Shape: `{ look: "ink"|"paper"|"system", motion: "full"|"reduced"|"system", faceEnabled: boolean, version, updatedAt }`.
  - Defaults: `ink`, `system`, `true`.
  - `GET /api/ui/preferences`, plus a version-guarded `PATCH` (returns 409 `stale_version` with the
    current row).
  - SQLite is the authority after auth. The client mirrors the last accepted value locally only to
    avoid a first-paint flash and offline drift.
  - Migrates the existing local `ava-motion` choice once.
  - Tests: stale writes, invalid enums, restart, offline cached state, migration.
  - **Sequenced after Codex's current C1 calendar schema commit, and before phase A sign-off**, so
    the two never interleave edits to `schema.sql`, `db.ts` or `index.ts`.
- Face asset build script (section 6). No runtime face endpoint.
- `voice/faceSignal.ts` level store (section 6).
- No other API changes; screens keep their current endpoints.

## 10. Phases (each ends in an exact-commit dual review and a deploy)

| Phase | Content | Owner |
|---|---|---|
| A. Foundation | Tokens, fonts, design guard test, motion helpers, component library, UI preferences API | Claude (web), Codex (API + guard review) |
| B. Shell | `BottomBar` with menu and recents, `StatusIsland`, view transitions, sidebar removed | Claude |
| C. Home and face | Home, `FaceStage`/`Face` component, offline face asset pipeline (static hashed asset) | Claude (UI), Codex (pipeline) |
| D. Talk and voice | Conversation, list, voice with live levels, receipts, approvals | Claude (UI), Codex (voice wiring) |
| E. Everything else | Notes, reminders, memory, explore, visuals, self, mission control (Codex); Today, ideas, settings, pairing, splash, calendar (Claude) | both, in parallel on disjoint paths |
| F. Face realism | Deformation-field talking and blinking, inner mouth, visemes | Claude |
| G. Cleanup | Delete retired components and dependencies, perf and a11y audit, docs, final deploy | both |

Order: A and B must land, dual-reviewed, before any screen work. C, D and E then run in parallel.
Codex's C1 calendar backend continues in parallel with phase A. Calendar UI waits for C1 and the new components.

### Ownership of shared files
| File | Owner | Rule |
|---|---|---|
| `web/src/App.tsx` | Claude | Shell and routing. Codex requests a route change by message |
| `web/vite.config.ts`, `web/src/sw.ts` | Codex | PWA manifest, precache (fonts, face asset) and update flow. Claude requests entries by message |
| `web/src/api.ts` | shared, leased per task | Each task adds only its own types and functions, leased by path for its duration |
| `web/src/theme.css`, `web/src/design/**` | Claude | Tokens and components. Codex screens consume them and request additions |
| `docs/design/ui-remodel.md` | Claude | Changes follow contract amendments |

## 11. Acceptance for every unit

- Both looks at 390 and 1440 (Playwright screenshots attached to the review).
- Design guard passes; no horizontal overflow; keyboard and screen-reader paths.
- Reduced motion works; at most one WebGL context; blur only on resting elements.
- All existing tests pass (or are updated with the reason stated).
- Loading, empty, error and offline states shown.
- Phone realities: virtual keyboard never covers the input; safe areas; installed standalone mode;
  landscape; 200% zoom; forced-colours mode.
- The `BottomBar` draft and the conversation session survive menu expansion and route changes: no
  remount, no lost draft, no duplicate send.
- Recents in the menu list human conversations only (I1 `scope=human` rules).
- Face lazy-load failure shows the static fallback.
- Both agents attach evidence to every exact-commit review.

## 12. Niko's answers (2026-09-25)

1. Default look: **black (Ink)**; white (Paper) is an option.
2. Memory 3D brain: **keep**, as the Map tab.
3. Home and Today: **separate**.
4. Desktop: **bottom bar only**.
5. Mini face in the bar on every screen: **yes**.
