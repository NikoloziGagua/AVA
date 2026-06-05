# Ava frontend — improvement ideas from 21st.dev

**Date:** 2026-06-05
**Who did this:** Claude Code (me) browsed 21st.dev, screenshotted components and
Ava's own interface, and wrote these ideas. This is *not* the autonomous Ava agent
acting — it's research for Sir to approve before anything is built.

**Method:** surveyed the 21st.dev community gallery across the categories that map
to Ava's surfaces — Shaders (15), Backgrounds (33), AI Chats (30), Texts (58),
Spinner/Loaders (21) — captured the relevant components, then captured Ava's live
interface (paired a temporary device to get past the login wall) for side-by-side
comparison.

**Guiding constraint:** the locked aesthetic stays — liquid-mercury orb + cyan
command-deck, desktop-primary, GSAP backbone. These are taste-driven picks to
*deepen* that language, not replace it. Notably, three components already in Ava
(`jakobhoeg/message-loading`, `hextaui/shining-text`, `jatin-yadav05/etheral-shadow`)
come straight from these same 21st.dev authors — so staying within this cluster
(kokonutd, aceternity, danielpetho, motion-primitives, hextaui) keeps one coherent
design family.

---

## Where Ava stands now (from the live captures)

- **Home / command-deck** — strongest surface. Tubelight nav, the brushed-metal
  orb, AVA wordmark, perspective dotted surface, cyan command bar. Premium.
- **Chat** — good: ethereal-shadows background, cyan glass user bubbles, Ava
  replies with orb avatar, quick-chips composer. Solid after today's work.
- **Chats list** — the weakest surface. Flat dark rows, no previews, no hover life,
  no grouping. Visibly less finished than everything around it.
- **Voice** — orb-centric (not re-captured live; known from code).
- **Splash / pairing** — on-brand (curved light streaks, cyan submit, mono type).

---

## Ideas, by surface (highest impact first)

### 1. The Orb — make "liquid mercury" literal
The orb is the brand. Today it's a beautiful but largely *static* brushed sphere.
Two component techniques would make it feel alive:

- **`danielpetho/gooey-filter`** (Backgrounds) — an SVG gooey/metaball filter.
  Apply it to the orb's rim particles and state-transition blobs so highlights and
  satellites *merge and separate like real mercury*. This is the single most
  on-brand upgrade available — it literally makes the metaphor real.
- **`dhiluxui/aura-core` / `celestial-sphere` / `dhiluxui/living-nebula`** (Shaders)
  — a WebGL energy core *inside* the orb for the `thinking`/`working` states (a
  breathing, churning center) instead of a flat gradient. **Perf note:** gate it to
  active states only and pause it at rest — WebGL every-frame is exactly the kind of
  "sluggish" layer to avoid leaving always-on.
- **`aceternity/sparkles`** — faint sparks shed from the orb while listening/working;
  cheap, compositor-friendly, adds life without WebGL cost.

### 2. Home background — depth behind the dotted surface
The dotted perspective grid is great; behind it the field is fairly flat.

- **`unicorn_studio/raycast-animated-background`** (blue / red-blue variants) — the
  premium Raycast aurora. The blue variant slots straight into the cyan deck and
  gives the home real atmospheric depth. (Unicorn Studio renders are GPU shaders —
  one instance, home only.)
- **`aceternity/aurora-background`** — softer, cheaper aurora wash in cyan/violet if
  the Raycast shader is too heavy. Same mood, less cost.
- **`kokonutd/beams-background`** — god-ray beams emanating from behind the orb, so
  the orb reads as the light source of the whole deck. Strong thematic fit.

### 3. Chats list — bring it up to the command-deck language
This is the highest *return* fix because it's the most behind.

- Reskin rows as **glass cards** (match the chat bubbles' material) with a **cyan
  hover glow**, a **last-message preview** line, and **date grouping** (Today /
  Yesterday / Earlier). Pattern references: `kokonutd` card/list components and the
  Cards category (79 items).
- Add a real **empty state** (21st "Empty States") for the no-chats case instead of
  a blank screen.

### 4. Composer / command bar — fold actions in
Ava already has quick-chips; 21st has more refined input patterns:

- **`motion-primitives/prompt-input` (with-actions)** and
  **`kokonutd/ai-input-with-suggestions` / `ai-input-with-file`** — a single input
  that carries action chips, attachments, and a refined send/▌ affordance in one
  tidy control. Good fit for both the home command bar and the chat composer.
- A **`rafa-porto/command-palette`** (⌘K) to jump to any chat / screen / action —
  this is the most "command-deck"-true addition on the whole list: it makes the
  metaphor functional, not just visual.

### 5. Voice mode — show the listening
- **`kokonutd/ai-voice-input`** — a waveform/amplitude affordance for the listening
  state. Ava already computes mic amplitude (`useMicAmplitude`); wire it to a visible
  **reactive ring around the orb** so speaking visibly drives the orb. Big perceived-
  responsiveness win for the signature surface.

### 6. Loading states — stop showing blank
- Use a **skeleton loader** (Spinner/Loader category) for session/message and memory
  loads instead of empty space, and consider the shadcn **spinner variant set** (the
  default/ring/bars/ellipsis pack) to standardize the small spinners in the Activity
  panel and elsewhere.

---

## Suggested order (if Sir wants to proceed)

1. **Chats list reskin** — biggest gap, no perf risk, pure polish.
2. **Orb gooey-filter + amplitude ring** — deepens the brand, moderate effort.
3. **Home aurora/beams background** — high wow, watch GPU cost (pick aurora if the
   Raycast shader is heavy).
4. **Composer/command-palette** — functional command-deck upgrade.
5. **Orb WebGL core + skeleton loaders** — nice-to-haves, gated for perf.

I did **not** build any of this — these are proposals. Say which ones land and I'll
implement them (taste-driven, not literal ports), respecting the locked aesthetic.

## Appendix — components captured (21st.dev slugs)

- **Shaders:** `unicorn_studio/raycast-animated-background`,
  `unicorn_studio/raycast-red-blue-animated-background`, `dhiluxui/aura-core`,
  `dhiluxui/celestial-sphere`, `dhiluxui/living-nebula`, `dhiluxui/aurora-borealis-shader`,
  `easemize/spooky-smoke-animation`, `aliimam/shader-animation`.
- **Backgrounds:** `danielpetho/gooey-filter`, `aceternity/aurora-background`,
  `kokonutd/beams-background`, `kokonutd/background-circles`, `kokonutd/background-paths`,
  `Kain0127/spiral-animation`, `aceternity/sparkles`, `jatin-yadav05/etheral-shadow` (already in Ava).
- **AI Chats:** `simple-ai/chat-input`, `motion-primitives/prompt-input` (with-actions),
  `kokonutd/ai-input-with-suggestions`, `kokonutd/ai-voice-input`,
  `rafa-porto/command-palette`, `rafa-porto/ai-assistant-interface`,
  `jakobhoeg/message-loading` (already in Ava), `hextaui/shining-text` (already in Ava).
- **Loaders:** shadcn spinner variant set, skeleton loaders, `kokonutd/ai-input-with-loading`.
