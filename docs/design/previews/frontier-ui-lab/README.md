# AVA motion laboratory v2

This is a standalone, offline-openable interaction prototype. It does not modify
AVA's live interface or require a development server.

## Open it

Double-click [`index.html`](index.html) or open it in a current browser. There
are five experiments:

1. **Signal** — a state-responsive AVA presence and ranked briefing.
2. **Choreography** — request → context → proposal → approval → verified result.
3. **Atlas** — spatial life navigation with progressive focus.
4. **Time** — a reversible schedule-repair preview.
5. **Material** — optical, elastic, kinetic-type and living-field studies.

The preview is intentionally interactive:

- use the header or number keys `1`–`5` to change experiment;
- press `R` or the Replay control to replay the active motion;
- press `M` to switch full/reduced motion;
- use the Calm/Quick control to compare pacing;
- activate the voice control in Signal, Play sequence in Choreography, life-area
  nodes in Atlas, Resolve the clash in Time, and each Material experiment;
- use arrow keys between Atlas nodes.

The system setting `prefers-reduced-motion` is honoured on first open. Reduced
motion shows complete static states instead of hiding information. Everything is
local: no fonts, images, analytics, libraries, CDNs, or network requests.

## Intent

This lab compares motion systems rather than page templates. Nothing in it is a
proposal to animate every AVA screen. The research recommendation is to combine:

- Signal's calm, state-linked presence;
- Choreography's truthful action/evidence boundaries;
- Time's reversible preview pattern;
- one restrained tactile response from Material;
- Atlas only as an optional zoom-out view.

The broader source review, adoption decisions, and production gates are in
[`../../../research/frontier-ui-2026-09-25.md`](../../../research/frontier-ui-2026-09-25.md).
