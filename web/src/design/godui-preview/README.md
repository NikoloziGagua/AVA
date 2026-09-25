# Metal Home + Voice concept lab

Open `http://127.0.0.1:5174/?godui-preview` with the AVA Vite server running.
This is an isolated, interactive design preview, not a production screen replacement.
Home uses AVA's existing face asset/renderer, a forward-moving starfield, metallic
surfaces and a compact expanding composer. Voice exercises the real face's
idle/listening/thinking/speaking animation states without opening a microphone.
Typed thoughts, sample day/notes/ideas and button actions remain local to this page;
they do not call AVA, persist data, send messages or claim real schedule state.

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
npm test -w web -- src/design/godui-preview/GodUiPreview.test.tsx
npm test -w web -- --maxWorkers=2 --minWorkers=1
npm run build -w web
node web/src/design/godui-preview/verify-browser.mjs
npm run build:managed -w web
```

The browser verifier serves built assets on a temporary loopback port, checks all
21 demonstrations, real shader success/motion, desktop/phone layouts, draft handoff,
scrollability, reduced-motion stars, no API writes and console/page errors. It saves
screenshots under the OS temp directory and closes its server/browser afterward.
Do not run a build concurrently with this check: builds replace `web/dist`.

WebGL appearance depends on the GPU. This preview does not alter face topology,
real speech, navigation/history or production voice behavior. Review this direction
with Niko before promoting it into the application.
