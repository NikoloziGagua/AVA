# AVA Design Atelier — light, material, time and thought

27 September 2026 · Discussion preview, not a production release.

## The point of view

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

## Four cards — same content, different structure

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

## Recommended starting point

**Nocturne + Milled alloy** for AVA's presence. **Daybreak + The editorial** for Notes. Keep the Calendar precise and comparatively quiet. Deep field remains the strongest alternative if Niko wants the space motion to be the defining signature.

The comparison catalogue intentionally scrolls; it is not production Home. Niko's no-scroll Home requirement remains intact. The face and compact conversation bar are not rebuilt in this study; it focuses on the newly rejected surfaces and the two requested workspaces.

## Decision boundary

Niko chooses the background/card direction and critiques Calendar/Notes. Claude reviews the exact preview and test evidence when available. Only then does a scoped production integration make sense. No live backend, web dist, existing design contract, real data, unrelated local files or other repository was changed for this study.

See [running and verification](previews/ava-atelier-2026-09-27/README.md), and [the rejected references](not%20good/README.md).
