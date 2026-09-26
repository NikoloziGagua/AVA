# Niko's interface references — joint design inventory

2026-09-26. Prepared for room request #742 and the agreed split #744/#746.
This is an inventory and placement proposal, **not approval to integrate**.
The original examples remain available; a placement below is not a decision to
discard the rest. Niko wants to judge a composed, moving interface first.

## Open the existing work

- Complete metal preview: `http://127.0.0.1:8787/?godui-preview` in the currently
  served build. **All AVA → Components** contains every one of the 21 examples
  below. **All AVA** also opens the 19-destination interface demo.
- Source: `web/src/design/godui-preview/`. `3a843ad` combines the full workspace
  demo with `c78f9e6`'s sparse Home/Voice and `7776e2d`'s actual component catalog.
  `7ae3694` is the earlier lab, not the most complete version.
- `f050ae4` contains a production plan and an **unmounted** starfield candidate;
  it does not represent live integration of the metal interface.
- Earlier motion research: [five-experiment lab](previews/frontier-ui-lab/index.html)
  and [research v2](../research/frontier-ui-2026-09-25.md). These are separate from
  the GodUI catalog; they were not all put on the Home page.
- An independent research preview also exists at
  `docs/design/previews/ava-frontier-independent/index.html`, with its report at
  `docs/research/ava-frontier-independent-2026-09-25.md`. Those are unrelated,
  untracked work; this task neither changes nor claims that work.

## Every supplied component in the available conversation

All rows are implemented demonstrations in `ReferenceCatalog.tsx`. GodUI sources
are under `vendor/` with the MIT notice. The first two are the supplied shader
examples, adapted for cleanup, correct uniforms, keyboard use and reduced motion.
The small React snippets were usage examples, not the full underlying components.

| Component / variation | What actually moves or responds | Proposed AVA placement to demonstrate |
|---|---|---|
| LiquidMetalButton | Real Paper liquid-metal shader, hover acceleration, press and ripple | Signature Talk/voice action; compare **actual shader** against CSS controls visibly |
| GradientWave | Supplied layered simplex-noise WebGL waves | Optional atmosphere/material study; show separately from stars, not stack everything |
| WarpStarfield | Forward depth motion, speed/warp and pointer parallax | Home/Voice spacious background |
| BeamDraw | Scroll-driven paths from a core into four branches | Expandable capability/workflow explanation, not scroll on Home |
| ScrollTimeline | A narrative unfolds along a scroll-linked timeline | Improvement journal/history or a research story |
| AnimatedBeam | Moving connection between two real DOM anchors | Selected relationship or active handoff in Activity |
| AnimatedBeam · dotted pipeline | Staggered packets across three connection stages | Task stages or system request path; illustrative until driven by real evidence |
| AgentFlow | Progressive branching execution graph | Expanded task/workflow explanation with real evidence in a future integration |
| ElasticText | Pointer-responsive spring letters | Short welcome/title or an occasional expressive word; never animate every reply |
| TiltCard | Pointer tilt, depth and tracking glare | Selectable idea/research cards; keyboard retains the same content |
| Stepper | Explicit current/completed/next progress | Onboarding or a bounded multi-step task, not fake progress |
| SplitFlapDisplay | Mechanical digit flips with clock-specific reels | Dublin clock on Today or a focused time panel, not clutter on sparse Home |
| ProgressiveCardReveal | Collapsed rows expand into focused details | Today's next event/task or source/brief details |
| ImageAccordion | Image panels expand and reveal captions | Visual research/artifact browsing, only where images exist |
| CoverFlow | Spatial card/cover browsing | Optional Ideas/Library view with list alternative |
| CardSwap | Layered cards trade their front position | Small set of pinned ideas/briefs, with manual navigation |
| BentoGrid + BentoCard | Unequal-size content tiles with coherent grouping | Explore capability overview; not a Home dashboard |
| DynamicIsland | Status surface morphs between content sizes | Quiet assistant state → expanded status/detail |
| Breadcrumbs | Hierarchical navigation with icons | Notes folders, documents and nested project context |
| JellyButton | Elastic press/hover feedback | Small playful secondary action, distinguish from metal hero |
| GooeyFab | Floating action expands into connected controls | Optional contextual create menu; do not duplicate the main navigation |

### Fidelity and missing assets

- The catalog runs genuine GodUI implementations and the pinned Paper shader,
  not screenshots of effects. Only the selected reference mounts at once.
- `Node`, `Cover` and the step list missing from the usage snippets were supplied
  as local demonstration helpers. The four `/photos/*.jpg` files were not
  provided: image examples use explicitly documented original SVG landscapes.
- Demo room/approval/voice/activity outcomes are illustrative; they do not call
  AVA's APIs or claim actual model/worker/microphone operations.
- The **shell's CSS silver is not equivalent to the liquid-metal shader**.
  Niko particularly likes the real shader. Compare them in motion before deciding
  where to use each. The existing preview can allocate a WebGL context per shader
  button in addition to the face; production context/performance choices remain
  to be agreed and measured, not silently changed.

## Earlier research and design inputs (not additional supplied components)

| Input | Technique / possible use | Current evidence |
|---|---|---|
| Magic UI | Beams, orbiting relationships, responsive docks, ripple and text reveal | Requested inspiration; reviewed in research v2, not a wholesale dependency adoption |
| 21st.dev | Community materials, shaders, cards and agent UI | Requested inspiration; individual entries need their own provenance, not a single blanket license |
| Armory | Restraint, large type | Named in `ui-remodel.md`; visual principle, not copied component |
| Fourmula | Menu pill grows into navigation | Named in `ui-remodel.md`; compare with the persistent AVA bar |
| Avalon | Optical/glass action controls | Named in `ui-remodel.md`; compare with Niko's newer metal preference |
| Epiminds | Expressive particle face | Named in `ui-remodel.md`; AVA already has its own face asset/renderer |
| Earlier local awwwards showcase | Broad curated website inspiration | Mentioned by Niko; original external file is not re-inspected or asserted complete by this AVA-only task |
| Signal (motion lab) | State-linked presence and ranked brief | Standalone interactive experiment |
| Choreography (motion lab) | Request → context → proposal → approval → verified result | Standalone sequence, explicitly not operational evidence |
| Atlas (motion lab) | Spatial life areas, progressive camera focus | Optional overview experiment, not required navigation |
| Time (motion lab) | Reversible preview of a schedule repair | Interaction study, no calendar mutation |
| Material (motion lab) | Optical, elastic, kinetic type and generative fields | Interactive comparisons beyond ambient motion |

The research report additionally surveys Motion/Motion Primitives, React Spring,
AutoAnimate, GSAP/Theatre, Rive/dotLottie, Paper/Motion GPU/Shader Lab,
React Bits/Aceternity/Animata/Inspira/Cult/Kokonut, agent UI libraries and spatial
renderers. These are research candidates, not all supplied or approved by Niko,
and not all installed or represented by a demo. Refer to the report's own evidence
and caveats rather than relabelling them as implemented AVA components.

## Composition handoff

Codex owns this inventory and the Home/Voice viewport-fit correction. Claude owns
the screen-by-screen proposed composition on separate paths. Together we show
one browsable proposal with the chosen components **moving**, with useful variants
where taste genuinely matters. Keep the complete catalog for comparison.

Home/Voice should fit the viewport at normal text size, including short and
landscape screens. Allocate actual remaining height to the face; don't add fixed
hero minimums and then hide overflow. Expanded input/details need their own space.
Large text/zoom must remain accessible even if reflow then needs scrolling.

Production integration is paused for Niko's design discussion. This inventory
covers the supplied snippets visible in this conversation and the repository
evidence listed here; it does not pretend to recover unseen historical files.
