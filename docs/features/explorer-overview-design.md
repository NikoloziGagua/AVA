# Explorer — the in-depth overview of AVA

The design contract for turning Explorer from an honest *record* into an
in-depth, visual, immediately-understandable **overview of everything AVA is and
does**. Binding. Read this before writing any Explorer code.

Niko's brief, verbatim: *"as in depth overview of AVA as possible and easily
observable and understandable — has to have overview of every capability,
appropriate graphs trees charts, visual, so it's very easy to understand"* and
*"make the atlas look more lively"*.

---

## 1. The one principle that changes everything

**Explorer's knowledge of AVA must be DERIVED, never typed.**

Today `web/src/explorer/registry.ts` is 2,845 hand-written lines describing AVA.
It has already rotted: 11 declared symbols no longer exist, 6 declared API
routes are not served, and 3 real tools (`read_logs`, `computer_use`,
`do_on_computer`) are declared by no capability at all — so they are invisible
in the tool built to show you AVA's capabilities.

`scripts/explorer-reality-check.mjs` now resolves every claim against the real
source tree and emits `web/src/explorer/verified-manifest.json`. Everything the
interface presents as fact must come from that manifest or from runtime
evidence. A claim absent from the manifest is rendered as **declared, not
verified** — never with a green tick.

This is not a nicety. It is the difference between a poster of AVA and a mirror
of AVA, and it is the whole reason the feature exists.

---

## 2. Colour

AVA's identity palette stays exactly as it is for chrome (`--ac` cyan lead,
`--ac-live`, `--ac-exec`, `--ac-stop`). Those are UI accents and are far too
bright (OKLCH L ≈ 0.89) to encode data against black.

**Data gets its own palette**, validated with the dataviz validator against a
dark surface (`node scripts/validate_palette.js "<hex,…>" --mode dark`):

```
--dv-1: #0d9dbe   cyan-teal
--dv-2: #8a6bc9   violet
--dv-3: #1f9e6b   green
--dv-4: #b07d1e   amber
--dv-5: #c85f7f   rose
--dv-6: #4a76c4   blue
```

Verdict: lightness band PASS (all inside L 0.48–0.67) · chroma floor PASS ·
normal-vision ΔE 15.7 PASS · contrast ≥3:1 PASS · **CVD separation WARN
(ΔE 6.4 deutan)**.

That WARN carries a hard obligation: **the 6–8 CVD band is legal only with
secondary encoding.** Therefore every categorical chart in Explorer MUST carry
direct labels or a legend with the series name adjacent to its swatch — colour
alone may never be the only way to tell two series apart. This is not optional
styling; it is the condition under which this palette is permitted.

Assign `--dv-1..6` in **fixed order**, never cycled. A 7th series folds into
"Other" or becomes small multiples.

**Status colours are reserved and never used as series colours:**
`ready/healthy` → `--ac-live` · `degraded/partial` → `--ac-exec` ·
`unavailable/error` → `--ac-stop` · `unknown/not recorded` → `--ava-fg-muted`.
Every status also renders its WORD. Colour never carries a fact alone.

Sequential (one hue, light→dark) for magnitude — e.g. call-count heat.
Diverging (two hues + neutral grey midpoint) only for genuine polarity, e.g.
change-since-last-release. **Never a rainbow. Never a dual-axis chart.**

---

## 3. Form — which visual for which question

Chosen by the data's job, not by what looks impressive. Wrong form is worse than
no chart.

| Question | Form | Notes |
|---|---|---|
| What can AVA do, overall? | **System map** (the Atlas) | force-ish radial, domains → capabilities |
| How healthy is everything, at a glance? | **Status matrix / heatmap** | one cell per capability, status colour + word |
| How much of AVA is verified vs declared? | **Stacked bar, one row** | verified / declared-only / unmapped |
| Which tools does a capability use? | **Tree** (existing WorkflowMap) | plus observed-route overlay |
| How reliable is each tool? | **Horizontal bar**, sorted | failure rate; direct value labels |
| How long do things take? | **Box or p50/p95 dot-plot** | never a mean alone |
| Activity over time | **Line or area**, one axis | tasks/day; no dual axis |
| Where do runs die? | **Ranked bar** | last event before termination |
| One headline number | **Stat tile**, no chart | hero number + micro label |
| Progress through a run | **Waterfall / timeline** | per-event duration, wall-clock true |

Rules that apply to every chart: thin marks; recessive grid and axes; tabular
numerals; a legend whenever ≥2 series (and direct labels at ≤4); a hover
tooltip; a table fallback; wide content scrolls inside its own container so the
page never scrolls sideways.

---

## 4. The Atlas — make it live

The Atlas is the front door and must feel like looking at a living machine, not
a diagram. It keeps its three depths (overview / detailed / technical) and its
breadcrumbs.

**Structure.** Radial system map: `LIVING SYSTEM` core → 22 domain nodes →
capabilities. Keep the existing constellation feel; add meaning to every visual
property:

- **Node size** = number of capabilities in that domain.
- **Node ring** = health, as a ring arc — the proportion of its capabilities
  that are ready. Ring colour is a status colour, and the node also prints its
  count.
- **Edge thickness** = observed traffic (tool calls attributed to that domain in
  the window). An unused domain has a hairline; a busy one is thick. This is the
  single change that makes the map read as *alive* rather than *drawn*.
- **Verified vs declared** = fill treatment. A capability whose source
  references all resolve is solid; one with unverified claims is stroked with a
  dashed outline and says so on hover.

**Motion — meaning only, never decoration.**
- Live pulse travels along an edge when a task attributed to that domain is
  running. One pulse per active run. This is the heartbeat.
- Nodes settle in on mount with a 30ms stagger from the core outward.
- Hover raises a node and dims unrelated edges (focus, not sparkle).
- Depth changes cross-fade; the node you were looking at keeps its position so
  spatial memory survives.
- **`prefers-reduced-motion` kills all of it.** The map must be fully readable
  frozen — every fact is in size, colour, word or number, never in movement.

**Every domain node is clickable and every capability is reachable in ≤2
clicks.** 17 of 22 domains currently contain exactly one capability — when a
domain has one child, clicking the domain goes straight to the capability. No
full-screen page wrapped around a single card.

---

## 5. The capability page — the in-depth part

Opening any capability must answer, without another click:

1. **What it is** — name, domain, one-line purpose, stability.
2. **Is it real?** — verified source references from the manifest (file · symbol,
   each marked resolved ✓ or unverified), the tools it owns, the API routes it
   serves. Anything unverified is labelled, not hidden.
3. **Does it work?** — current readiness + health with its evidence and when it
   was checked; the words, not just the colour.
4. **How does it work?** — the operational workflow tree, with the observed
   route overlaid when a task is selected: nodes actually visited, declared but
   skipped (call out skipped *verification* steps explicitly), and off-map tool
   calls the workflow never declared.
5. **What has it actually done?** — runs attributed to it, first-attempt success
   rate, p50/p95 duration, tool reliability bars, last 10 runs as sparkline,
   deep links into those traces.
6. **What did it touch?** — side effects extracted from recorded events: files
   written, messages sent, commits made.

Sections 5–6 render honestly when empty: *"No runs recorded for this capability
yet"* — never a zero dressed as a measurement.

---

## 6. Vocabulary — one taxonomy, not two

The Atlas says 22 domains / 29 capabilities; Health says 6 / 15, with **zero ID
overlap**. Two answers to "what can AVA do" is the most confusing thing in the
product. Health must be rendered against the Atlas taxonomy; where a runtime
probe has no Atlas capability, that is a **finding to display**, not a second
vocabulary to invent.

---

## 7. Honesty rules that survive the redesign

These are not negotiable and every new surface inherits them:

- A run that produced a final response is `finished_unverified` — **never**
  "completed", and never a green tick.
- `not_recorded` is a real, displayable state. Never guess, never interpolate,
  never zero-fill a gap in a chart — break the line instead.
- Every percentage states its denominator and window in the visible label
  ("of the latest 100 runs"), never in a tooltip.
- Learned Workflows' "Success rate" currently counts *"emitted a final
  response"*. Rename to **"Reached final reply"** and drop the green check until
  a real verification event exists.
- The Reviews "candidate" filter currently selects 100% of tasks because it
  tests a field the server hard-codes. Fix or remove it; do not ship a counter
  that cannot vary.
- Honesty copy must be **legible**: minimum 11px at ≥60% white. The current
  9px/28% (~2:1 contrast) fails WCAG AA and hides the most important sentences
  in the product.

---

## 8. Non-negotiable engineering constraints

- **Never block the event loop.** better-sqlite3 is synchronous. The task list
  already full-scans all history per request (~2s at 9 months of data, re-fired
  every 8s). Page `explorer_tasks` first, then join only that page; denormalise
  counts onto the task row. Any new analytics endpoint must be indexed and
  bounded.
- **Redaction is not optional.** Anything new that persists event payloads goes
  through `server/src/explorer/redaction.ts` before storage, and again on read.
- **No fabricated data anywhere** — not in an empty state, not in a chart
  placeholder, not in a loading skeleton that implies a shape.
- Charts are hand-built SVG/CSS against these tokens. Do not add a charting
  dependency.
- Keyboard reachable, ARIA-labelled, and a table view behind every chart.
