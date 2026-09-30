# AVA interface frontier — independent research pass

Date: 2026-09-25

## Thesis

The strongest direction for AVA is not a maximal collection of animated components. It is a layered interface where:

1. **Ambient material communicates presence** (idle, listening, thinking, acting).
2. **Motion explains causality** (request → context → action → verification).
3. **Time is directly manipulable** (plans visibly move, conflict, repair and remain reversible).
4. **Spatial canvases appear on demand** for complex relationships, never as default navigation.
5. **Real accessible HTML remains the interaction layer**, with GPU/shader effects used beneath or around it.

## Primary references reviewed

- Magic UI — https://magicui.design — verified live; open-source repository: https://github.com/magicuidesign/magicui (MIT, 22k+ stars at review).
- 21st.dev — https://21st.dev — verified live; useful as a broad discovery market, not a coherent design system.
- Motion Primitives — https://motion-primitives.com — verified live; https://github.com/ibelick/motion-primitives (MIT, 6k+ stars). Strong fit for semantic transitions and micro-interactions.
- React Bits — https://reactbits.dev — verified live. Useful catalogue of animated treatments; select sparingly.
- Aceternity UI — https://ui.aceternity.com — verified live. Strong visual inspiration; many effects are landing-page-oriented rather than application-state-oriented.
- Animata — https://animata.design — verified live. Useful small interaction patterns.
- Rive — https://rive.app — verified live. State-machine animation is relevant for AVA's presence object, but runtime/licensing should be checked for the exact intended use.
- Theatre.js — https://theatrejs.com and https://github.com/theatre-js/theatre (Apache-2.0, 12k+ stars). Best considered as a prototyping/choreography authoring tool, not core runtime architecture.
- Canvas UI — https://github.com/DavidHDev/canvas-ui (4k+ stars). Particularly relevant: real HTML with WebGL effects over/around it. Repository licence metadata was not asserted by GitHub API; check before adoption.
- UVCanvas — https://uvcanvas.com and https://github.com/latentcat/uvcanvas. Attractive shaded ambient surfaces; GitHub licence metadata was absent, so treat as inspiration until manually cleared.
- Metal FX — https://github.com/Jakubantalik/metal-fx (MIT). A focused liquid-metal WebGL treatment; suitable only for rare high-salience controls or presence material.
- React Three Fiber — https://github.com/pmndrs/react-three-fiber (MIT, 32k+ stars). Mature route for actual 3D when the concept requires it; avoid for routine panels.
- XYFlow — https://github.com/xyflow/xyflow (MIT, 38k+ stars). Strong foundation for explainable tool traces and bounded relationship maps.
- tldraw — https://github.com/tldraw/tldraw (50k+ stars). Strong infinite-canvas model; repository licence requires exact review before product adoption.
- Motion — https://github.com/motiondivision/motion (MIT, 33k+ stars). Sensible default runtime for layout and state transitions.
- shadcn/ui — https://github.com/shadcn-ui/ui (MIT, 124k+ stars). Keep as accessible composable substrate; frontier character should come from AVA's behavior and material system.

## New candidates found through GitHub discovery

- Serenity UI — https://github.com/ayushmxxn/serenity-ui — React/Canvas/WebGL components, shadcn-style copying.
- Atelier UI — https://github.com/whatisjery/atelier-ui — WebGL and motion registry for React.
- Hyperiux Components — https://github.com/Hyperiux-Immersion-Labs/hyperiux-components — CLI-installable interaction effects.
- UI FX Kit — https://github.com/pptt3300/ui-fx-kit — composable cursor, scroll, text and background effects; evaluate maturity before use.
- ModernRelay Orbit — https://github.com/ModernRelay/orbit — declarative WebGL graph rendering for very large graphs; potentially useful only if AVA's memory/context map grows beyond DOM-scale views.

## Recommended AVA system

### A. Presence field
A subtle shader/material layer that reacts to operational state. It must never be the only state indicator. Pair it with text and reduced-motion support.

### B. Action choreography
Use Motion Primitives/Motion-style layout transitions to show a compact, persistent chain: intent, context, approval where required, action, evidence. This is the most valuable frontier idea because it makes agency understandable.

### C. Temporal planning surface
Calendar and tasks should animate edits and conflict repairs, preserve before/after context, and support undo. Motion is functional here, not decorative.

### D. Optional context atlas
Use XYFlow for bounded graphs or tldraw-like interaction for a larger thinking surface. Enter from a specific question or project; do not replace ordinary navigation.

### E. Material restraint
One ambient shader, one typographic motion language, one depth system. Avoid mixing every library's signature effect—the result would look assembled rather than intelligent.

## Adoption guardrails

- Maintain reduced-motion and non-WebGL fallbacks.
- Performance budget effects separately from application code.
- Verify exact licences before copying any source whose repository metadata is absent or non-standard.
- Prefer state-driven animation over scroll spectacle.
- Do not use 3D where a 2D spatial relationship is clearer.
- Keep approvals and risky actions visually separate from ordinary progress.

## Preview

`docs/design/previews/ava-frontier-independent/index.html`

The preview is original and demonstrates the recommended combination: ambient presence, explainable choreography, temporal planning, and optional spatial context.