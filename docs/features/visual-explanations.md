# Visual explanations

## Purpose

Visuals lets Niko ask AVA to explain a repository, request path, workflow or
branching process as a progressive presentation. The source of truth is small
and inspectable:

- restricted Mermaid flowchart text owns topology;
- versioned storyboard JSON owns scenes, captions, highlights, transitions and
  optional interaction cues; and
- storyboard references use the stable node IDs declared in Mermaid.

Generated HTML, SVG and PNG are disposable presentation artifacts. They are
never canonical state and are not persisted by the server.

## Authoring contract (v1)

The canonical schema version is `1.0`. Mermaid is deliberately limited to
`flowchart`/`graph` with one of `TD`, `TB`, `LR`, `RL` or `BT`, explicit nodes,
and `-->`, `-.->` or `==>` edges. Supported node shapes are process, decision
and terminal. Stable IDs must start with a letter, contain only letters,
numbers, `_` or `-`, and be unique.

A storyboard contains a `startSceneId` and one or more scenes. Every scene has
an ID, title, caption, bounded node list, optional highlighted subset,
`none`/`fade`/`slide` transition and optional cue. Validation requires:

- every scene and highlight reference to resolve to a declared Mermaid node;
- highlights to be a subset of the scene;
- every topology node to appear in at least one scene;
- no duplicate IDs;
- at most 80 topology nodes, 20 scenes and 14 nodes per scene; and
- more than one scene when the complete topology would exceed the per-scene
  limit, enforcing progressive disclosure rather than a giant first view.

The parser rejects Mermaid directives, click/href/style/link directives, HTML,
scripts, JavaScript/data URLs, external URLs and CSS `url()` input. Canonical
text passes through AVA's secret scrubber before storage.

## Agent and API path

Text and voice action turns expose:

- `visual_explanation_create` to validate, persist and return an exact visual ID;
- `visual_explanation_list` to find existing presentations without returning
  their complete source.

When creation succeeds, Chat reads the structured tool result—not assistant
prose—and opens the exact result in **Visuals**. Niko can also open Visuals and
enter a subject; AVA receives a normal chat request to build it.

Authenticated API routes:

- `GET /api/visual-explanations?limit=...`
- `GET /api/visual-explanations/:id`
- `POST /api/visual-explanations`

SQLite stores only schema versions, sanitized title/summary/Mermaid/storyboard,
lineage, version and timestamps. A sanitized source fingerprint makes repeated
identical creation idempotent.

## Rendering and security

The web client projects one bounded scene from canonical topology and renders
it with the Mermaid package bundled into AVA. The output is sanitized again
with an inert SVG allow-list, then embedded through `srcdoc` in an iframe with
an empty `sandbox` attribute, `no-referrer`, and a restrictive CSP:

- no scripts;
- no network connections;
- no forms, frames, media, objects or fonts;
- no external images; and
- inline style only for the sanitized local SVG.

The frontend never executes generated HTML and never gives the iframe
same-origin or script privileges. Exports are explicit browser-local actions:
SVG downloads use the sanitized active scene, while PNG uses a local canvas.

## Accessibility and offline behavior

- Captions are visible outside the diagram.
- Previous/next, scene tabs, Arrow Left/Right, Home and End navigate scenes.
- The active scene is announced through a polite live region.
- Reduced-motion preference removes scene movement and transition delay.
- Every explanation includes a complete static text fallback listing all scenes,
  captions, node labels and highlights.
- Mermaid and every renderer chunk are part of the PWA precache. The renderer
  therefore works without a CDN after installation. The most recent 20 loaded
  explanations are cached locally so already-seen canonical sources remain
  viewable while AVA's server is temporarily unreachable.

## Verification and limitations

Deterministic fixtures cover a repository map, a request-path walkthrough and a
branching approval process. Server tests cover grammar/schema validation,
stable references, security rejection, authenticated routes, idempotence and
tool lineage. Web tests cover scene projection, sanitizer/CSP boundaries,
sandboxing, captions, keyboard navigation, static fallback, offline cache and
automatic opening from a structured tool result.

V1 does not include OpenFlowKit, Dashmotion, Manim/ManimML, Excalidraw,
video, narration, free-form Mermaid syntax or editable rendered artifacts. A
visual proves that AVA stored and presented the supplied structure; it does not
independently prove the described system is correct.
