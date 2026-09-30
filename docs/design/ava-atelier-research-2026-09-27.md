# AVA Design Atelier — light, material, time and thought

27 September 2026 · Discussion preview, not a production release.

## The point of view

**Current decision, after Niko's review:** preserve Calendar/Notes layouts; use Nocturne and Silver Silk; Notes must be dark. All four initial cards were rejected. The original comparisons below remain history, not current recommendations. Round 03 adds six new card structures, four navigation motion studies and three text-chat compositions, all in the same isolated preview.

Keep the calm layout Niko liked. Change the things he did not: indiscriminate card containers, flat blue backgrounds, heavy nested inputs and a Notes workspace without a strong reading identity. A premium assistant can be expressive at its edges and quiet where someone thinks.

The proposed split is **an atmospheric assistant, a precise calendar, and an editorial notebook**. They share typography, compact actions and restrained material details, but do not need identical backgrounds. The first decision is visual direction; live migration comes after agreement.

## Research that changed the design

These are first-party references reviewed for specific decisions, not a claim to reproduce their products. Public reference screenshots were captured locally for Linear, Notion Calendar, Craft, Paper and Reflect. No website artwork, component source or proprietary assets were copied.

| Reference | Useful lesson | Applied here |
| --- | --- | --- |
| [Linear: latest design refresh](https://linear.app/now/behind-the-latest-design-refresh) | Consistent navigation and headers make a dense application feel calmer; subtle structure is preferable to heavy framing everywhere | Common tab/header structure, restrained navigation, fewer competing containers |
| [Notion Calendar](https://www.notion.com/product/calendar) | Make time the primary canvas and connect schedule context with documents | Day/week/month time views, time-proportional events, linked sample lecture notes |
| [Craft](https://www.craft.do/) | Give the document a deliberate reading surface, with organisation around it rather than over it | Space → folder → note list → editorial page; focus mode |
| [Reflect](https://reflect.app/) | Search and connections help recover a line of thought | Body search, explicit connected-note links, proposed conversational handoff |
| [Raycast](https://www.raycast.com/) / [themes](https://manual.raycast.com/themes) | Compact, keyboard-oriented controls can still feel tactile | Small metallic actions, keyboard search, visible focus, minimal command chrome |
| [Paper shaders](https://shaders.paper.design/) / [liquid metal](https://shaders.paper.design/liquid-metal) / [fluted glass](https://shaders.paper.design/fluted-glass) | Light can suggest material without making the content itself move | Original liquid-ribbon, fabric and window-light Canvas2D studies; no new shader package |
| [Magic UI Magic Card](https://v3.magicui.design/docs/components/magic-card) | A pointer-following highlight can give a surface presence | Small local sheen that never distorts or moves the text |
| [21st](https://21st.dev/) | A wide palette of interaction studies is useful for comparison | Reviewed as a catalogue; no dependency installed and no component authorship claimed |

The preview is original HTML/CSS/JavaScript, not a GodUI/Paper/21st component port. Niko's earlier liquid-metal examples inform the material direction, but this study does not claim to reproduce their exact shader implementation.

## Four backgrounds

| Direction | Actual motion | Best role / trade-off |
| --- | --- | --- |
| **01 Nocturne** | Fine silver ribbons bend and catch light across graphite | My Home/Voice recommendation: expressive without a coloured wash. Keep the production face clearly separated from bright ribbons |
| **02 Deep field** | Stars travel outward, with a warm orbital horizon | Closest to Niko's forward-moving dots. More explicitly futuristic; use sparingly around dense reading |
| **03 Silver silk** | Fine threads flex into a metallic fabric | Strongest material statement. Better as a focal surface than behind every workspace |
| **04 Daybreak** | Slow warm-violet illumination and angled window light | A different, light direction for reading and planning; does not assume Niko has approved a light production theme |

All are real motion studies, not screenshots. One Canvas2D context, capped pixel ratio, bounded particles/paths. Manual pause and operating-system reduced motion are supported. Rendering stops while the document is hidden. Reduced motion keeps a static frame. There is no WebGL or video dependency.

## First four cards — rejected, retained as comparison history

| Direction | Distinction | Recommendation |
| --- | --- | --- |
| **01 Milled alloy** | Machined edge, brushed graphite, large numerical time, integrated action | Everyday assistant cards; the least distracting dark option |
| **02 Optical glass** | Floating secondary pane, softened edge, raised action | Short important content, not entire essays; text stays on a readable dark bed |
| **03 The editorial** | Warm paper, serif title, restrained rules, asymmetric corner | Notes, summaries and longer reading |
| **04 Living folio** | Staggered layers, a vertical count rail, explicit next-card button | A small related collection; never the only way to access a large library |

The default comparison is the same lecture, not different content disguised as different designs. Background/card selectors allow all 16 pairings. Shortlisting and JSON export record preferences locally, not production approval.

## Calendar: time, not a wall of cards

The week is the desktop canvas. The day is the small-screen default. A month overview moves directly into the selected day. The desktop side rail makes the selected day's attendance intent and connected notes easy to inspect.

- Events occupy their actual time span; overlapping events partition into deterministic columns.
- Desktop pointer drag selects a 15-minute-snapped range. Nothing is saved until the editor is submitted.
- A title-first editor supports date, start, duration, category, location and attendance intent, including independent study.
- Existing blocks can be moved with native desktop drag/drop and undone. Editing the date/time works without dragging, including on touch devices.
- Lecture events link directly to the corresponding sample note.
- The date, current-time line and briefing are explicitly illustrative. “Today” means the fixed sample day, **28 September 2026**, not the machine's current date.

This is a design interaction model, not a calendar implementation proposal to create a new store. A production version must use AVA's existing calendar/reminder contract, version checks and authoritative data. Recurrence, external calendars, notifications, DST conversion and scheduling conflict resolution are not implemented in this preview. Dublin is the intended local zone; the preview deliberately does not claim timezone conversion.

## Notes: a place to return to your thinking

The document leads. Metadata and folder navigation support it. On desktop the hierarchy, list and document sit together. On narrow screens the library and reading view become separate, with a clear return action and a folder selector.

- Sample spaces and folders organise named documents. Folder identity includes the space, so repeated folder names do not merge unrelated lists.
- Search covers title, subtitle and body; pinned notes sort first.
- A readable page provides headings, paragraphs, lists, explicit related notes and optional focus mode.
- New/edit supports title, subtitle, space, folder and text. Changing space/folder demonstrates reorganisation. Saved fixture edits survive reload.
- “Think through this with AVA” opens a clearly labelled proposed context handoff. It does not manufacture an answer or call AVA.

The demo is intentionally smaller than AVA's real notes model: one visible folder level, basic text formatting, no collaboration, attachments, full editor, undo history or real memory integration. Future production work must preserve the existing hierarchy and immutable/versioned data rules, not replace them with this local fixture format.

## Superseded first-round recommendation

The initial proposal was Nocturne + Milled alloy and Daybreak + The editorial. **Niko rejected those cards and requested dark Notes. Do not implement that recommendation.** The Calendar/Notes layouts and Nocturne/Silk atmospheres survive; the card decision is reopened.

The comparison catalogue intentionally scrolls; it is not production Home. Niko's no-scroll Home requirement remains intact. The face and compact conversation bar are not rebuilt in this study; it focuses on the newly rejected surfaces and the two requested workspaces.

## Decision boundary

Niko has chosen the two atmospheres and approved the workspace layouts. Card, navigation and text-chat choices remain open. Niko confirmed in room #798 that Claude is out of tokens and Codex should continue alone; delivery of these previews does not wait on Claude. No independent peer acceptance is claimed. A scoped production integration remains a later decision. No live backend, web dist, existing design contract, real data, unrelated local files or other repository was changed for this study.

## Round 03 — stronger silhouettes and interaction

Additional first-party research, reviewed 27 September 2026:

| Reference | Interpretation used in these original studies |
| --- | --- |
| [Rauno's Craft studies](https://rauno.me/craft) / [interface guidelines](https://interfaces.rauno.me/) | Spatial controls and toolbar transformations suggest coherent motion between states. Moving selection is decorative; destination buttons stay stable. |
| [Magic UI Dock](https://magicui.design/docs/components/dock) | Proximity-based magnification informed a dock whose icons rise while the click targets and labels stay fixed. Keyboard focus receives equivalent emphasis. |
| [Aceternity expandable cards](https://ui.aceternity.com/components/expandable-card) / [resizable navigation](https://ui.aceternity.com/components/resizable-navbar) | Progressive reveal can change the amount of information, not just the shadow. The living index and command capsule use explicit native controls. |
| [React Bits catalogue](https://www.reactbits.dev/get-started/index) | Dock, Pill Nav and reflective-card directions broadened the shape vocabulary. No React Bits code or runtime was imported. |
| [Vercel Geist tabs](https://vercel.com/geist/tabs) | Legible selection and consistent targets matter more than the travel effect. The rail's highlight settles on the exact selected button. |
| [assistant-ui](https://www.assistant-ui.com/) / [Linear AI](https://linear.app/ai) | Conversation can remain readable while exposing relevant context nearby. The studio shows an explicit sample source, not speculative AI thoughts or invented tool activity. |

Public screenshots of Rauno Craft, Magic UI Dock, Aceternity expandable cards and assistant-ui supplement the earlier captures in ignored `data/builds/atelier-references/`. These are design references, not licensing claims, component ports, or assertions that this preview runs those libraries.

### Six card structures

- **Open form:** borderless typography and an oversized time, held by a vertical axis rather than a box.
- **Signal:** a compact information strip, quiet pulse and traveling light; no animated text.
- **Cut / 03:** chamfered silver ticket, fine engraved texture and integral action. My strongest expressive option.
- **Time object:** circular metal instrument; decorative light moves, but it does not imply live event progress.
- **Twin plane:** separate silver time plane and graphite context plane, with restrained hover alignment.
- **Living index:** compact list row expands into context. My strongest everyday option when there are several items.

Every design uses the same fixed lecture so the comparison is about structure. The lower gallery contains all six, and a browser-local shortlist survives reload. Previous card studies are explicitly archived.

### Four navigation studies

**Liquid rail** moves a silver selection beneath stable labels. **Proximity dock** lifts icons near pointer/focus. **Command capsule** unfolds a compact object into four destinations and supports Escape/focus return. **Light trace** uses almost no surrounding chrome, just a traveling underline. All four work in the navigation stage and around any text-chat composition. No production navigation contract changes.

### Three text-chat pages

**Quiet voice** is an open single-column conversation. **Thinking studio** adds an adjacent source panel. **Editorial thread** gives the question and answer a more asymmetric typographic hierarchy. The same answer makes comparison fair. A source drawer, explicit sample-context disclosure and draft suggestions are interactive.

Drafts survive layout/navigation/reload. Only explicit Enter/submit adds text, and the result is labelled a local preview message. Shift+Enter and IME composition do not submit. There is no artificial assistant reply, tool call, memory write or external request. This is not an implementation of AVA chat persistence.

### Approved atmosphere mapping and Notes

Nocturne is used for Cards, Talk, Calendar and Research; Silver Silk for Navigation and Notes. Notes retains its hierarchy/list/reader layout, now with graphite surfaces, readable cool-silver metadata and a dark editor. No automatic theme cycling interrupts reading. Calendar's existing interaction model is retained; its editor is also dark to fit the environment.

### Current recommendation, subject to Niko's choice

Try **Cut / 03** for one important item, **Living index** for a collection, **Liquid rail** for predictable everyday navigation, and **Quiet voice** for normal conversation. Thinking studio is the richer alternative when a source needs to remain visible. These are opinions to compare in the live preview, not a claim of user approval.

### Verification and remaining limitations

Original native HTML/CSS/ES modules; no new package, generated HTML execution or production import. Unit and Edge suites cover all design combinations, keyboard selection, capsule focus return, local text exactness/escaping, reload, 320/390/1440 widths, pause/reduced motion, forced colors, and unchanged Calendar/Notes CRUD. Selected Notes metadata is checked against the brightest list surface at 4.5:1; this is not a full accessibility certification. Screenshots are inspected after animation settles. No physical phone, Safari, real screen-reader or live assistant behavior is claimed. Peer critique and Niko's design choice remain separate from builder test results.

See [running and verification](previews/ava-atelier-2026-09-27/README.md), and [the rejected references](not%20good/README.md).
