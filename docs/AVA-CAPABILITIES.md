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

**Voice** — fully hands-free, two architectures (switched by `REALTIME_HYBRID`):
- **Transcribe-only (committed default):** the realtime model only does
  voice-activity endpointing + transcription; the browser submits the transcript
  to `/api/chat` and speaks the reply with TTS.
- **Hybrid (live via the gitignored `.env`):** the realtime model **speaks
  directly** for low latency and holds a single `do_on_computer` tool — for
  chitchat it just talks; for any real action it calls `do_on_computer`, which
  runs the **full `/api/chat` tool agent** over loopback and feeds the result back
  to be spoken. Talking and doing are one loop.
- **Responsiveness follows the Fast/Thorough toggle:** silence-wait is 300 ms on
  Fast (snappy) vs 700 ms on Thorough (patient — won't talk over you).
- **Transcript gating:** a pure-function chokepoint drops empty/too-brief/
  low-confidence transcripts and known whisper hallucinations ("you", "thank you",
  "thanks for watching", …) before they ever become a turn — no phantom replies.
- **Speech smoothing:** the commas hugging a standalone "Sir" are stripped for
  spoken output only ("Yes, Sir," → "Yes Sir"), never for stored/displayed text.
- STT `gpt-4o-transcribe`; TTS `gpt-4o-mini-tts`; realtime `gpt-realtime`.

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
| **chrome_navigate / _click / _type / _press_key / _read_page / _screenshot / _tabs** | Drive a single **persistent, non-headless Chromium** that keeps Sir's cookies/logins. Boots lazily on first use. | Mostly low; clicks that look like submit/checkout/buy/place-order/add-payment = high. |
| **computer_use** | Vision-driven control of the screen when no direct tool fits (screenshot → decide → click/scroll/type → loop). Prefers Anthropic computer-use, falls back to OpenAI. | Medium. |
| **claude_code** | Spawn a headless `claude -p` worker for multi-file coding in an allowlisted project dir (`acceptEdits`; uses the Claude subscription login). | Medium; dangerous-skip blocked; output secret-scrubbed. |
| **take_screenshot** | Capture a PNG of the Windows desktop under `Downloads/Ava/screenshots`, return the path (PowerShell + System.Drawing, PNG-validated). | Low. |
| **memory_read / memory_remember / memory_forget** | Durable cross-session memory (see §3). | Low; secrets scrubbed on write. |
| **self_improve / self_improve_status** | Queue an autonomous change to Ava's own code / report task states (see §4). | Gated pipeline. |
| **read_claude_updates** | Read the notes Claude — Sir's developer/coding agent — leaves about changes to Ava's own code (a started/shipped/note JSON-lines log at `<dataDir>/claude-updates.jsonl`). Used when Sir asks what's happening / what changed / what Claude did; surfaces any in-flight update. Available in **both** action and conversation/voice mode. Attribution stays honest — Claude's work is Claude's. | Read-only. |
| **shopify_list_products / shopify_get_product / shopify_update_product** | Edit a product's name + description over the **Shopify Admin API** — one `PUT`, no browser. Never sends the `images` array (a name/description edit can't disturb the pictures), and instructs the model to keep any `<img>` tags inside the description. Registered only when `SHOPIFY_STORE` + `SHOPIFY_ADMIN_TOKEN` are set. | No LLM cost (uses Shopify billing). |
| **find_places** | Find real businesses via the **Google Places API** — name/address/phone/website/Maps link, with a precise "without a website" filter. Replaces blocked Google-Maps scraping. Registered only when `GOOGLE_PLACES_API_KEY` is set. | No LLM cost (uses Google billing). |

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
- **Playbooks (procedural memory):** after a successful run with ≥2 tool steps,
  a side model distills it into `{trigger, keywords, steps}` and saves it; on a
  later matching request those steps are recalled to act faster and more reliably.
  Routine playbooks are followed directly; consequential ones are followed but
  verified.

## 4. Self-Improvement

Ava can rewrite, verify, and hot-swap its own code.

**Lifecycle:** `queued → reflecting → implementing → verifying → swapped`
(=shipped/live), or `failed` / `rolled_back`.

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

**Triggers:** explicit (`self_improve` tool / `POST /api/self/improve`), failure,
the **friction ledger** (records real mistakes and turns them into grounded
goals), or schedule. An **overnight loop** can propose its own low-risk
improvements via a persistent Claude chat and run them through the gated pipeline.

**Hard guard:** Ava cannot propose or ship any change that touches its own
security, policy, auth, approval, sandbox, path-allowlist, secret-scrub, or the
self-improvement safety machinery — it cannot weaken its own guardrails.

**Control surface:** the Self screen shows the journal with Pause/Resume and
Revert-last; `GET /api/self`, `POST /api/self/improve`, `POST /api/self/:id/revert`.

## 5. Web Interface (PWA)

React 19, phone-first, reached over Tailscale. A shared liquid-mercury **Orb**
animates between surfaces (GSAP Flip).

- **Home / command-deck** — moving dotted + nebula backdrop, glass tubelight nav
  (New / Chats / Memory / Rules / Self), the Orb hero, AVA wordmark, command bar.
- **Chat** — streaming messages, ethereal-shadows background, word-by-word answer
  reveal, a 3-dot thinking indicator, and a live **Activity panel** that shows the
  running tool steps while Ava works.
- **Voice mode** — orb-centric, captions, mute, push-to-talk, inline approvals.
- **Sessions / Chats list**, **Memory view** (editable persona/preferences/
  observations/projects), **Rules** (autonomy rules + Fast/Thorough), **Self**
  (self-improvement journal).
- **PWA** — installable, service worker, push notifications with Approve/Deny
  actions that deep-link into the relevant approval.

## 6. Auth, Push, Networking

- **Auth** — phone pairs with a 6-char code (systray-minted, 5-min TTL) and gets a
  bcrypt-hashed device token; devices are listable/revocable.
- **Push** — VAPID web-push for approval requests (Approve/Deny inline); dead
  subscriptions auto-pruned.
- **Networking** — binds to the Tailscale IP on port 8787, serving the built PWA +
  API. Happy-eyeballs tuning (RFC 8305) prevents IPv6-only/NAT64 phone-hotspot
  networks from stalling every OpenAI/realtime connection.

## 7. Known nuances

- The committed default voice mode is transcribe-only; **hybrid speaking is live
  via the gitignored `.env`** (`REALTIME_HYBRID=1`).
- `server/src/self/SELF.md` is the knowledge given to the **self-improvement
  worker** — it is NOT part of the live conversational prompt. The live prompt is
  assembled by `buildSystemPrompt()` from the persona, this capability map, memory,
  and (in action mode) the tool rubric.
- Single-tenant by design: one shared Chromium context; a second concurrent run in
  the same session is rejected.
