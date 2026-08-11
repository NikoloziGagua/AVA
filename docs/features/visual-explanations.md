# Inline visual explanations

## Product contract

When Niko asks AVA to explain a repository, request path, workflow or branching
process visually, the explanation appears as first-class interactive content
directly beneath AVA's answer in Chat. The separate **Visuals** screen remains an
optional workspace for browsing and reopening visuals; it is not the default
presentation path.

Each assistant message stores an exact `{ visualMessageId, revision }` reference.
Session reload resolves that immutable revision, so a later conversational edit
does not silently rewrite an earlier answer.

## Canonical VisualMessage v1

The canonical source is renderer-neutral `VisualMessage` JSON:

- `visualMessageId`, positive `revision`, `schemaVersion` and `diagramKind`;
- `semanticModel.elements` and `semanticModel.relationships`, each with stable IDs;
- a versioned `storyboard` with scenes, captions, referenced IDs, highlights,
  transitions and optional interaction cues;
- validated renderer metadata and a disposable renderer payload; and
- an AVA-generated accessible static fallback.

The semantic model owns meaning and topology. Mermaid is the first renderer and
legacy ingest format, not the source of truth. Generated Mermaid, SVG and PNG are
disposable browser artifacts and are never canonical state.

Stable IDs start with a letter and contain only letters, numbers, `_` or `-`.
Validation rejects duplicate and dangling element, relationship, scene and
highlight references. Scenes are bounded and every semantic element must be
covered, which enforces progressive disclosure instead of a giant diagram.

## Agent, revision and persistence path

- `visual_explanation_create` accepts the preferred semantic model or the
  backward-compatible restricted Mermaid ingest shape, validates it, and stores
  an immutable VisualMessage revision.
- A conversational change such as “add the database” or “show only auth path”
  sends the complete revised model with `revisesVisualMessageId` and
  `expectedRevision`. A stale expected revision receives a typed `409` and does
  not overwrite current state.
- Chat trusts only a successful structured tool result, confirms the referenced
  visual belongs to the same session/run path, and attaches the exact revision
  to the final assistant message.
- Message metadata and VisualMessage revisions live in SQLite. Session history
  returns hydrated exact revisions for reload.
- `visual_explanation_list` and the Visuals workspace reopen existing revisions
  without regenerating them.

Authenticated routes are:

- `GET /api/visual-explanations?limit=...`
- `GET /api/visual-explanations/:id?revision=...`
- `POST /api/visual-explanations`

Legacy visual rows remain readable and are converted to the v1 semantic model at
the state boundary. New writes use `visual_message_revisions`.

## Native rendering and security

The chat uses a native React card rather than the earlier iframe. Reusing the
iframe would have required a second cross-frame state/event protocol for sizing,
scroll anchoring, selection, expansion and semantic actions. Native rendering
keeps those states in one component and met the stricter interaction gates with
less security surface.

For the active scene the client derives a small Mermaid projection from the
validated semantic model, renders it with AVA's bundled Mermaid dependency in
strict mode, and sanitizes the returned SVG again at the injection boundary. The
allow-list removes scripts, foreign HTML, event handlers, links, external URLs,
`data:` references and unsafe CSS. Generated HTML and JavaScript are never run.
Unique title/description IDs keep multiple inline SVGs accessible.

The server also rejects active legacy Mermaid syntax, directives, click/href,
style/link directives, HTML, JavaScript/data URLs, external URLs and CSS `url()`.
Secret scrubbing occurs before persistence. Client schema validation protects
API, cache and history inputs before rendering.

## Interaction and accessibility

- Visible captions and optional cues accompany every scene.
- Buttons, scene tabs, Arrow Left/Right, Home and End navigate scenes.
- `+`, `-` and `0` control zoom; pointer drag pans only while zoomed.
- Reduced-motion mode removes transitions.
- The complete static text fallback lists the summary, scenes, elements and
  relationships and remains available if rendering fails.
- SVG and PNG export are explicit, browser-local actions for the active scene.
- Expanded mode is an in-app modal, not a new window. The same card instance
  preserves revision, scene, zoom and selection and restores chat scroll/focus
  on return.

Zoom, pan, hover, scene animation and unsubmitted selections stay local. Only
the explicit **Explain this**, **Ask AVA about this branch**, and **Attach selected
context** actions create a structured context envelope. The server revalidates
the exact revision, scene and selected semantic IDs, derives the prompt text from
stored labels, and rejects stale or invented context. Attach places a visible
context chip above the composer; it is sent only with the next submitted message.

## Offline and performance behavior

Mermaid and renderer chunks are part of AVA's PWA build/precache, so rendering
needs no CDN after installation. The last 20 validated VisualMessages are cached
locally for reopening while the server is unavailable. Inline rendering is lazy
per active scene; a message with several visuals uses separate unique render IDs
and never persists the generated result.

## Verification and limitations

Deterministic server fixtures cover repository maps, request paths and branching
processes. Tests cover semantic/stable-ID validation, immutable revisions, stale
guards, assistant-message attachment, reload hydration, explicit context,
security filtering, multiple/narrow visuals, keyboard and reduced motion,
expansion state, semantic actions, fallback, offline cache and builds.

V1 intentionally defers direct canvas editing, OpenFlowKit, Dashmotion,
Manim/ManimML, Excalidraw, video and narration. Conversational revision is the
editing model. Voice can create a VisualMessage through the existing tool path,
but voice's `persist:false` delegated action path does not yet attach that visual
to a spoken transcript; it remains available in the Visuals workspace. A visual
proves that AVA validated and presented the supplied structure, not that the
described external system is factually correct.
