# Ava — Capabilities

The comprehensive reference for everything Ava can do. Ava also carries a tight
first-person summary of this in its system prompt every turn (source:
`server/src/orchestrator/capabilities-content.ts`) so it reliably recalls its own
reach. Keep that constant and this document in step when capabilities change.

Ava is a single-tenant personal AI agent: a Node/TypeScript Express server
(`server/` — the agent runtime and tool host) plus a Vite/React 19 PWA (`web/` —
the phone interface). It runs on the owner's Windows PC and is controlled from a
phone over Tailscale. The owner is addressed as "Sir". It is provider-agnostic:
OpenAI (default) or Anthropic.

---

## 1. Conversation & Voice

**Text chat** — `POST /api/chat` starts a run; replies stream over Server-Sent
Events (`thought`, `tool_call`, `tool_result`, `final`, `approval_required`, …).
Typed messages always run in **action mode** (full tools).

**Voice** — fully hands-free through one continuous OpenAI Realtime session.
- The realtime model **speaks directly** for low latency and holds a single
  `do_on_computer` tool. Chitchat stays in the realtime conversation; any real
  action runs the full `/api/chat` tool agent over loopback, then its final result
  returns to the **same** realtime session and `marin` voice. Tool steps are visual
  only, so a task never changes speaker halfway through.
- **Responsiveness follows the Fast/Thorough toggle:** OpenAI semantic VAD uses
  eager endpointing in Fast mode and more patient endpointing in Thorough mode.
- **True interruption:** speech onset immediately cancels the active response,
  stops queued playback, truncates the assistant item at the amount actually
  heard, and rejects late audio packets from the cancelled response.
- **Transcript gating:** a pure-function chokepoint drops empty/too-brief/
  low-confidence transcripts and known whisper hallucinations ("you", "thank you",
  "thanks for watching", …) before they ever become a turn — no phantom replies.
- **Speech smoothing:** the commas hugging a standalone "Sir" are stripped for
  spoken output only ("Yes, Sir," → "Yes Sir"), never for stored/displayed text.
- STT `gpt-4o-transcribe`; TTS `gpt-4o-mini-tts`; realtime `gpt-realtime-2.1`.

## 2. Acting on the PC — Tools

Most tools are exposed only in **action mode** (conversation mode sees the memory
tools plus `read_claude_updates`). The agent loop runs until the task is done; a
high turn cap (default 1000, env-overridable via `AVA_MAX_AGENT_TURNS`) is only a
runaway backstop — the real brakes are the Stop button, a 5-minute no-progress
stuck-loop detector, and per-tool timeout budgets. (The old hard 48-turn cap was
lifted because it cut off real multi-step tasks mid-work.) Every
call passes a risk policy: read-only/low → run; medium/high → **ask first** (an
approval row + a push notification, blocking up to 10 minutes). `.env` access and
`--dangerously-skip-permissions` are hard-blocked regardless.

| Tool | What it does | Safety |
|---|---|---|
| **shell** | Run a shell command (cmd.exe). Allowlisted first tokens only: `git, npm, node, python, pip, where, echo, ls, dir, cat`; shell metacharacters (`; & \| \` $ > <`) blocked. | Non-allowlisted = ask; `rm -rf`/`git push`/`curl\|sh`/`sudo` = high. `.env` blocked. |
| **fs_read / fs_write / fs_list / fs_stat / fs_delete** | Read/write/list/stat/delete files within allowlisted roots (`C:/ai/**`, `C:/projects/**`, `Downloads/**`). Writes create parent dirs. | Reads read-only; write low; **delete always asks**. `.env` blocked. |
| **chrome_open / _navigate / _click / _type / _press_key / _read_page / _screenshot / _tabs** | Open/foreground and drive a single **persistent, non-headless Chrome/Edge** that keeps Sir's cookies/logins. On a fresh request Ava runs `scripts/start-ava-browser.cmd /quiet` herself, attaches to that dedicated CDP profile, and reuses it while alive. Direct Playwright launch remains the fallback. | Mostly low; clicks that look like submit/checkout/buy/place-order/add-payment = high. |
| **computer_use** | Vision-driven control of the screen when no direct tool fits (screenshot → decide → click/scroll/type → loop). Prefers Anthropic computer-use, falls back to OpenAI. **The OpenAI path needs the gated `computer-use-preview` model** — accounts without it get a 404, so `look_at_screen` is the reliable everyday eyes. | Medium. |
| **claude_code** | Spawn a headless `claude -p` worker for multi-file coding in an allowlisted project dir (`acceptEdits`; uses the Claude subscription login). | Medium; dangerous-skip blocked; output secret-scrubbed. |
| **take_screenshot** | Capture a PNG of the Windows desktop under `Downloads/Ava/screenshots` and return **only the path** — the model has *not* seen the image. Its description and result say so plainly, so Ava never narrates a screenshot it can't actually see (fixes a live case of Ava confidently "describing" screenshots it never viewed). | Low. |
| **look_at_screen** | Ava's honest eyes: capture the desktop **and** run ONE vision call on a standard multimodal model, returning a factual 2–4 sentence description (or an answer to a specific `question`). This is what Ava uses to describe the screen or verify a visual result. Registered **only when an OpenAI key is set**; 60 s tool budget. | Medium (a paid vision call). |
| **memory_read / memory_remember / memory_forget** | Durable cross-session memory (see §3). | Low; secrets scrubbed on write. |
| **memory_index_capture / memory_index_search / memory_index_open / memory_index_forget / memory_index_correct / memory_index_pin / memory_index_supersede / memory_index_conflict** | Automatically index completed research and meaningfully developed ideas, preserve immutable linked checkpoints, recover source-linked work across chat/voice, and let Sir correct the compact view, pin priorities, replace obsolete threads or resolve contradictions without rewriting original evidence. | Search/open are read-only; governance is versioned, append-only and low-risk local persistence. Unresolved conflicts and superseded history are excluded from automatic recall; privacy scope and source verification fail closed. |
| **notes_capture / notes_search / notes_update / notes_promote** | Capture, find and organise general or project Notes; move cards through Ideas/Doing/Review/Done; promote a note to a task or explicit self-improvement request. | Note changes are low-risk local persistence. Self-improvement promotion enters the existing approval gate. |
| **visual_explanation_create / research_visual_create / visual_explanation_list** | Create, revise or reopen progressive inline visuals. Ordinary mechanisms use the stable-ID process model. Deep research automatically chooses a genuine geographic map, timeline, evidence-gap matrix, claim-evidence graph, sourced chart or process diagram and carries claim-level sources, confidence, disagreement and gaps into every scene. | Low-risk local persistence. Inputs are schema-validated and recursively secret-scrubbed; renderers never execute generated HTML/JavaScript and work offline after installation. |
| **strategy_room_open** | Move the authoritative current AVA chat snapshot into the shared Niko + AVA + Codex Strategy Room. | Low-risk, bounded discussion only. Returning an approved conclusion adds a proposal to the source chat and never executes it. |
| **self_improve / self_improve_status** | Queue an autonomous change to Ava's own code / report task states (see §4). | Gated pipeline. |
| **read_claude_updates** | Read the notes Claude — Sir's developer/coding agent — leaves about changes to Ava's own code (a started/shipped/note JSON-lines log at `<dataDir>/claude-updates.jsonl`). Used when Sir asks what's happening / what changed / what Claude did; surfaces any in-flight update. Available in **both** action and conversation/voice mode. Attribution stays honest — Claude's work is Claude's. | Read-only. |
| **shopify_list_products / shopify_get_product / shopify_update_product** | Edit a product's name + description over the **Shopify Admin API** — one `PUT`, no browser. Never sends the `images` array (a name/description edit can't disturb the pictures), and instructs the model to keep any `<img>` tags inside the description. Registered only when `SHOPIFY_STORE` + `SHOPIFY_ADMIN_TOKEN` are set. | No LLM cost (uses Shopify billing). |
| **find_places** | Find real businesses via the **Google Places API** — name/address/phone/website/Maps link, with a precise "without a website" filter. Replaces blocked Google-Maps scraping. Registered only when `GOOGLE_PLACES_API_KEY` is set. | No LLM cost (uses Google billing). |
| **watch_create / watch_list / watch_delete** | Register/list/delete a standing background **watch** — "notify me if/when X" (price drop, restock, site change, weather, delivery). The tools just manage the record; a scheduler runs each check later as a real agent turn and push-notifies Sir on a trigger. See §5. | No LLM cost to register; **each check is a paid agent run**. |

**Rules.** Sir can write natural-language autonomy rules (in the Rules screen)
that pre-allow, pre-deny, or force-ask specific kinds of actions, overriding the
default risk tiers.

## 3. Memory (durable, cross-session)

Stored as markdown + SQLite under the data dir. What persists: persona,
preferences, observations, project notes, learned playbooks, the friction ledger,
the Fast/Thorough preference, sessions/messages, device tokens, push
subscriptions, rules, and self-improvement intents.

- **Observations** carry a date, confidence (low/medium/high), and category;
  re-observing bumps confidence; superseding marks the old line. Auto-pruned when
  over budget (drops superseded, then stale low-confidence).
- **Secret scrubbing** runs on every write (API keys, bearer tokens, AWS keys,
  `password/secret/token:` lines).
- **Projects:** a matching project note auto-loads as context when a prompt or
  tool path mentions its roots.
- **Source-linked research, idea and improvement index:** completed research and ideas
  meaningfully developed by Sir and AVA are conservatively captured after a
  clean typed or spoken turn; every committed product improvement is reconciled
  from its exact reachable Git commit, and successful Self swaps enter through
  the same boundary. Explicit "remember this" remains available. AVA
  stores compact immutable checkpoints in SQLite plus
  the exact conversation range and a fingerprint. Retrieval combines semantic
  similarity with exact/keyword evidence, explains why an item matched, and
  refuses to treat it as usable if the original messages changed or vanished.
  An OpenAI embedding is used when configured; keyword retrieval remains an
  honest fallback. Automatic capture is replay-idempotent and excludes routine,
  failed, contradicted, cancelled and interrupted work. Completed read-only
  research may preserve an honest unverified-evidence limitation. Later material
  Idea changes retain thread/parent/sequence/type/reason lineage; superficial
  continuation does not create another checkpoint. Failed or uncommitted work,
  docs/test-only commits and conversation claims are never promoted as shipped
  improvements.
- **Playbooks (procedural memory, evidence-gated):** after a run reaches a
  terminal receipt with an independently **verified task outcome** and ≥2 tool
  steps, a side model distills it into a playbook —
  short canonical trigger, keywords, success-path steps, and **`lessons[]`**
  (avoidance advice mined from failed/blocked detours, e.g. *"Google bot-walls
  automation — go straight to wttr.in"*). On a later matching request the steps +
  lessons are recalled. Recall is **lexical token-overlap** (instant, free — no
  side-model call per turn), so a pure paraphrase with no shared words may not
  recall (precision over recall, by design). Playbooks record verified, partial,
  unverified, contradicted, failed, and not-applicable outcomes separately. A
  final response or executor `ok` never counts as proof. Re-learning a task
  **merges** only after verified evidence; contradiction or repeated verified
  failure demotes it. Old `succ`/`fail` values remain visible only as legacy
  reports. `GET /api/playbooks` lists the evidence metrics; `DELETE
  /api/playbooks/:slug` removes one. Routine playbooks are followed directly;
consequential ones are followed but verified.

See [Verified learning gate](features/verified-learning-gate.md) for evidence,
idempotency, privacy, compatibility, and current verifier coverage.

### Structured Notes workspace

The **Notes** navigation section is a shared workspace for Sir and AVA. It has a
General space plus explicit project spaces that remain visible even before their
first note. Each project uses the same lightweight template: Quick capture,
Pinned priorities, Decisions, and Documentation. A four-column board moves work
through Ideas, Doing, Review, and Done.

Notes retain structured content, tags, safe links, pinned state, edit history,
source and an optimistic version number. AVA can capture and reorganise Notes
from ordinary text or voice requests. A note may be promoted into a prefilled AVA
task or an approval-gated self-improvement request without deleting or rewriting
the source note. Saving or promoting a note never implies that the downstream
task is complete. See `docs/features/notes.md` for the data and safety contract.

### Progressive visual explanations

Visual explanations appear directly beneath AVA's answer in Chat. The **Visuals**
navigation section remains an optional workspace for browsing and reopening
them. Ask AVA to "explain this visually" or start from the workspace; a successful
tool result attaches its exact immutable revision to the assistant message, and
conversation reload restores it.

Canonical state is a versioned renderer-neutral VisualMessage: stable semantic
elements and relationships, a storyboard, validated renderer metadata and an
accessible fallback. React Flow renders a native interactive canvas and Dagre
creates its disposable scene layout; neither replaces the semantic source of
truth. Mermaid remains a restricted legacy ingest format only. AVA stores no
generated HTML, SVG or PNG. The native card projects one scene locally and
supports captions, selection, keyboard access, reduced motion, zoom/pan, an
optional minimap, in-app expansion and explicit SVG/PNG export. Explicit
Explain/branch/attach actions send server-validated visual context; ordinary view
state remains local. The renderer is PWA-precached and recent validated messages
are cached for offline reopening. See `docs/features/visual-explanations.md`.

For substantial research, schema v2 keeps the written synthesis, methodology,
limitations, source-quality panel and visual entities in one immutable artifact.
AVA selects the form from the question/evidence unless Sir explicitly asks for
one. A migration, conflict or trade-route request uses an actual offline Natural
Earth geographic projection with sourced coordinates, directions, periods,
regions, legends and geographic uncertainty. Timelines retain date precision;
charts retain ranges and unavailable values; matrices and claim graphs make
weak, disputed and missing evidence visible rather than smoothing it away.
Mission Control records sanitized planning, validation, persistence and failure
stages under the initiating run.

## 4. Self-Improvement

Ava can rewrite, verify, and hot-swap its own code.

**Lifecycle:** `queued → reflecting → [awaiting_approval] → implementing →
verifying → swapped` (=shipped/live), or `failed` / `rolled_back`. User-asked
improvements pause at `awaiting_approval` for Sir's Approve/Reject; the overnight
loop skips that gate.

**Pipeline:**
1. **Single-flight queue** — only one improvement mutates the tree at a time;
   concurrent requests stay `queued` and run in turn (FIFO). `self_improve_status`
   reports exactly where each one is.
2. **Reflect** into a concrete change brief.
3. **Isolate** in a fresh `git worktree` under the temp dir.
4. **Implement** with a headless `claude -p` worker confined to that worktree.
5. **Verify** — `npm test` → web build → server build → **boot-smoke** (start the
   built server on a scratch port and assert `/api/health`).
6. **Commit + hot-swap** the live tree (dev `tsx watch` auto-reloads).
7. **Watchdog** — a detached process polls health for ~45 s and auto-reverts to the
   last known good if the new build is unhealthy.

**Triggers:** explicit (`self_improve` tool / `POST /api/self/improve` / the Self
screen's goal box), the **friction ledger** (`trigger:"friction"` — real failures
become grounded goals), or schedule. The unattended **overnight loop** (`npm -w
server run self:loop`) now **drains the friction ledger first** — grounded evidence
before invented ideas — and only then asks its persistent Claude chat for a
low-risk idea; a shipped friction fix closes its ledger entry (a recurrence reopens
it). *Honest limit:* today the ledger's only writer is self-improvement's own
failures, which the loop skips — so there is not yet a path from a Sir-facing
correction into the ledger. The `failure` trigger constant is unused.

**Self-changelog:** every shipped change appends one line to `memory/changelog.md`,
so Ava keeps a durable record of how it has evolved (and hands recent history to
the Claude worker so it doesn't undo past fixes).

**Hard guard:** Ava cannot propose or ship any change that touches its own
security, policy, auth, approval, sandbox, path-allowlist, secret-scrub, or the
self-improvement safety machinery — it cannot weaken its own guardrails.

**Control surface:** the Self screen shows the journal plus a **goal box** (type
what to improve), a **real Pause/Resume** toggle with an `ACTIVE`/`PAUSED` chip
(server-side gate — while paused, both intake points refuse new work; the flag is
in-memory and gates intake only, not a running job or the overnight process), a
**Stop** button on any running improvement, an **Approve & run / Reject** panel for
a plan parked at `awaiting_approval`, and **Revert last**. API: `GET /api/self`
(now returns `paused`), `POST /api/self/improve`, `POST /api/self/pause`,
`POST /api/self/:id/cancel|approve|reject|revert`.

## 5. Long-term monitoring (Watches)

Ava can keep watching after a conversation ends. A **watch** is a standing
"notify me if/when X" — a price drop, a restock, a site change, weather, a
delivery. Sir asks once in natural language; Ava calls `watch_create` with a
self-contained check prompt and interval; a background scheduler re-checks it and
push-notifies Sir when the condition fires.

- **Each check is a real agent turn.** The scheduler POSTs the check to Ava's own
  `/api/chat` over loopback (internal token), so a check gets the full toolset and
  is recorded as an **openable chat session** Sir can audit step by step.
- **Marker protocol.** The check must end with `WATCH: TRIGGERED — …` or
  `WATCH: OK — …`; `TRIGGERED` fires a web-push and disables a one-shot watch (the
  default). A missing marker records `unclear` and does **not** notify (a missed
  alert beats a false one).
- **Frugal by design.** Each check spends real LLM (and any tool) budget, so the
  tool guidance pushes 15–60 min intervals and one-shot defaults; there is no hard
  spend cap.
- **Only runs while Ava is running.** In-process `setInterval`, no cloud cron, no
  back-fill; disabled entirely if no LLM provider is configured.
- **Surface:** conversational (`watch_create`/`watch_list`/`watch_delete`) plus the
  push notification. A JSON API exists (`GET/POST/DELETE /api/watches`) for a future
  screen. Full write-up: `docs/features/watches.md`.

## 6. Web Interface (PWA)

React 19, phone-first, reached over Tailscale. A shared liquid-mercury **Orb**
animates between surfaces (GSAP Flip).

- **Home / command-deck** — moving dotted + nebula backdrop, glass tubelight nav
  (New / Chats / Memory / Explore / Rules / Self), the Orb hero, AVA wordmark,
  command bar, and a visible "Explore what AVA can do" entry point.
- **Chat** — streaming messages, ethereal-shadows background, word-by-word answer
  reveal, a 3-dot thinking indicator, and a live **Activity panel** that shows the
  running tool steps while Ava works.
- **Voice mode** — orb-centric, captions, mute, push-to-talk, inline approvals.
- **Capability Center / Explore** — a searchable map of AVA's capabilities,
  examples, and live readiness for the brain, voice, persistent browser, memory,
  account workflows, optional APIs, watches, and self-improvement. It polls every
  15 seconds, explains the exact browser helper step when needed, and never exposes
  secrets or account identifiers.
- **Mission Deck** — one-tap, readiness-aware prompts for a memory mirror, account
  check, automation scout, desktop pulse, recent-update briefing, and a rotating
  useful/fun side quest. Unavailable missions cannot launch accidentally.
- **Sessions / Chats list**, **Memory view** (editable persona/preferences/
  observations/projects), **Rules** (autonomy rules + Fast/Thorough), **Self**
  (self-improvement journal with a goal box to queue an improvement, a real
  Pause/Resume with an `ACTIVE`/`PAUSED` chip, Stop, plan Approve/Reject, and
  Revert-last).
- **PWA** — installable, service worker, push notifications with Approve/Deny
  actions that deep-link into the relevant approval.

## 7. Auth, Push, Networking

- **Auth** — phone pairs with a 6-char code (systray-minted, 5-min TTL) and gets a
  bcrypt-hashed device token; devices are listable/revocable.
- **Push** — VAPID web-push for approval requests (Approve/Deny inline); dead
  subscriptions auto-pruned.
- **Networking** — binds to the Tailscale IP on port 8787, serving the built PWA +
  API. Happy-eyeballs tuning (RFC 8305) prevents IPv6-only/NAT64 phone-hotspot
  networks from stalling every OpenAI/realtime connection.

## 8. Known nuances

- GPT-Live is OpenAI's newest ChatGPT voice experience, but it is not currently a
  public API model. Ava uses the newest public Realtime API model available to
  developers, `gpt-realtime-2.1`, with the recommended `marin` voice.
- `server/src/self/SELF.md` is the knowledge given to the **self-improvement
  worker** — it is NOT part of the live conversational prompt. The live prompt is
  assembled by `buildSystemPrompt()` from the persona, this capability map, memory,
  and (in action mode) the tool rubric.
- Single-tenant by design: one shared Chromium context; a second concurrent run in
  the same session is rejected.
