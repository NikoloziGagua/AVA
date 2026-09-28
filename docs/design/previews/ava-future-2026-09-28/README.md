# AVA · Future (28 Sep 2026)

This is a hub of nine clickable concept previews for Niko's request 47, which he accepted in the room: "explore the highest-value ideas, find impressive futuristic stuff, lots of previews". They are ranked by daily value × wow × fit with AVA today. The ranking is based on Claude's research brief (room messages 1329–1330) and Codex's feasibility review (task 86).

**These are previews only.** Every page uses invented data (a fictional startup idea called "Tabby", fictional people and opportunities). Each page ends with a "what's demo / what would be real / how it plugs into AVA / grounding" block. Nothing here imports AVA code, calls AVA or any provider, or changes live AVA.

## Open it

From the AVA repository root:

```powershell
node docs/design/previews/ava-future-2026-09-28/serve.mjs 5180
```

Then open http://127.0.0.1:5180/. You can also open `index.html` straight from disk. That works too, but the Geist fonts only load when the pages are served.

## The concepts

| # | Page | In one line |
| --- | --- | --- |
| 01 | Decision Replay | Scrub back through an idea's turning points: the decision, the alternatives, your confidence and its evidence, then a review against what happened |
| 02 | Challenge Room | Four critics (investor, engineer, customer, competitor) or a premortem attack your plan. "The reasoning holds" is a valid outcome |
| 03 | Future You | Hypothetical 2–5-year branches from goals you confirm, plus a chat with "you at 26". Not a prediction |
| 04 | Morning Command Center | An overnight brief, then your spoken plan becomes blocks and nudges. The evening review keeps done, moved and skipped distinct |
| 05 | If-Then Nudges | "When X, then Y". Every trigger is labelled time-based or observed, and a calendar end time is not proof you finished |
| 06 | Opportunity Radar | Sources you pick, matched to your goals; each match dated and sourced |
| 07 | Generative Views | AVA builds a small interactive tool (a decision board you can re-weight) |
| 08 | Knowledge Galaxy | A 3D constellation of goals, projects, decisions, notes and people; the spectacle layer on top of Decision Replay |
| 09 | Capture Anywhere | Share a link or a voice memo; it's filed with a receipt, undo and offline-safe retries |

The recommended build order is on the hub page: capture first, then the daily loop (04 + 05), then Decision Replay + Challenge, then Future You.

## Boundaries

- Static HTML, CSS and one classic script (`shared.js`). No frameworks, CDNs, packages, network requests or storage.
- Reduced motion is respected (the starfield and animations freeze), and text is at least 12px.
- External links open only on click. Freshness-sensitive facts (hackathon dates, product status) are dated and marked to check at the source.
- `serve.mjs` serves only this folder and AVA's bundled fonts, on 127.0.0.1, read-only.
