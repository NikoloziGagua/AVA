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

The semantic model owns meaning and topology. React Flow is the native
interactive renderer and Dagre creates a disposable directed layout for the
active scene; neither owns or mutates semantic state. Mermaid remains a
restricted backward-compatible ingest format only. Generated layout, SVG and
PNG are disposable browser artifacts and are never canonical state.

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

For the active scene the client derives typed React Flow nodes and edges directly
from the validated semantic model. Dagre positions that disposable projection.
Labels are rendered as React text, not injected markup, and renderer payloads
are never executed or inserted into the DOM. Generated HTML, JavaScript and
provider-authored SVG are never run. Each card has isolated viewport, scene and
selection state, so multiple inline visuals do not share mutable renderer state.

The server also rejects active legacy Mermaid syntax, directives, click/href,
style/link directives, HTML, JavaScript/data URLs, external URLs and CSS `url()`.
Secret scrubbing occurs before persistence. Client schema validation protects
API, cache and history inputs before rendering.

## Interaction and accessibility

- Visible captions and optional cues accompany every scene.
- Buttons, scene tabs, Arrow Left/Right, Home and End navigate scenes.
- Native controls, wheel/pinch and pointer drag provide fit, zoom and pan;
  selecting a node highlights its directly connected branch without messaging AVA.
- React Flow exposes keyboard-focusable nodes and controls. Reduced-motion mode
  removes scene/edge motion while preserving state changes and focus behavior.
- The complete static text fallback lists the summary, scenes, elements and
  relationships and remains available if rendering fails.
- SVG and PNG export are explicit, browser-local actions for the active scene.
- Expanded mode is an in-app modal, not a new window. It preserves the exact
  revision, scene and selection and restores chat scroll/focus on return.

Zoom, pan, hover, scene animation and unsubmitted selections stay local. Only
the explicit **Explain this**, **Ask AVA about this branch**, and **Attach selected
context** actions create a structured context envelope. The server revalidates
the exact revision, scene and selected semantic IDs, derives the prompt text from
stored labels, and rejects stale or invented context. Attach places a visible
context chip above the composer; it is sent only with the next submitted message.

## Offline and performance behavior

React Flow, Dagre and the browser-local export helper are bundled into AVA's PWA
build/precache, so rendering needs no CDN after installation. The last 20
validated VisualMessages are cached locally for reopening while the server is
unavailable. Only the active bounded scene is projected; larger graphs use
visible-element rendering and a minimap, multiple visuals keep separate state,
and AVA never persists the generated layout or exported image.

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

## Research VisualMessage v2

Deep research uses the same immutable VisualMessage revision and inline-chat
path, but schema `2.0` adds an evidence-grounded, renderer-neutral research
artifact. The canonical record contains the research question, automatic versus
explicit form selection, written synthesis, methodology, limitations, sources,
claims, semantic entities, storyboard, renderer metadata and accessible text.
Every source has a direct HTTP(S) URL and quality classification. Every visual
entity carries claim/source IDs, confidence, evidence status and an uncertainty
note. Sources, claims, entities, relations, scenes and highlights are checked for
duplicate or dangling IDs before anything is stored.

The supported forms are:

- `geographic_map`: sourced longitude/latitude locations, directed routes,
  approximate regions, time layers and a legend;
- `timeline`: events with explicit exact/year/range/approximate/unknown date
  precision and causal or chronological links;
- `evidence_matrix`: region/topic cells labelled strong, moderate, weak,
  missing or disputed;
- `claim_evidence_graph`: claims, sources, counterevidence, objections,
  disputed points and evidence gaps;
- `chart`: sourced bar, line or range points, including nullable unavailable
  values and explicit low/high uncertainty; and
- `process`: mechanisms, architectures, workflows and branching decisions.

`research_visual_create` is the deep-research write tool. AVA first researches
with ordinary source-reading tools, then selects the form from the question and
evidence. An explicit user form wins and the differing automatic recommendation
is retained. Validation rejects a semantic model that does not match that
selection. Generic argument/claim questions default to a claim-evidence graph;
geographic movement/regions, chronology, evidence coverage, quantities and
mechanisms select their specialized forms. The separate authenticated
`POST /api/visual-explanations/research` route is the manual typed boundary.
Updates require both `revisesVisualMessageId` and `expectedRevision`; a stale
revision receives `409` without writing.

## Rendering and map data

All v2 renderers consume the semantic model; the small renderer payload is only
validated metadata (`renderer`, `read_only`, `claim_level`) and is never
executed. Charts, timelines and matrices use native SVG/HTML. Claim and process
graphs reuse the existing React Flow/Dagre projection. Geographic maps use
bundled D3 Geo with a Natural Earth projection, `world-atlas` land geometry and
TopoJSON conversion. This produces a genuine spherical geographic map from
sourced coordinates—routes are not a left-to-right flowchart with place labels.

The 1:110m Natural Earth land data is public domain and its attribution is shown
in the map and exports. D3 and TopoJSON dependencies are permissively licensed.
All code and basemap data are bundled into the production/PWA build: no map API,
tile key, CDN, network stylesheet, provider HTML, WebGL worker or generated
script is needed after installation. MapLibre was intentionally not used for
this first slice because its WebGL/CSP workers and external tile/style lifecycle
would add a larger online and security boundary without improving the bounded
research-route use case.

Regions are honest rectangular evidence zones, not asserted historical borders.
V2 rejects inverted and antimeridian-crossing boxes rather than rendering them
incorrectly; split rectangles or a future sourced polygon form are required.
Location precision and optional uncertainty distance are visible, uncertain
routes are dashed, route direction is shown with arrows, and scene changes select
the best matching time layer. The user can still choose a different layer
without messaging AVA.

## Research-result interaction

Each scene shows at most fourteen entities and at most eight highlights, and
every semantic entity must occur in at least one scene. The inline card keeps the
written synthesis, method, limitations and source panel synchronized with the
selected exact revision. Selecting an entity reveals its claims, direct source
links, confidence, evidence status and uncertainty. Only explicit Explain,
Ask-about-selection and Attach actions send exact revision/scene/entity context
back to AVA; layer selection, zoom, pan, hover and animation remain local.

The card supports scene tabs and Arrow/Home/End navigation, focusable map/chart
entities, reduced-motion rendering, responsive/narrow layouts, in-app expansion,
and browser-local SVG/PNG export. A complete textual scene/source view is always
available. A specialized-renderer exception is caught at the card boundary and
replaced with a labelled static entity fallback rather than breaking Chat.

## Privacy, persistence and observability

Schema limits bound all collections and text. The server recursively secret-
scrubs all persistable research strings, removes URL credentials/fragments and
sensitive query parameters, and never stores generated HTML, scripts, SVG, PNG,
raw browser/provider payloads or hidden reasoning. The client independently
validates schema, renderer/form compatibility, direct URLs, coordinate/range
bounds, relations, scene coverage and the allowlisted renderer payload before
rendering API, history or offline-cache data.

Planning, validation, persistence and safe failure emit idempotent normalized
Mission Control events under the initiating AVA chat run. These events expose
form, counts, revision, status and error boundary—not the raw research prompt or
source bodies. Existing AVA/Codex/Claude communication traces remain visible
through Mission Control's provider-neutral run/event model; research visuals do
not add a second telemetry store or a hidden communication route.

V1 and v2 rows coexist in `visual_message_revisions`; the schema version selects
the decoder, so existing Mermaid/flow VisualMessages and legacy rows remain
readable. Assistant message metadata stores only the exact ID/revision and
session reload hydrates that immutable v2 artifact. List/cache/workspace paths
accept both versions.

## Adding a future visual form

Add one discriminated semantic model to server and client types, define its
evidence-bearing entity collection and relationship checks, add its strict
provider-facing tool schema, map it to a bundled inert renderer, and add scene,
fallback, security, persistence and renderer-failure tests. Canonical data must
remain independent of layout/output artifacts. Paid/proprietary renderers,
generated HTML/JavaScript, fabricated coordinates/dates/quantities and
consequential verification replays are not acceptable fallbacks.

Current limitations: the selection heuristic is deterministic rather than a
separate classifier model; maps use regional points, routes and rectangular
zones rather than country-boundary choropleths or arbitrary polygons; chart
axes are intentionally compact rather than a full statistical workbench; and
source quality labels record AVA's assessment but do not independently prove a
source is correct. If specialized evidence is absent, AVA must present the
written/static fallback and name what is missing instead of inventing data.
