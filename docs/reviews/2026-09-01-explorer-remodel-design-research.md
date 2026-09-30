# Explorer newcomer remodel - design research

Date: 2026-09-01

## Product question

How can Explorer explain AVA to someone who knows nothing about it while still
remaining an evidence-backed operational source of truth for an experienced
operator?

## Sources reviewed

- Niko's local `C:\Users\nikug\awwwards-showcase.html` was inspected as a
  rendered 1440px composition and as source. Its useful ideas are the asymmetric
  hero, one oversized editorial statement, quiet metadata, one high-energy
  accent, clear chaptering, and a manifesto that explains the design's point of
  view. The page itself says good design is pace, surprise, clarity and a point
  of view. No site code or proprietary project imagery is copied into AVA.
- Linear's 2024 UI redesign describes reducing visual noise while increasing
  hierarchy, aligning navigation and testing the direction across complete
  views rather than isolated components:
  https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear's 2026 refresh argues that supporting chrome should recede, structure
  should be felt rather than announced by many borders, and elements should not
  compete for attention they have not earned:
  https://linear.app/now/behind-the-latest-design-refresh
- Nielsen Norman Group's progressive-disclosure guidance recommends showing the
  important features first and deferring advanced detail; this improves initial
  learnability without removing expert depth:
  https://www.nngroup.com/articles/progressive-disclosure/
- W3C's Reflow guidance requires ordinary content to remain usable in one
  direction at 320 CSS pixels, and W3C technique C39 describes respecting the
  operating system's reduced-motion preference:
  https://www.w3.org/WAI/WCAG21/Understanding/reflow
  https://www.w3.org/WAI/WCAG21/Techniques/css/C39.html

## Diagnosis of the current Discover surface

The current page is honest and substantially better than the old registry-first
Explorer. Its content model is sound: five outcome pillars, runnable examples,
live readiness labels, a route-to-action explanation and explicit evidence
language. The main weakness is presentation. Almost every idea is placed in a
similar rounded card, so the page reads as a long dashboard rather than a
guided introduction. All five pillars demand attention at once, important
copy is small, and the capability story is not visually memorable.

## Direction selected

1. **One editorial promise first.** The opening frame says in plain language
   that AVA can converse, act across the computer, remember context and show its
   work. Oversized type creates the visual anchor; live facts remain secondary.
2. **A live system portrait, not a stock hero image.** A lightweight CSS/SVG
   capability constellation gives the hero a distinct AVA visual while its
   labels and status values still come from the real registry/runtime adapter.
3. **Five chapters, one at a time.** A keyboard-operable outcome selector shows
   one story panel at a time: examples, a short observable workflow and the
   underlying real capabilities. This is progressive disclosure rather than a
   grid of five equally loud cards.
4. **Try before taxonomy.** A small set of real prompts appears before the full
   domain map. Known setup-required or unavailable capabilities open their
   detail rather than launching a request.
5. **Explain the truth ladder.** Declared source, mapped workflow, live runtime
   check and recorded task evidence remain visibly distinct. Counts are never
   presented as proof that all capabilities work.
6. **Keep operational depth intact.** Map, Activity and Health are not replaced.
   The redesign changes the entrance and hierarchy; the existing Atlas,
   workflow trees, tasks and health views remain the deeper system.

## Motion and accessibility boundaries

- Motion is limited to ambient signal lines, focus transitions and direct
  interaction feedback. It does not auto-advance content.
- `prefers-reduced-motion: reduce` removes ambient and smooth movement.
- Outcome chapters use real tab semantics, arrow/Home/End keyboard movement,
  visible focus and an associated tab panel.
- The visual system portrait has textual labels and does not carry unique
  information in decorative connector lines.
- The composition becomes one column at narrow widths and must not create page
  level horizontal scrolling at 390px or 320px-equivalent reflow.

## Acceptance checks

- A newcomer can identify AVA's four defining qualities in the opening frame:
  converse, act, remember, prove.
- The five outcome chapters map only to registry capability IDs.
- A chapter exposes both a plain-language workflow and drill-down to exact
  capability details.
- Runnable prompts use the normal chat route; unavailable/setup-required prompts
  open evidence/setup details.
- Map, Activity and Health retain their prior behavior.
- Tab semantics, keyboard navigation, reduced motion and narrow reflow are
  covered by deterministic tests and a deployed-browser check.
