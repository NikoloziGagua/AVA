# AVA frontier interface research

**Date:** 2026-09-25
**Scope:** current open-source component systems, motion and graphics tooling,
frontier web interaction, and the patterns that genuinely fit a personal
assistant/life-management product.
**Prototype:** [`../design/previews/frontier-ui-lab/index.html`](../design/previews/frontier-ui-lab/index.html)

## Executive judgment

AVA should not become a neon dashboard or an Awwwards portfolio wrapped around
a chat box. The frontier move is more restrained: **make the interface feel
alive, contextual and spatial while keeping the conversation and the next
important thing effortless.**

The strongest product direction is a synthesis:

1. **Presence as the default.** A calm centre with AVA, the next important item,
   and one command surface. Generative graphics can make AVA feel present, but
   they stay decorative and demand-loaded.
2. **A constellation for orientation.** Notes, schedule, projects, people and
   ideas appear as connected areas only when Niko wants the wider picture.
   Selecting one area collapses the interface back to one useful detail.
3. **A conversational continuum for work.** Plans, schedule changes, research,
   evidence and approvals unfold inline beneath AVA's words instead of being
   thrown into separate dashboards.

This is more distinctive than copying any component registry, and it matches
AVA's intended identity: a personal intelligence that has been paying
attention—not another SaaS admin panel.

## What the frontier is actually doing

The best current work falls into six families.

### 1. Source-owned animated components

[Magic UI](https://github.com/magicuidesign/magicui) is MIT-licensed and uses
the shadcn model: copy the component source into the product, then own and adapt
it. Its best AVA-relevant patterns are animated beams, border beams, orbiting
circles, bento composition and restrained text reveal. They are useful as
techniques, not as a full identity.

[21st.dev](https://21st.dev/) is a broad discovery registry rather than one
coherent library. That is valuable for comparison—especially Motion
Primitives, Magic UI, Kokonut and unusual shader experiments—but every chosen
item needs its own author, licence, dependency, focus, mobile and reduced-motion
review. “Available on 21st” is not an adoption decision.

[Motion Primitives](https://github.com/ibelick/motion-primitives) is the safest
small-pattern source in this category: MIT licensed, focused, and suitable for
local ownership. It is a better reference for disclosure, morphing dialogs,
text effects and shared-layout transitions than importing an entire visual
system.

[React Bits](https://github.com/DavidHDev/react-bits) has exceptional breadth,
including text, cursor, background and micro-interaction experiments. Its
licence is MIT plus Commons Clause, so it is an inspiration/prototype source
until the exact redistribution implications for AVA are reviewed. Its creative
tools are especially useful for exploring dithering, texture and shape rather
than copying whole components.

**AVA decision:** adopt techniques one at a time through existing design tokens;
never import a registry aesthetic wholesale.

### 2. Motion as a system, not decoration

[Motion](https://motion.dev/docs/react) remains the best production fit for
AVA because it already exists in the repository, is React-native, supports
interruptible springs/layout changes, and exposes a clear
[`useReducedMotion`](https://motion.dev/docs/react-use-reduced-motion) path.
AVA should define a small motion grammar—settle, reveal, handoff, confirm,
attention—instead of per-component animation guesses.

[Theatre.js](https://www.theatrejs.com/) is a serious browser motion-authoring
tool with a graph editor, dope sheet and Three.js support. It is impressive for
authored hero sequences and launch experiences, but too heavy and time-based for
ordinary personal-assistant state. Keep it for a future cinematic onboarding or
brand film, not the daily runtime.

Current Codrops case studies repeatedly show the same lesson: memorable sites
have a singular motion language and rhythm, while their strongest creators use
native CSS for simple transitions, GSAP for choreography, and WebGL only when
the concept requires it. The [Podium case study](https://tympanus.net/codrops/2026/06/23/podium-building-a-website-where-running-becomes-storytelling/)
also argues for restraint, strong type and continuous narrative rather than
effect density.

**AVA decision:** use Motion for stateful UI, CSS for small hover/focus changes,
and GSAP only for an isolated authored sequence. Motion must explain state or
continuity.

### 3. Generative material and shaders

[Paper Shaders](https://github.com/paper-design/shaders) is the most interesting
new candidate. It is Apache-2.0, zero-dependency, available for React and vanilla
canvas, and explicitly intended for lightweight textured backgrounds/masks.
Mesh gradients, dither, dot orbit, pulsing borders and restrained neuro-noise
could give AVA an authored “living signal” without a large 3D scene. The project
warns that pre-1.0 releases may break even under `0.0.x`, so any trial should pin
an exact version behind a lazy boundary and static fallback.

[OGL](https://github.com/oframe/ogl) is a mature minimal WebGL layer with zero
dependencies and a small complete footprint. It is preferable to a full Three
scene for one custom shader, but AVA already has Three and an offline PWA budget.
Adding a second graphics runtime is unjustified unless measurement proves the
custom effect materially smaller.

React Three Fiber's own [performance guidance](https://github.com/pmndrs/react-three-fiber/blob/master/docs/advanced/scaling-performance.mdx)
recommends on-demand rendering and quality regression for broad device support.
That reinforces AVA's existing decision: GPU visuals must be lazy, idle when at
rest, absent under reduced motion/capability fallback, and semantically
duplicated in ordinary DOM.

**AVA decision:** prototype a single Paper Shader as a demand-loaded ambient
material after the current face/home work settles. Do not turn normal controls
into WebGL.

### 4. Glass and optical depth

[Liquefy UI](https://github.com/liquefy-ui/liquefy-ui) explores real WebGL edge
refraction, spring energy and Base UI accessibility. It demonstrates an
important frontier idea: expensive optics should render only during interaction
and decay, not forever.

[OpenGlass UI](https://github.com/moekoelueker/open-glass-ui) takes the more
practical route: CSS is the default, SVG/WebGL are opt-in, the DOM remains
semantic, and reduced motion/transparency/forced-colour modes are designed
states. Its current repository is extremely young, so AVA should borrow the
capability policy rather than depend on the package.

**AVA decision:** keep AVA's glass sparse—command dock, transient sheet,
one focus card. Use solid/translucent DOM surfaces by default. “Liquid glass on
everything” ages quickly and reduces legibility.

### 5. Agent-native conversation interfaces

[assistant-ui](https://www.assistant-ui.com/) is a useful reference for the
behavioral surface of an agent conversation: streaming, tools, approvals,
sources, attachments, branching, voice and generative UI are composable
primitives rather than one monolithic chat widget. AVA already has its own
durable chat/voice architecture, so replacing it would be a major regression
risk. The valuable lesson is **structured outputs stay inside the thread and
share its lifecycle**, as shown in the Continuum prototype.

Its [open-source catalogue](https://www.assistant-ui.com/oss) also includes a
safe-content-frame primitive. This is relevant to AVA's visual artifacts and
untrusted rich content, but it should be evaluated against AVA's existing
sandbox rather than installed by default.

**AVA decision:** preserve AVA's backend and persistence; selectively adopt
interaction patterns such as inline tool state, sources, approval and structured
artifacts.

### 6. Native browser capability

The browser platform now covers more of the “frontier” without a runtime.
[CSS scroll-driven animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines)
can bind effects to user-controlled scroll without a main-thread scroll loop.
View transitions, masks, container queries and modern colour functions can
provide polish with progressive fallback. They should be capability-enhanced,
not required for navigation or state.

**AVA decision:** prefer native CSS for local, nonessential effects. AVA is an
installed application; reliability and offline behaviour matter more than a
landing-page spectacle.

## Reference product/site lessons

| Reference | What is worth learning | What AVA should reject |
| --- | --- | --- |
| [Linear's 2026 UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh) | Scanability, focus, compact hierarchy and quiet state changes | Copying productivity-software density into a personal assistant |
| [Shopify Editions Winter '26](https://www.shopify.com/editions/winter2026) | A release as an explorable story; strong section identity; content revealed progressively | Scroll theatre for routine daily actions |
| [Codrops Creative Hub](https://tympanus.net/codrops/hub/) | Shader, typography, transition and spatial-navigation experiments; MIT demo source | Using a GPU experiment as the only accessible UI |
| [Whooshes, Snaps and Shaders](https://tympanus.net/codrops/2026/05/27/whooshes-snaps-and-shaders-adrien-vanderpotte-and-the-feeling-of-the-interface/) | A distinct interaction signature and seamless navigation matter more than effect count | Generic hover effects scattered without a product language |
| Niko's local `awwwards-showcase.html` | Bold hierarchy, editorial pacing, visible curation and “borrow principles, not pixels” | Remote imagery, portfolio-style card grids and constant marketing motion inside AVA |

## Candidate adoption matrix

| Candidate | Licence / maturity | AVA value | Cost / risk | Recommendation |
| --- | --- | --- | --- | --- |
| Motion (already installed) | established; current AVA dependency | unified state motion, gestures, layout handoff | misuse can animate everything | **Use now; define a grammar** |
| Magic UI patterns | MIT; large active repo | beams/orbits/reveals for one signature moment | component aesthetic can overwhelm AVA | **Reference or selectively copy** |
| 21st.dev | per-author/per-component | rapid visual discovery and comparison | inconsistent quality/licensing/accessibility | **Research catalogue only** |
| Motion Primitives | MIT; focused | small source-owned interaction patterns | needs AVA-token adaptation | **Best copy-source candidate** |
| Paper Shaders | Apache-2.0; active but pre-1.0 | lightweight living material / ambient signal | WebGL, version churn, PWA weight | **Run one pinned lazy experiment** |
| React Bits | MIT + Commons Clause | rich texture and motion explorations | distribution terms; effect overload | **Inspiration/prototypes only** |
| assistant-ui | mature open-source AI UI | excellent conversation interaction references | replacing AVA runtime is too broad | **Borrow patterns, not runtime** |
| Theatre.js | open-source motion authoring | cinematic onboarding/brand sequences | editor/runtime complexity | **Defer** |
| OGL | Unlicense; established | minimal custom WebGL | duplicates Three capability | **No adoption without size proof** |
| Liquefy/OpenGlass | MIT; very new | optics/capability-policy ideas | immaturity and visual trend risk | **Borrow policy, do not depend yet** |

## The three prototype directions

### Concept 1 — Presence

The home screen is almost empty. AVA appears as a quiet generative presence,
then gives one concise briefing, one next item, and one input. This is the best
default because it communicates intelligence and calm without making Niko
navigate a dashboard.

Use from frontier research:

- particle/point material, demand-loaded and decorative;
- an optical command dock, kept to one surface;
- motion as breathing/status—not confetti;
- typography and whitespace carrying most of the hierarchy.

### Concept 2 — Constellation

A zoomed-out view connects University, Projects, People and Ideas around AVA.
The diagram is not a permanent information architecture; it is a momentary
orientation layer. Selecting one node opens one detail with two relevant
actions.

Use from frontier research:

- spatial navigation and animated-beam lineage;
- progressive disclosure instead of a giant life dashboard;
- a generative ambient field behind semantic DOM nodes;
- visual relationships grounded in actual AVA data, never inferred decoration.

### Concept 3 — Continuum

Conversation remains the main interface, but it is no longer “text bubbles
only.” AVA's answer unfolds into a proposed schedule change, evidence and
actions, while a small continuity panel keeps relevant memory visible. Voice and
text are explicitly one thread.

Use from frontier research:

- agent-native inline structured results;
- evidence disclosure adjacent to the claim/action;
- a persistent but quiet context capsule;
- shared-layout transitions for expansion, not new windows.

## Recommended product direction

Build **Presence + Continuum**, with Constellation as an optional zoom-out mode:

```text
Home / Today
   ↓ one important item + AVA presence
Conversation
   ↓ natural-language work + inline structured results
Zoom out only when asked
   ↓ constellation of schedule / notes / people / projects / ideas
```

The visual signature should be:

- near-black Ink with restrained spectral light;
- Geist-style strong type and generous negative space;
- a particle/dither language tied to AVA's presence;
- surfaces that appear only around actionable content;
- directional, interruptible movement with a reduced-motion equivalent;
- no decorative cyberpunk labels, fake telemetry, or permanent glowing borders.

## Engineering guardrails

1. Core navigation, conversation and content remain semantic DOM.
2. Every GPU effect is lazy, optional, pausable, bounded and statically
   replaceable; no raw content is drawn only to canvas.
3. Motion is encoded as product states and respects the existing user motion
   preference plus operating-system reduced motion.
4. Every copied component gets an exact source/version/licence note and local
   ownership; no unreviewed registry install.
5. New visual code must pass initial-eager and per-chunk budgets, offline PWA
   precache checks, keyboard and narrow-width tests.
6. Prototype with synthetic non-personal content; do not expose life context
   merely to decorate a screen.
7. Test low-end/mobile capability before turning an experiment into the default.

## Smallest sensible next experiments

1. **Signature motion grammar:** name and encode 5 transitions using the Motion
   dependency already present—settle, reveal, handoff, confirm, attention.
2. **One ambient-material bake-off:** compare CSS-only dither/mesh against one
   pinned Paper Shader on Home, with performance, energy and reduced-motion
   measurements. Do not install it before that bounded evaluation is approved.
3. **Inline result anatomy:** prototype one real schedule-change result inside
   chat, with source/evidence, approval and accessible static state.
4. **Constellation usability test:** use real-shaped synthetic data and test
   whether it helps Niko answer “what matters?” faster than Today + search.

The preview deliberately uses no third-party code. It proves the product ideas
can stand on their own before AVA adopts any library.
