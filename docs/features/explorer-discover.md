# Explorer Discover

## Purpose

Explorer must work for two audiences without confusing either:

1. A first-time visitor asking, “What can AVA actually do for me?”
2. An operator asking, “How does it work, is it ready, and what evidence exists?”

Discover is the first layer. The existing Capability Atlas, workflow trees,
runtime readiness, task inspection and health evidence remain the deeper layers.

## Information architecture

The primary navigation is deliberately small:

- **Discover** — outcome-led introduction and runnable examples
- **Map** — complete capability domains, details and workflow trees
- **Activity** — task history, live work and learned workflows
- **Health** — current readiness and reliability evidence

Review and evolution foundations remain available from Activity as advanced
evidence views, but they no longer compete with the four useful entry points.

## Discover model

Capabilities are introduced through five user outcomes:

- Talk naturally
- Control my computer
- Use my web and accounts
- Remember and organise
- Build and automate

Every pillar maps to capability IDs in `web/src/explorer/registry.ts`. Runtime
labels come through `runtimeForCapability`; the showcase does not manufacture a
second readiness model. Example prompts launch a normal new AVA request. A setup
or unavailable state opens the capability detail instead of launching an action
that is already known to be unavailable.

The request-to-proof strip communicates AVA's operating model in four steps:

```text
You ask -> AVA routes -> AVA acts -> AVA checks
```

This is an explanation of observable execution, not hidden reasoning.

## 2026-09 newcomer remodel

The verified model above remains intact, but the entrance no longer presents
every idea as an equally weighted dashboard card. The remodel adopts a guided
editorial structure:

1. **Editorial promise** - an asymmetric opening frame explains that AVA can
   act, remember and show evidence, with four concrete defining abilities in
   the first viewport.
2. **Live system portrait** - a lightweight CSS/SVG constellation connects AVA
   to the five outcome areas. Node labels and status summaries come from the
   same registry/runtime adapter as the rest of Explorer; the connector graphic
   is decorative and never substitutes for textual status.
3. **Real starting actions** - four examples launch through normal AVA chat.
   Known setup-required or unavailable examples open their capability evidence
   instead of pretending they can run.
4. **Progressive capability chapters** - one of the five outcome stories is
   visible at a time. Each chapter shows a plain-language operational flow,
   exact registry capabilities with live readiness and launchable examples.
5. **Evidence ladder** - declared capabilities, mapped workflows, runtime
   checks and task records are presented as different evidence levels. A task
   count is explicitly not described as verified success.

The full Atlas, Activity and Health views remain the deeper operational system.
The remodel changes hierarchy and comprehension, not the source of truth.

The design research and rejected alternatives are recorded in
`docs/reviews/2026-09-01-explorer-remodel-design-research.md`.

## Interaction and accessibility

- Outcome selection uses a real tablist/tab/tabpanel relationship.
- Arrow keys move to adjacent outcomes; Home and End move to the first and last.
- Orbit nodes are optional shortcuts to the same chapters and have complete
  accessible labels including their summarized readiness.
- No content auto-advances.
- Ambient connector movement is CSS-only and stops under
  `prefers-reduced-motion: reduce`; AVA's in-app reduced setting also parks the
  shared panel animation in its final state.
- At narrow widths the hero, actions, chapters and evidence sections reflow to
  one column. The 2D system portrait stays contained inside its own card and
  does not cause page-level horizontal scrolling.

## Truth and privacy boundaries

- A source declaration is not shown as proof of successful use.
- Configured, ready, partially ready, setup required, unavailable and unknown
  remain distinct.
- Capability examples only reference real registry entries.
- Runtime counts and task counts come from Explorer APIs.
- Forge is not a dependency or data source for this surface. No Forge agents,
  runs, costs, controls or developer-routing concepts are displayed here.
- Existing Explorer redaction and evidence limitations continue to apply.

## Acceptance criteria

- Explorer opens on Discover rather than the architecture map.
- Within the first screen, a newcomer can identify at least three concrete AVA
  abilities and understand that AVA takes actions rather than only chatting.
- Every showcased capability ID exists in the real Explorer registry.
- A runnable example opens a new AVA request with the full prompt.
- Known unavailable/setup-required examples route to capability details.
- Map navigation preserves its domain/capability/back path.
- Activity exposes task history, live work and learned workflows.
- Runtime status and evidence failures do not remove the static capability map.
- The layout works at 1440x900 and 390x844 without page errors.
- Explorer contains no Forge-facing integration or terminology.
