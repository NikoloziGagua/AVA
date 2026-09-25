# AVA frontier interface and motion research

**Date:** 2026-09-25

**Revision:** v2, expanded after the first preview proved too static and too narrow

**Scope:** current open-source motion, graphics, spatial-interface and agent-UI work; current creative-web practice; and the interaction systems that genuinely fit a personal assistant and life-management product.

**Interactive preview:** [`../design/previews/frontier-ui-lab/index.html`](../design/previews/frontier-ui-lab/index.html)

## The correction

The first research pass found a sound visual direction, but its prototype did not
demonstrate the main subject. It showed three polished layouts with ambient
movement. It did **not** show state choreography, spatial transitions, physics,
temporal motion, or a wide enough range of current interaction work.

This revision treats motion as an interface system rather than a decorative
layer. The new lab contains five materially different experiments:

1. **Signal** — AVA as a responsive presence whose energy follows actual state.
2. **Choreography** — a request visibly becomes context, proposal, approval,
   action, and verified outcome.
3. **Atlas** — a spatial view of life areas with focus behaving like a camera.
4. **Time** — a schedule change that moves from current state to preview without
   pretending the change has been written.
5. **Material** — optical, elastic, kinetic-type, and generative-field studies.

The preview is original, standalone, offline, keyboard operable, responsive,
and has an equal reduced-motion state. It embeds no third-party component code,
fonts, images, analytics, or network requests.

## Executive judgment

AVA should not become a neon dashboard, an Awwwards portfolio, or a collection
of fashionable registry components. The frontier opportunity is more specific:

> **AVA should feel like one continuous intelligence moving between attention,
> thought, proposal, action, and memory.**

That calls for four product-level motion systems:

- **Presence:** small ambient changes communicate listening, speaking, waiting,
  urgency, and rest.
- **Continuity:** objects move between views so Niko keeps spatial and conceptual
  context instead of seeing pages blink in and out.
- **Causality:** agent work unfolds as a legible sequence, with proposal,
  approval, executor report, and verification remaining distinct.
- **Material response:** controls have restrained pressure, spring, and light
  behavior so the app feels direct rather than inert.

The interface remains semantic DOM first. Graphics provide atmosphere and
relationships; they do not become the only place meaning exists.

## What the broad scan found

### 1. Production motion engines

| Project | What it is good at | Fit for AVA | Judgment |
| --- | --- | --- | --- |
| [Motion](https://motion.dev/docs/react) | React layout handoff, gestures, springs, exit sequencing, reduced-motion hooks | Already in AVA; best default for product-state motion | **Use now** |
| [React Spring](https://github.com/pmndrs/react-spring) | Physics-first animation across DOM and React Three Fiber | Excellent tactile reference, but overlaps Motion | Reference; no second engine yet |
| [AutoAnimate](https://github.com/formkit/auto-animate) | Zero-config list and layout changes | Useful for low-risk lists, but hides choreography choices | Selective only |
| [GSAP](https://github.com/greensock/GSAP) | Precise timelines, authored sequences, FLIP and scroll choreography | Strong for an isolated onboarding or narrative; excessive for daily state | Isolated use only |
| [Theatre.js](https://github.com/theatre-js/theatre) | Visual authoring, dope sheet, graph editor, Three integration | Valuable for a brand film or authored launch sequence | Defer from daily runtime |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) | Source-owned morphing dialogs, disclosures, text effects, layout transitions | Good implementation reference with an MIT licence | Best copy-source candidate |
| [mo.js](https://github.com/mojs/mojs) | SVG/shape bursts, timelines, motion-graphics primitives | Too illustration-led for core AVA but useful for one celebratory confirmation | Reference only |
| [Rive Web](https://github.com/rive-app/rive-wasm) | Interactive vector state machines and designer-authored characters | Technically strong for a future expressive AVA avatar | Prototype later; asset/editor workflow required |
| [dotLottie Web](https://github.com/LottieFiles/dotlottie-web) | State machines, themes, segments, worker/WASM rendering | Good for authored illustration; runtime/WASM cost is real | Not a core interaction engine |

**Conclusion:** AVA already has the right primary engine. The missing work is not
another dependency; it is a motion grammar and disciplined state mapping.

### 2. Native browser motion

The web platform is now a serious part of the motion stack:

- The [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API)
  can preserve visual context between DOM states and routes, with an immediate
  non-animated fallback in unsupported browsers.
- [Scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations)
  bind motion to user-controlled progress without a main-thread scroll handler.
- The [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API)
  gives imperative timeline control without importing a framework.
- CSS masks, `color-mix()`, container queries, individual transform properties,
  and `prefers-reduced-motion` now cover much of what once required JavaScript.

The View Transition API is particularly relevant to AVA. Its value is not a
fancy page wipe; it can let the same note, event, person, or conversation object
visually move between Today, Talk, Notes, and detail views. That reduces
cognitive load and makes the product feel continuous.

**Conclusion:** use native browser motion as progressive enhancement. Navigation,
focus, reading order, and history must remain correct without it.

### 3. Shader and generative-material systems

| Project | Interesting capability | AVA relevance | Risk |
| --- | --- | --- | --- |
| [Paper Shaders](https://github.com/paper-design/shaders) | Lightweight React/vanilla shader materials such as mesh, dither, pulse, and orbit | Strong candidate for one demand-loaded ambient signal | Pre-1.0 churn; GPU/battery |
| [Motion GPU](https://github.com/motion-core/motion-gpu) | Narrow WebGPU fullscreen shader and multi-pass runtime | Compelling future path for generative material without a 3D engine | WebGPU capability and maturity |
| [Shader Lab](https://github.com/basementstudio/shader-lab) | Stackable authored shader compositions | Useful R&D reference for art-directed materials | Another runtime/editor workflow |
| [React Three Fiber](https://github.com/pmndrs/react-three-fiber) | React renderer for Three with broad ecosystem | Already matches AVA's face pipeline and spatial experiments | Easy to overuse; large graph |
| [OGL](https://github.com/oframe/ogl) | Small, direct WebGL abstraction | Better than Three for one custom shader in a new product | Duplicates an existing AVA capability |
| [PixiJS](https://github.com/pixijs/pixijs) | High-performance 2D GPU scene graph | Strong for thousands of sprites and filters | Unneeded for current product surfaces |
| [regl](https://github.com/regl-project/regl) | Functional WebGL command abstraction | Excellent low-level experiment tool | Too low-level for product UI |
| [p5.js](https://github.com/processing/p5.js) | Accessible creative-coding ecosystem | Fast concept exploration and teaching | Not a production AVA runtime |
| [Alma](https://github.com/emilwidlund/alma) | Node-based generative WebGL composition | Useful reference for building visual materials, not shipping UI | Inactive/experimental fit |

Creative-web practice supports a clear capability policy: render only while the
effect is visible or changing; keep meaning in DOM; suspend when hidden; lower
quality by device capability; provide a deliberate still state; never require a
GPU effect to operate the assistant.

**Conclusion:** AVA should have one signature generative material, not a shader
catalogue. The existing face is the current primary candidate. A second ambient
shader must beat a CSS/canvas version on both feel and measured cost.

### 4. Source-owned component registries

The broader component search found far more than Magic UI and 21st.dev, but it
also reinforced that registries are ingredients, not product design.

| Source | Useful territory | Adoption note |
| --- | --- | --- |
| [Magic UI](https://github.com/magicuidesign/magicui) | beams, orbiting circles, ripple, animated grids, dock, text reveal | MIT/source-owned; good technique reference |
| [21st.dev](https://21st.dev/) | very broad community discovery across shaders, cards, interactions, and AI UI | Every item has separate author, licence, dependencies and quality |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) | morphing popovers/dialogs, toolbar, text, disclosure | Coherent and restrained; closest fit |
| [React Bits](https://github.com/DavidHDev/react-bits) | shaders, text, cursor, backgrounds, elastic and physics experiments | Excellent R&D; Commons Clause needs care |
| [Aceternity UI](https://github.com/aceternityui/aceternity-ui) | parallax, tracing beams, spotlights, animated modals | Often landing-page heavy; treat as reference |
| [Animata](https://github.com/codse/animata) | source-owned interaction and text experiments | Audit individual patterns and maintenance |
| [Inspira UI](https://github.com/unovue/inspira-ui) | Vue-first animated backgrounds, particles and reveals | Inspiration only for AVA's React stack |
| [Cult UI](https://github.com/nolly-studio/cult-ui) | experimental source-owned interface blocks | Young; pattern review rather than dependency |
| [Kokonut UI](https://github.com/kokonut-labs/kokonutui) | polished small interactions and composition | Adapt only if a specific product state needs it |
| [Radix Primitives](https://github.com/radix-ui/primitives) | accessible behavior foundations | Continue using for semantics, not visual identity |

High-value techniques from this ecosystem:

- shared-layout morphing from a quiet control to focused detail;
- animated beams only when they convey a real relationship or transfer;
- progressive blur at scroll/sheet boundaries;
- magnetic or elastic response only on primary direct-manipulation controls;
- text reveal used for a changed status, never for every paragraph;
- ambient grids/noise confined to an empty presence surface.

Low-value patterns for AVA:

- meteors, confetti, perpetual border beams, glowing every card;
- scrambling ordinary text before it becomes readable;
- custom cursors that weaken native feedback;
- hover-only information;
- endless marquees, fake telemetry, and ornamental charts;
- copied bento grids that make a personal assistant look like SaaS marketing.

### 5. Agent-native and generative UI

| Project | Strong lesson | AVA decision |
| --- | --- | --- |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | Conversation, tools, approvals, sources, attachments and branching as composable primitives | Borrow behavior patterns; keep AVA's runtime |
| [Vercel AI Elements](https://github.com/vercel/ai-elements) | Source-owned AI conversation, code, reasoning and artifact elements | Component anatomy reference, not a backend replacement |
| [Tambo](https://github.com/tambo-ai/tambo) | Models choose from registered typed React components and stream validated props | Strong model for renderer-neutral trusted generative UI |
| [OpenGenerativeUI](https://github.com/CopilotKit/OpenGenerativeUI) | Interactive HTML/SVG/3D artifacts in a sandboxed frame | Useful visual-explanation comparison; sandbox and schema remain mandatory |
| [Kansho UI](https://github.com/joeyvansommeren/kansho-ui) | UI for plans, permissions, memory, costs, failure and review beyond chat | Valuable taxonomy for AVA's operational states |
| [BoardUI](https://github.com/BoardUI/boardui) | Agent/product components on accessible React Aria foundations | Broad reference; do not import its visual language wholesale |
| [React Agent UI](https://github.com/vivekparekh8/react-agent-ui) | Protocol-driven deterministic rendering from typed events | Reinforces AVA's canonical semantic-model approach |

The strongest shared idea is **trusted generative composition**: the model does
not generate arbitrary application code. It selects or fills known components
through validated, versioned data. AVA's visual-explanation model and inline
tool/result surfaces should continue in that direction.

Motion implication: structured results should not suddenly appear as foreign
widgets. They should grow out of the conversational turn, preserve their object
identity when expanded, and collapse back without losing selection or context.

### 6. Spatial and canvas interfaces

| Project | Capability | AVA relevance |
| --- | --- | --- |
| [XYFlow](https://github.com/xyflow/xyflow) | Proven node/edge editing and viewport behavior | Already appropriate for system/process diagrams |
| [Flowscape Canvas](https://github.com/Flowscape-UI/canvas-react) | Infinite canvas, nodes, pan/zoom, selection, history | Good reference if a true spatial workspace is ever needed |
| [Canvas DOM](https://github.com/vivekparekh8/canvas-dom) | Accessible React controls anchored to canvas coordinates | Strong hybrid pattern: graphics below, semantic DOM above |
| [Zircle UI](https://github.com/zircleUI/zircleUI) | Zoomable radial navigation | Interesting model for orientation; visual system is too specific |
| [D3](https://github.com/d3/d3) | Data joins, scales, transitions, hierarchy and geography | Best toolkit for grounded, bespoke information motion |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) | Open map rendering with interaction and style control | Correct foundation for geographic visual explanations |
| [deck.gl](https://github.com/visgl/deck.gl) | GPU layers for large geographic datasets | Use only when dataset scale warrants it |

AVA does not need a permanent infinite canvas. A spatial overview is valuable
when Niko asks, “how is everything connected?” It should open as a temporary
orientation layer, preserve ordinary keyboard navigation, and collapse into one
focused object. Pan and zoom are local interaction state, never a new source of
truth.

### 7. Current creative-web practice

The most useful current references were not chosen because AVA should look like
them. They demonstrate how advanced teams create a coherent feeling:

- [Whooshes, Snaps and Shaders](https://tympanus.net/codrops/2026/05/27/whooshes-snaps-and-shaders-adrien-vanderpotte-and-the-feeling-of-the-interface/)
  argues for a singular reactive signature and “invisible” sophistication in
  navigation rhythm rather than effect density.
- [Podium](https://tympanus.net/codrops/2026/06/23/podium-building-a-website-where-running-becomes-storytelling/)
  treats interfaces as temporal sequences and connects hero material, typography,
  micro-interaction, and navigation through one visual language.
- [Motion Highlights #17](https://tympanus.net/codrops/2026/03/29/motion-highlights-17/)
  shows the current breadth: living particle fields, fluid simulation, kinetic
  type, shader cards, tactile controls, and motion-led storytelling.
- [Codrops Creative Hub](https://tympanus.net/codrops/hub/) is a searchable
  catalogue spanning physics, magnetic controls, masks, morphing, shaders,
  spatial navigation, page transitions, and WebGPU.
- [A WebGL portfolio process](https://tympanus.net/codrops/2025/11/27/letting-the-creative-process-shape-a-webgl-portfolio/)
  shows a useful discipline: standard browser history and accessible routes can
  coexist with custom visual transitions.

The product lesson is not “add WebGL.” It is “choose one behavior that feels
uniquely AVA, prototype it until the rhythm is right, and remove everything that
does not support that behavior.”

## A motion grammar for AVA

AVA needs named motion semantics rather than ad-hoc durations.

| Verb | Meaning | Typical motion | Never use for |
| --- | --- | --- | --- |
| **Arrive** | New information became available | soft rise/fade, 250–420 ms | old content merely rerendering |
| **Handoff** | The same object moved to another context | shared geometry / directional travel | unrelated page changes |
| **Focus** | One object became primary | camera-like settle; surroundings quiet | every hover |
| **Propose** | AVA is showing a reversible possible future | ghosted/dashed destination, reversible spring | implying a write completed |
| **Commit** | An approved write was accepted by the authority | concise snap/settle | executor-reported success alone |
| **Verify** | Independent evidence confirmed the result | second, distinct calm confirmation | model confidence |
| **Attention** | Niko should notice a change | one restrained pulse | permanent urgency |
| **Recover** | A task failed or became uncertain | return to last proven state, reveal recovery path | shaking/scolding UI |
| **Rest** | Nothing needs action | near-still ambient presence | hidden background loops |

Recommended timing ranges:

- direct manipulation feedback: 80–160 ms;
- local state transitions: 180–320 ms;
- shared-layout handoff: 320–550 ms;
- authored multi-stage explanation: 600–1200 ms per meaningful stage;
- ambient cycles: 4–12 seconds, with low amplitude and automatic suspension.

Durations are secondary to interruptibility. A state change must be able to
retarget from its current visual position instead of finishing an obsolete
timeline.

## The five motion prototypes

### Signal — responsive presence

AVA's particle face and surrounding field move gently at rest, respond to the
pointer, and gain energy only when “listening” is explicitly activated. Briefing
cards arrive with depth and hierarchy rather than loading as a flat dashboard.

This tests:

- presence without constant demand for attention;
- canvas as decorative signal while all meaning stays in DOM;
- state-linked rather than arbitrary energy;
- pausing under reduced motion, hidden tab, and inactive scene.

### Choreography — request to evidence

The user request, verified context, proposal, approval, and verified receipt are
separate objects connected by a visible path. The sequence can be replayed at
two tempos. Reduced motion shows the complete static result immediately.

This is the strongest product experiment. AVA already performs complex work,
but users often cannot see where intent ended, action started, or verification
occurred. Motion can make that boundary understandable without exposing hidden
reasoning.

### Atlas — spatial life orientation

University, projects, people, ideas, and health orbit a central AVA node. Focus
quietens irrelevant areas and highlights only the authoritative connection.
Buttons remain ordinary DOM, work with arrow keys, and surface one readable
detail panel.

This should remain an optional “zoom out” mode, not the default navigation.

### Time — a schedule as a manipulable future

The schedule ribbon makes a conflict visible and moves the flexible meeting to a
new location when the user requests a resolution. The status remains “preview
only” because no real write exists. The animation explains the trade-off and
preserves the original state for reversal.

This pattern generalizes to deadlines, project planning, and travel itineraries.

### Material — a controlled bake-off

Four independent studies test optical focus, elastic response, kinetic type,
and a pointer-disturbed field. They are intentionally presented together as an
R&D board so the product team can reject three and keep one.

The likely winner is restrained elastic response plus the existing particle
presence. Full liquid-glass treatment is visually impressive but a poor default
for dense personal information.

## Recommended product direction

### Use in the next production increments

1. Define the motion tokens and verbs above using AVA's existing Motion
   dependency and CSS custom properties.
2. Apply **Handoff** to one real object moving between Today and detail.
3. Apply **Propose → Commit → Verify** to one real calendar/reminder action.
4. Keep the face/presence signal state-driven and suspend it when inactive.
5. Add reduced-motion snapshots to the design gallery for every new state.

### Prototype before adopting

1. Native View Transitions for cross-screen object continuity.
2. One Paper Shaders or custom existing-Three material against a CSS/canvas
   control, measured on the intended phone.
3. A temporary Atlas view with real-shaped synthetic data and task-based tests.
4. Rive only if AVA needs authored expression that the current face cannot
   deliver.

### Deliberately reject for now

- a new general motion engine;
- permanent infinite-canvas navigation;
- arbitrary model-generated React or HTML;
- WebGPU as a core requirement;
- liquid glass on ordinary reading surfaces;
- motion that delays simple answers;
- scroll theatre inside daily task flows;
- sound/haptics until the visual state model is correct.

## Acceptance gates for any production motion

### Meaning and truth

- The motion has one named semantic verb.
- Proposal, accepted action, and verified outcome look different.
- A failure returns to the last proven state and shows recovery.
- No decorative transfer implies data or action that did not occur.

### Accessibility

- Reading order and focus order remain correct during and after transition.
- Keyboard users can trigger and leave every state.
- Screen-reader announcements describe the state, not the animation.
- Reduced motion is an intentional final composition, not a broken animation at
  `duration: 0`.
- Forced colours, zoom, and narrow widths preserve meaning.

### Performance and energy

- No animation adds an eager production dependency without a measured budget.
- Transform/opacity are preferred for DOM choreography.
- Canvas/WebGL render only when visible or changing.
- Resize and device-pixel ratio are bounded.
- Long tasks, dropped frames, memory, battery, and thermal behavior are measured
  on the intended phone, not inferred from a desktop.
- Every deferred visual needed offline is included in PWA precache.

### Product restraint

- One primary motion event per user action.
- Ambient motion never competes with a reply, approval, or warning.
- No important interaction relies on hover.
- Motion can be interrupted and retargeted.
- Real content is tested; a beautiful empty state is insufficient.

## Final recommendation

Keep the current Ink-and-Paper visual direction, but make its behavior far more
ambitious. The signature should be:

1. **AVA breathes quietly at rest.**
2. **Objects keep their identity as Niko moves through his life.**
3. **Agent work unfolds as a truthful, legible sequence.**
4. **Direct controls feel physical and precise.**
5. **Everything becomes still, complete, and equally usable when motion is
   reduced.**

That is more frontier—and more valuable—than adding a larger pile of animated
components.
