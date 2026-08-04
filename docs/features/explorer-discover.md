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
