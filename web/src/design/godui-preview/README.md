# Complete AVA metal interface demo

Open `http://127.0.0.1:5174/?godui-preview` with the AVA Vite server running.
This is an isolated, interactive design preview, not a production screen replacement.

## Joint proposal — start here

Open `?godui-preview#demo=proposal` (or **All AVA → Proposed design**). Codex and
Claude's composition is a single page of 17 selectable live studies: Home, Voice,
Today, Talk, Conversations, Notes, Calendar, Ideas, Memory, watches, Explore,
visuals, Activity, improvements, Settings, first hello, and a metal comparison.
Only the selected study mounts. Try the island's one-thing reveal, Ideas'
cover-flow/card-swap/list options, genuine shader versus CSS, the Paper material
sample, structural lines, and the sample task flow. The full layouts and all
original 21 component references remain a button away.

These are proposed compositions with clearly labelled samples, not implemented
production behavior. The Paper comparison is a material swatch, not a complete
light theme. Home/Voice studies can use a face plus one real shader (two WebGL
contexts when supported); this is a visible trade-off for discussion, not a
silent change to the live graphics contract. No provider/API action is enabled.
Home uses AVA's existing face asset/renderer, a forward-moving starfield, metallic
surfaces and a compact expanding composer. Voice exercises the real face's
idle/listening/thinking/speaking animation states without opening a microphone.
Home/Voice thoughts remain local to the mounted preview. The additional workspaces
persist their fixture edits in the browser's `ava:metal-demo:v1` localStorage key.
They never call AVA, send messages, start workers, request microphone/notification
permission, register devices or modify live data. Sample operational evidence is
explicitly labelled, not manufactured as a real run.

## Complete navigation and interaction coverage

Open **All AVA** in the top-right corner to reach every destination. The launcher
supports search, keyboard focus and Escape. `#demo=<destination>` persists the
selected screen across reload and supports browser Back. Home/Voice stay sparse.

Home/Voice now allocate the actual viewport height to header, face, controls and
composer. The face shrinks into the remaining space instead of imposing a 400px+
minimum that made the page scroll. Short landscape uses a side-by-side composition;
expanded input reserves space rather than covering the controls. Normal viewport
fit is browser-tested at 1440×900, 1366×650, 390×844, 320×568 and 844×390. Very
short/zoomed layouts may scroll for access; content is not clipped to pretend it fits.

| Destination | Demo interaction / production area inspected |
|---|---|
| Today | Check off focus items; resume exact sample conversation; open notes/time (`today/`) |
| Talk / Conversations | Local scripted replies, exact text, Markdown, copy, save to Notes, approval/steps examples, search/pin/delete/new threads (`chat/`, `orbit/`) |
| Notes | Nested folders, new/edit/move files, pin, delete/undo, derived reading pages, search and four-stage board (`notes/`) |
| Calendar | Month/week/agenda, select dates, create/edit/delete events and attendance intent (`calendar/`, `schedule/`) |
| Ideas | Shared note-backed board/list and stage selection (`ideas/`, `notes/`) |
| Memory | Mind/index/list, capture/correct/pin/review, source details, people, projects, playbooks and personality (`memory/`) |
| Reminders & watches | Filters, create/pause/resume/delete and honest no-delivery receipt (`watches/`, `schedule/`) |
| Explore AVA | Discover, capability map/detail, activity links and explicitly unchecked health (`explorer/`) |
| Visual explanations | Process/timeline/branching evidence examples, scenes, zoom, keyboard, captions, text fallback, SVG/PNG download and explicit Talk handoff (`visuals/`) |
| Activity | Run timeline, communications, evidence/correlation disclosure, JSON fixture export and local change log (`mission-control/`) |
| Self development | Worker preference, proposal, approval example and improvement journal (`self/`) |
| Settings | General/voice/notifications/rules/devices/dev-room/about, local preferences and demo-only reset (`settings/`, `rules/`) |
| Strategy Room | Sample discussion, brief/conclusion, local approval and exact new-chat handoff |
| Pair a device / Welcome | Clearly illustrative six-digit pairing and three-step onboarding |
| Home / Voice / Components | Large live particle face, stars, compact composer and all 21 supplied references |

This is a visual/interaction replica of the major user-facing surfaces, **not every
production backend behavior**. No live provider, source verification, recurrence,
worker execution or external connection is simulated as successful. The Calendar
is a fuller proposed event workspace; live navigation currently uses Schedule's
reminder surface. The memory globe is a selectable 2D context study, not the live
3D brain. Voice state controls are animation demonstrations, not real listening.
Conversation responses are visibly scripted. Room discussion/approval state and
unsent Talk drafts are visit-local; durable demo records survive reload. Settings
describe preview preferences, not operational provider configuration. OS reduced
motion remains authoritative. Local storage is versioned, size/shape-checked and
falls back to fresh fixtures for malformed data; it is not a production database.

`demo-model.ts` owns fixtures/local data, `DemoPrimitives.tsx` owns accessible
controls/dialogs, and `DemoWorkspace.tsx` is a lazy route boundary over the four
workspace modules. Styles stay in the existing preview stylesheet so both Vite
and the managed fallback include them. No application route/API/schema changed.

The quieter revision removes life cards, the clock and explanatory captions from
Home/Voice. The portrait fills most of the viewport; voice state examples are
collapsed behind Preview states. Stars increase from 460 to 1,000. LivingFace is
a preview-only adapter over the shared asset, animator, renderer and single-face
slot: individual dot drift and cadence are amplified, without changing production
face code. Reduced motion still renders one static frame; hidden/offscreen draws
pause, observers/buffers are disposed and rendering failures show FaceStill.

## All references

The Components destination contains 21 selectable demonstrations. Only the selected
demonstration mounts, to avoid running every animation/WebGL context simultaneously.

| Reference | Source |
| --- | --- |
| WarpStarfield | `vendor/warp-starfield` |
| BeamDraw | `vendor/beam-draw` |
| ScrollTimeline | `vendor/scroll-timeline` |
| AnimatedBeam (two nodes and dotted pipeline) | `vendor/animated-beam` |
| AgentFlow | `vendor/agent-flow` |
| ElasticText | `vendor/elastic-text`, `vendor/lib/text-utils.ts` |
| TiltCard | `vendor/tilt-card` |
| Stepper | `vendor/stepper` |
| SplitFlapDisplay clock | `vendor/split-flap-display` |
| ProgressiveCardReveal | `vendor/progressive-card-reveal` |
| ImageAccordion | `vendor/image-accordion` |
| CoverFlow | `vendor/cover-flow` |
| CardSwap | `vendor/card-swap` |
| BentoGrid + BentoCard | `vendor/bento-grid` |
| DynamicIsland | `vendor/dynamic-island` |
| Breadcrumbs | `vendor/breadcrumbs` |
| JellyButton | `vendor/jelly-button` |
| GooeyFab | `vendor/gooey-fab` |
| LiquidMetalButton | `LiquidMetalButton.tsx`, Paper's actual liquid-metal shader |
| GradientWave | `GradientWave.tsx`, adapted supplied simplex-noise WebGL wave |

GodUI implementations were retrieved on 2026-09-25 from
`https://godui.design/r/<component-name>.json`, source project
<https://github.com/LucasBassetti/godui>. MIT license retained in `vendor/LICENSE`.
Local adaptations: `framer-motion` imports use AVA's installed `motion/react`;
the text helper is local; indexed access/observer entries are guarded for AVA's
strict TypeScript settings. The split-flap registry keyframes are included in CSS.

The supplied snippets were usage examples, not the component implementations.
Missing `Node`, `Cover` and `steps` helpers are filled with local examples. The four
`/photos/*.jpg` images were not supplied: those slots explicitly use original local
SVG landscapes. Sample marketing claims in the catalog are not claims about AVA.
The clock uses Europe/Dublin. Theme colours follow the requested metal direction.

Paper shaders are pinned at `@paper-design/shaders@0.0.81`. The supplied liquid-metal
uniforms, dimensions, hover speed and ripple are retained; required current API
uniforms, `dispose()` cleanup, keyboard-centred ripples, readable labels and reduced
motion are added. No CDN/runtime dependency is required.

The supplied GradientWave's simplex-noise layering/deformation is preserved in a
typed implementation. Fixes include six-colour support (the supplied vec4 indexed
six colours), setting uniform values rather than replacing uniform objects,
container resizing, GLSL float literals, observer/animation/buffer cleanup and a
static fallback. It uses a bounded mesh instead of unbounded window-sized topology.

## Verification

```powershell
npm test -w web -- src/design/godui-preview
npm test -w web -- --maxWorkers=2 --minWorkers=1
npx tsc -p web/tsconfig.json --noEmit --incremental false
npm exec -w web -- vite build --outDir ../data/builds/metal-proposal
node web/src/design/godui-preview/verify-browser.mjs data/builds/metal-proposal
```

The browser verifier serves built assets on a temporary loopback port, checks all
21 demonstrations, every workspace at desktop/phone widths, local file persistence,
delete/undo, SVG/PNG downloads, history/focus, real shader success/motion, draft handoff,
scrollability, all 17 proposal studies at 1440/390/320px, material/Ideas/island
interactions, reduced-motion stars, no API writes and console/page errors. It saves
screenshots under the OS temp directory and closes its server/browser afterward.
Do not rebuild the tested output concurrently with this check. Use an isolated
outDir: the running AVA server serves `web/dist` from disk, so a canonical build
there would also change the live bundle. The optional verifier argument selects
the build directory without changing the live server or production configuration.

WebGL appearance depends on the GPU. This preview does not alter face topology,
real speech, navigation/history or production voice behavior. Review this direction
with Niko before promoting it into the application.
