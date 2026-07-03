# Ava — Full Application Review (2026-06-10)

**Requested by:** the owner — "look at the whole application and review it," directed at **speed** (voice + text), **usability**, **efficiency**, and **task capability**, plus any other categories worth examining.
**Method:** five parallel review agents, each with one lens (voice speed, text speed, UX, task capability, efficiency + reliability), reading the codebase end to end. Code-only and read-only — no live latency measurements, no `.env` values read, token figures estimated at ~4 chars/token. Every claim below is cited to file:line in the appendices; this top section is the synthesis.
**Added categories:** reliability/crash-safety and observability/cost-telemetry, because both turned out to gate the four requested categories.

---

## Verdict

The foundations are genuinely strong: the Stop/kill chain works end to end (abort signals → PID tree-kill → orphan reaping at boot), error honesty is enforced at the model level, the prompt is structured cache-friendly, playbook learning from successful runs is a real differentiator, and the voice turn-taking engineering is careful and test-backed.

But the review found:

1. **One real regression** — the cloned voice (Chatterbox) is dead code; every narrated step is now paid OpenAI TTS.
2. **Three speed taxes that fire constantly** — a blocking 1–2 s playbook match on *every* typed turn, a 15 s approval stall on tools that were added *for speed*, and a 5-minute wallclock that kills any long task regardless of progress.
3. **One quiet money leak** — past 50 messages, every turn re-summarizes the entire transcript (O(N²)).
4. **Zero telemetry** — no token/cost accounting and no per-stage timing, so neither "why was that slow" nor "what did today cost" is answerable, despite OpenAI being the scarce resource.
5. **Capability ceiling** — the biggest missing assistant capabilities are email/calendar, scheduled/recurring tasks, background jobs, and desktop vision.

---

## Headline findings

### H1. Your cloned voice is dead code (likely-unintended regression)
The 3-way voice toggle (OpenAI/Chatterbox/Hybrid) shipped the morning of Jun 6 (`65e5bbd`) and was retired the **same day** by `777ecc0`, which made the toggle OpenAI/Hume. Today `/api/speak` always uses paid OpenAI `gpt-4o-mini-tts` (`server/src/routes/voice.ts:84-92`), the engine pref only accepts `openai|hume` (`server/src/state/voice-engine-pref.ts:13`), and `server/src/voice/chatterbox.ts` is referenced only by its own test. Net effect: the xmebi cloned voice is unreachable from Ava, and every narrated step in a voice task is a paid API call. The code still exists — re-wiring it for step narration is cheap and would zero that spend.

### H2. Every typed message pays a blocking 1–2 s LLM playbook match before Ava starts
`matchPlaybook` is an awaited gpt-5 call that runs before the agent loop begins *and* before the POST returns (`server/src/routes/chat.ts:258-286`, cap 8 s). With ~50 playbooks on disk it fires on every turn — including "thanks". Voice tasks pay it too (the loopback chat call doesn't set the voice flag, so it also runs at higher reasoning effort than intended — `server/src/index.ts:407-414`). This is the single biggest fixed latency item in the product. Fix: run it concurrently with the first model turn and inject the playbook only if it resolves in time, or replace the LLM match with local keyword/trigram scoring over the trigger strings.

### H3. Any task longer than ~5 minutes is killed, regardless of progress
The stuck-loop guard halts on the **first tool result arriving ≥5 minutes after run start** — even if every step succeeded (`server/src/orchestrator/stuck-loop.ts:64-67`; its own unit test confirms the semantics). This directly contradicts the lifted 1000-step budget ("real tasks must never be cut off mid-work", `agent.ts:146-153`) and the 10-minute `claude_code` budget: a 6-minute coding task finishes its edits, then the run is killed before the model can report. Fix: make it a true *no-progress* clock that resets on novel successful tool results.

### H4. A 15-second approval stall hits the tools that were added for speed
Unclassified tools default to medium tier → "ask" → a 15 s veto window per call (`server/src/policy/classify.ts:104`, `server/src/policy/runtime.ts:81-84`). That hits `find_places`, `read_logs`, `read_claude_updates`, `read_discussion`, `discuss_with_claude`, `self_improve_status` — and `claude_code` on **every call** (explicitly medium). The rules table that could rescue this contains exactly one rule and it failed to parse. In hybrid voice the stall is *silent* — the approval frame never reaches the user (`server/src/index.ts:454-455`). Fix: classify read/query tools as read-only/low (instant) and give API-read tools low tier; keep `fs_delete`, `shopify_update_product`, `self_improve` gated exactly as they are. The destructive blocklist is untouched.

### H5. A quiet O(N²) token burner in auto-summary
Once a session passes 50 messages, **every turn** re-sends the entire collapsed transcript to gpt-5 for re-summarization, because the cutoff moves each turn and the dedupe guard never skips (`server/src/orchestrator/auto-summary.ts:24-49`). Voice always resumes the most-recent session (`voice-realtime.ts:863-866`), so sessions get long. At ~300 messages this is ~15-40k side-model tokens *per turn* — likely the single biggest hidden OpenAI cost in the system. Fix: summarize incrementally (fold only new messages into the prior summary) on a stride (e.g., every 10 messages).

### H6. File editing is a corruption hazard
`fs_read` truncates at 8,192 chars with no offset/limit parameter (`server/src/tools/filesystem-mcp.ts:6,38`) and `fs_write` is full-overwrite only (`filesystem-mcp.ts:59`). Ava's natural read-modify-write loop on any file >8 KB **writes back a truncated file**. The only safe edit path is a 15 s-stalled, up-to-10-minute `claude_code` run. Fix: an `fs_edit` tool (exact old→new string replace, error when not unique) + `offset/limit` on `fs_read`. ~A day of work, no creds.

### H7. Voice tasks have 4–9 seconds of dead air before the first sound
Stacked, per the pipeline trace: VAD tail + full STT before the reply can start (~0.6–2.2 s) → model tool-call turn → blocking playbook recall (1–2 s, H2) → first agent turn → whole-clip TTS synthesis. There is no audible acknowledgment when a task starts (the instant "On it, Sir" only exists in a dead code path — `web/src/voice/useRealtimeVoice.ts:430` vs `:579-585`), the TTS queue is strictly serial with no prefetch (`useRealtimeVoice.ts:331-383`), `/api/speak` buffers whole clips (`server/src/routes/voice.ts:64-76`), nothing is cached, and a long task result is synthesized as **one** clip, so time-to-first-sound scales with result length. Quick fixes: local ack earcon on `ava.action`, prefetch clip N+1 while N plays, sentence-split long texts, LRU-cache repeated phrases ("Done.").

---

## Category findings

### Speed — voice mode

Beyond H1/H7:

- **No barge-in.** The mic is deaf while Ava speaks (forwarding requires `listening` state — `web/src/voice/voiceInputMode.ts:59-68`) and the server drops transcripts while a response is active. Interrupting requires tapping Pause. Deliberate echo-safety, but it caps conversational speed. The cancel/epoch machinery for duplex already exists (`useRealtimeVoice.ts:888-924`).
- **Hybrid is always-on; transcribe-only is unreachable.** `hybrid = !!deps.runAction` and `runAction` is wired unconditionally (`server/src/routes/voice-realtime.ts:789`, `server/src/index.ts:482`). `REALTIME_HYBRID` is a legacy no-op. Several features only wired in the dead transcribe path are silently lost: the instant task ack, first-sentence early TTS, and the voice approval card.
- **Latent landmine:** the dormant transcribe path still listens for `thought` events although streamed reply text moved to `delta` today (`2130664`); if re-enabled, reasoning summaries would be spoken as the reply, then double-spoken (`useRealtimeVoice.ts:433`).
- **The STT serialization is tunable.** The hybrid gate waits for the full transcription before `response.create` (anti-hallucination, intentional). `REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe` is a zero-code experiment to shrink that wait; speculative `response.create` with cancel-on-gate-reject is the bigger lever.
- **Mic transport:** ~187 tiny base64 JSON WS frames/sec upstream (5.33 ms audio quanta — `useRealtimeVoice.ts:142-157`). Batching to 40–60 ms frames (~20/sec) would help exactly on the weak hotspot networks you hit.
- **VAD tail** is set at connect-time only (fast = 300 ms, thorough = 700 ms — `voice-realtime.ts:101-103,836`); flipping the toggle mid-session doesn't apply until reconnect.

### Speed — text mode

- **Every typed turn is forced into full action mode** — orchestrator model + ~25 tool schemas + ~4.9k-token system prompt, even for "thanks" (`server/src/routes/chat.ts:243-247`). A typical turn is **~8–12k input tokens**, of which ~7.7k is a fixed tax. The intent classifier exists but is only trusted for voice.
- **Time-to-first-token is dominated by reasoning + H2.** Feedback is instant (optimistic thinking indicator, same frame as send), but the answer waits on the blocking playbook match, then reasoning.
- **Reasoning summaries are never requested** — the request sends `reasoning: { effort }` without `summary` (`server/src/orchestrator/llm/openai-provider.ts:117-126`), so the wired-up thought-caption UI (`MessageList.tsx:111-116`) stays dead and the longest stage shows a static "thinking…". One line to enable (costs some output tokens).
- **Tool calls execute strictly sequentially** (`server/src/orchestrator/agent.ts:249-293`); independent read-only calls (multiple `fs_read`, `chrome_tabs` + `read_page`) could run in parallel — the read-only tier set already exists to gate it safely.
- **No reasoning-item reuse between tool steps** — input is rebuilt from text/function-call items only, with no `previous_response_id` (`openai-provider.ts:23-54`); gpt-5.x re-reasons each step. Worth an estimated 10–25% of action-run cost and latency.
- **Live deltas are deliberately not rendered** — the thinking → word-by-word-reveal design we landed on this week is right for burst replies (reasoning models often deliver everything at once), but on long, low-effort replies it hides seconds of already-streamed text, plus a ~0.75–1.4 s reveal tail (`web/src/chat/MessageList.tsx:101-106`, `WordReveal.tsx`). A progressive WordReveal driven by arriving deltas would keep the exact same look while starting the read earlier. Optional refinement, not a bug.
- Side-call hygiene: `autoTitle`/`complete()` pass no reasoning effort → default-medium reasoning for a 32-token title (`openai-provider.ts:90-98`).

### Usability

What's already good: flat one-click IA, instant send feedback, humanized tool language everywhere, honest Stop (partials preserved), the chat approval card with countdown, undo on chat delete, first-class reduced-motion, the skipWaiting PWA fix.

Friction, ranked by daily impact:

1. **A running task is invisible and unstoppable from anywhere but its live chat.** `busy` is derived from a counter that resets when a session is reopened (`web/src/chat/ChatScreen.tsx:51,64,100`), so reopening a mid-flight chat (or one started from voice/phone) shows no Stop and no indicator — and nothing outside ChatScreen (nav, Home, chat list) shows that anything is running at all.
2. **Push approval notifications dead-end.** The SW declares Approve/Deny buttons but ignores them on click (`web/src/sw.ts:39-67`), and the `?approval=<id>` deep link is read by nothing in `web/src`. The real flow races a 15 s auto-approve timer through a 1.7 s splash and manual chat-hunting.
3. **No elapsed time anywhere in chat** — no per-step durations, no run timer, successful steps can't be expanded. "Is it stuck?" is unanswerable during a 10-minute task (voice mode has a timer; chat doesn't).
4. **Voice is a modal dead-end** — navigating anywhere kills the WS/mic session; there's no nav entry to Voice; you can't listen while reading Memory.
5. **Voice approvals contradict the mic gating** — the card says "Say *yes* to approve" but the mic isn't forwarded in `thinking` state, and in PTT, pressing Enter to say "yes" first calls `interrupt()` which kills the very run awaiting approval (`web/src/voice/useRealtimeVoice.ts:930-941`).
6. **Misleading microcopy teaches wrong mental models** — "HOLD SPACE TO SPEAK" (it's press-once), "hold the orb" (it's tap), an error hint pointing to a Sessions screen that is unreachable dead code.
7. **Half-real affordances** — Retry on every bubble always re-sends the *last* message; Like/Dislike persists nowhere. No edit-last-message, no message search (in-chat or cross-chat), no paste/drag of files, no Escape-to-back, no command palette. Enter while busy silently no-ops.
8. **Mobile PWA gaps** — the 280px Activity panel force-expands and crushes the conversation on a 390px phone; zero `env(safe-area-inset-*)` usage; the 3D brain can't pinch-zoom (wheel-only, `touchAction: none`).
9. **Inconsistent destructive UX** — chat delete has 5 s undo; memory/rule/pinned-chip deletes commit instantly with neither confirm nor undo.
10. **1.7 s unskippable splash** on every cold open; reopening a finished chat likely duplicates the last reply (replay + history dedupe missing — needs live verification).

### Task capability

The tool inventory (27 registered in action mode; full table in Appendix D): shell, control_app, 5× fs, claude_code, 7× chrome, computer_use, take_screenshot, 2× self_improve, read_logs, find_places (live), 2× discuss, 3× memory, read_claude_updates, 3× shopify (inert — no creds). Stop/kill chain, error honesty, and playbook learning are verified solid.

Top gaps, ranked by value:

1. **Email + calendar — nothing exists.** The bread-and-butter assistant tasks fail today. Gmail + Google Calendar APIs with one desktop OAuth; the Shopify tool file is the exact template (`server/src/routes/chat.ts:406` conditional registration).
2. **No scheduled/recurring tasks.** No cron anywhere; "every morning at 8, check X and ping me" is impossible. All the pieces exist: SQLite table + interval loop firing stored prompts through the existing loopback-chat pattern + push delivery. This would also give the overnight self-improve loop a real home (it's currently a manually-launched script).
3. **No background/long-running jobs.** Every tool call is synchronous inside the turn; shell is hard-capped at 30 s with no override and no cwd parameter (`runShell` supports cwd; the schema never passes it) — `npm install`, builds, and downloads die. Generalize the existing discussions pattern (DB row + fire-and-forget + relay + push) into `job_start/job_status/job_kill`.
4. **Ava cannot see the screen.** `take_screenshot` returns a file path the text-only agent loop never sees; `computer_use`'s vision is confined to the browser tab; `control_app` types into native apps blind — while the system prompt claims "I use this to see what is on screen," which is currently false (`server/src/orchestrator/tool-rubric.ts:29-31`). Cheapest: `describe_screen` = capture + one vision call → text. Next: a desktop ComputerSurface so computer_use can drive native apps.
5. **Browser robustness ceiling** — no tab-switch (popups silently steal the active page, `server/src/tools/chrome.ts:55-61`), no scroll, no wait-for-selector, no back, no download handling, no upload. Each is a ~20-line Playwright addition.
6. **No lightweight web fetch/search** — every lookup boots headed Chromium. A `fetch_url` tool (+ optional search API) makes read-only lookups ~10× faster and frees the shared browser.
7. **Messaging** — Telegram Bot API (~150 lines, one token) for Ava↔owner messaging off-LAN; doubles as the delivery channel for scheduled tasks and finished jobs.

Robustness issues: H3 (the 5-minute killer) is #1. Then the **computer_use zombie** — 60 s orchestrator budget vs a 100-iteration inner loop, and `withTimeout` only rejects the promise without cancelling the work, so an orphaned vision loop keeps clicking the same shared browser page the next tool is using while spending API credits (`server/src/orchestrator/timeout.ts:7,11-34`, `server/src/tools/computer-use.ts:63,90`). Then: `find_places`'s own fan-out instructions exceed its 30 s budget; no mid-task durability (the `tool_calls` table exists in the schema and is never written — restart loses all progress, and "continue" resumes with no memory of which items were done); popups steal the page with no recovery tool; no retry on idempotent GETs.

### Efficiency / cost (OpenAI = scarce)

Where tokens go per typed turn: ~4.9k system prompt + ~2.3k tool schemas + history + hidden side calls (playbook match ~2k on every turn; the O(N²) summarizer past 50 messages; distill after every ≥2-tool success; autoTitle at default-medium reasoning). A 10-step task run cumulatively reaches ~150–250k input tokens, mostly cache-discounted *if* caching hits — which is currently **unverifiable** because usage events (with `cached_tokens`) are ignored (`openai-provider.ts:206-214`).

Top cost reducers (no capability loss):
1. Incremental auto-summary (H5) — est. 20–40% of total daily tokens on long sessions.
2. Reasoning-item reuse / `previous_response_id` in the agent loop — est. 10–25% on action runs.
3. Skip/clamp the playbook match (H2) — ~2k side tokens on every typed turn.
4. Re-wire local TTS for narration (H1) or narrate milestones only — ~100% of narration TTS spend.
5. Cache restructure: move volatile observations after the static rubric/fsRoots so `memory_remember` doesn't bust the static suffix; add `prompt_cache_key`; instrument first.

Also: ~10.2k chars of prose where the rubric and capabilities map describe the same tools twice (~1–1.5k tokens recoverable); `MEMORY.md` is absent in `server/data/memory/`, so the memory-index layer and the whole project-context system are inert dead weight; no `max_output_tokens` anywhere.

### Reliability / observability (added category)

1. **The server can crash mid-task**: no process-level `unhandledRejection`/`uncaughtException` handlers, and the chat run IIFE is try/finally with **no catch** — a throw in the emit path (which does SQLite writes) rejects a void-ed promise → Node default kills the process (`server/src/routes/chat.ts:293-450`).
2. **No `listen` error handler** → the documented EADDRINUSE crash-loop (`server/src/index.ts:372-374`); `shutdown()` never closes the HTTP server or flushes pino.
3. **No task resume after restart** — in-memory runs/SSE buffers; boot recovery kills orphans and apologizes, nothing resumes.
4. **Self-dev `git reset --hard` still has no dirty-working-tree check** — the exact recorded collision hazard with concurrent dev work remains (fast-forward and safety-path guards exist; uncommitted edits are unprotected) (`server/src/self/swap.ts:15-30`).
5. **Data safety**: no SQLite backup mechanism; memory `.md` writes are non-atomic `writeFileSync` (crash mid-write truncates observations); `tool_calls` table dead.
6. **Voice-1006 is largely addressed** (client reconnect ≤2 + server abort-on-close shipped); remaining gap is upstream-socket reconnect.
7. **Observability is near-zero**: no token accounting, no per-stage timings (`tool_calls.duration_ms` never written), health endpoint is uptime-only — the post-swap watchdog polls a health check that can't see a broken provider. Three ~15-line additions fix the worst: usage logging from `response.completed`, a per-turn timing line (ms-to-first-delta + per-tool durations), and a real `/api/health`.

---

## If I were prioritizing

**Quick wins — each ≤ ~a day, biggest payoff first:**

1. Unblock the playbook match (concurrent or local scoring) — 1–2 s off **every** turn, text and voice (H2).
2. Classify read-only/API-read tools as instant — kills the 15 s stalls while keeping every destructive gate (H4).
3. Stuck-loop → no-progress clock — unlocks all >5-minute tasks (H3).
4. Voice dead-air kit: local ack earcon on task start + TTS prefetch + sentence-split results + phrase cache (H7).
5. Incremental auto-summary (H5).
6. `fs_edit` + ranged `fs_read` (H6).
7. Usage + timing telemetry (3 small logs) — makes speed and cost diagnosable, and proves whether prompt caching hits.
8. `reasoning.summary: "auto"` → live thinking ticker in the existing caption UI (one line server-side; flag: costs some output tokens).
9. Crash guards bundle: unhandledRejection/uncaughtException handlers, catch around the run IIFE, `listen` error handler, dirty-tree guard before self-dev swap, nightly `db.backup()` + atomic memory writes.
10. UX truth pass: fix the microcopy lies, error-vs-empty chat list, Escape-to-back, don't exit voice on error dismiss, elapsed time on the thinking row.

**Bigger bets, in rough order of value:**

- **Gmail + Google Calendar tools** (highest daily utility of anything on this list).
- **Recurring scheduler** (also gives the overnight self-improve loop a home).
- **Background job manager** (lifts the 30 s shell ceiling; generalizes a pattern that already exists).
- **Decide Chatterbox's fate** (H1): re-wire for narration (free, your cloned voice) or delete the dead code deliberately.
- **Conversation-mode routing for trivial typed turns** with an escalate-to-agent hatch — saves ~7.7k tokens and the big model on chit-chat.
- **Global run ticker + command palette** — the two highest-leverage UX features (running-task visibility everywhere; every buried feature typeable).
- **Streaming TTS** (pipe instead of buffer; play via the existing PCM player) — first sound in ~300 ms for any phrase.
- **Voice barge-in** (the epoch/cancel machinery already exists; gate on transcript first for echo safety).
- **Desktop vision** (`describe_screen` now; desktop ComputerSurface later) — makes `control_app` trustworthy.
- **Task resume after restart** (persist run messages; recovery offers "continue" instead of apologizing).
- **Parallel read-only tool execution**; **fetch_url**; **Telegram bridge**; **approval deep-link + real notification actions**; **voice PiP orb** (talk while browsing other screens); **cross-chat search (FTS)**.

## New feature ideas (beyond fixes)

- **Morning briefing / proactive routines** — needs the scheduler + email/calendar: "8:00 — inbox triage, calendar, yesterday's job results," delivered by push/Telegram and readable in chat.
- **Cost dashboard on the Self screen** — daily tokens/cost by lane (agent, side calls, realtime voice, TTS/STT) from the new usage log, with a 7-day sparkline.
- **Latency-breakdown chip per reply** — queue / match / thinking / tools / total, riding timestamps the SSE events already carry.
- **Run timeline rail in chat** — per-step start/duration/ok-fail with expandable results, persisting into the transcript after the run (auditability of past tasks).
- **Quick-reply chips** under Ava's last reply (the chip pipeline already exists).
- **Notification center lamp** on the deck — pending approvals (with countdown), finished long runs, self-dev awaiting approval, SW update-ready; each entry deep-links.
- **Wake word ("Ava")** on the home screen → existing `start()`.
- **Parallel subagent fan-out** (`spawn_task` via the loopback pattern) — prerequisite: per-run browser contexts, since concurrency currently races one shared page.
- **"What's new" feed on Self** — surface the claude-updates log + self-dev changelog so shipped features stop being discoverable only via chat.

## Live-measurement addendum (2026-06-11, requested by the owner)

Everything below was measured against the **running** server (uptime ~23h) with a separately-paired test client and a separate Playwright Chromium (the owner's browser was untouched). Test sessions were prefixed `[latency test]`/`[ui test]` and deleted afterwards.

### Live config facts (`server/.env` names only; values withheld)
- Voice engine resolves to **openai** (DB pref) despite `AVA_VOICE_PROVIDER=hume` in `.env` — voice is healthy, not on the zero-credit Hume path.
- Reasoning pref: **fast**. `REALTIME_HYBRID=1` still set (now a no-op). `REALTIME_VAD_PREFIX_PADDING_MS=200` override active. Google Places key live; no Shopify creds (tools inert, as reported); no transcribe-model override; default 15s approval window.

### Measured latencies (reasoning = fast)
| Stage | Measured |
|---|---|
| POST /api/chat pre-roll (auth + history + **blocking playbook match**) | **1.7–2.8 s, every turn** (T1 2,827ms · T2 1,799ms · T3 1,901ms · T4 1,725ms) |
| Trivial reply ("OK") — total | 3.6–5.8 s (first delta 3.3–5.3 s) |
| One-shell-tool task — total | 6.7 s (tool_call @3.3s → shell ran 1.4s → final @6.7s; **no approval stall for shell** — low tier confirmed) |
| `/api/speak` "Done." | **2,118 ms — TTFB = total** (full-buffer confirmed) |
| `/api/speak` 268-char paragraph | 3,237 ms before any audio exists |
| `/api/transcribe` (~1s clip) | 1,317 ms |
| Voice connect (orb tap → LISTENING) | 2,104 ms |
| Thinking indicator after send | 170 ms (instant feedback confirmed) |
| Warm reload → home (splash tax) | 2,141 ms every open |
| Pairing flow | screen ready 308 ms; submit → home 2,421 ms |

Frontend bundle: **one** 1.2 MB JS chunk (~350 KB gz), 56 KB CSS — no code-splitting; Three.js ships on every load even if Mind view is never opened.

### UI claims verified live
- **F1 CONFIRMED, and worse than written**: reopening a chat **mid-run** renders a **completely empty transcript** — no bubbles, no Stop, no indicator (`07-reopened-mid-run.png`). The run continues invisibly.
- **NEW BUG (replaces F6)**: F6's duplicate did not reproduce — instead, reopening a **finished** chat renders **only the last exchange**; all earlier turns are missing (`08-reopened-finished.png`).
- **NEW BUG — raw markdown in bubbles**: Ava's reply rendered literally as `Average: **0ms**, Sir.`
- **F7 CONFIRMED, catastrophic on phone**: mid-run, the fixed 280px Activity panel crushes the conversation to a ~70px column — one word per line (`16-mobile-chat-during-run.png`).
- **Junk chips confirmed mechanically**: test messages became suggestion chips within seconds ("[ui test] Use the shell tool to run exac…") — the auto-chip pipeline recycles recent messages with no quality gate. A pre-existing garbled chip ("Find 40 if not as much as u can waterfor") was already live.
- **Mobile brain**: the desktop-tuned 2.3×/0.7× stretch leaves portrait phones with a sparse, edge-clipped graph; hint says "SCROLL TO ZOOM" on a device that cannot zoom (F14 confirmed by code: wheel-only).
- **Mobile home copy**: "HOLD SPACE TO SPEAK" shown on a device with no spacebar.
- **Healthy**: zero console errors, zero page errors, zero failed requests across the entire walkthrough; voice screen, memory list/Mind (WebGL), rules, self, pairing all render and function; humanized Activity captions + EXECUTING chip + Stop work correctly in the live view.

### Test residue
All test sessions deleted (5×204). Two paired test devices remained after the run (`claude-live-review`, `claude-ui-review`) — revoked during the fix wave.

---

## What this review could not verify (code-only)

Live network/API latencies (all voice timings are structural estimates); `.env` contents (key names only, where listable); OpenAI prompt-cache hit rates (no instrumentation exists); whether the Hume dashboard config defines `do_on_computer`; gpt-5.5 pricing; a few UI behaviors flagged "needs-live-verification" in Appendix C (duplicate final bubble on reopen, voice "say yes", iPhone safe-area overlap).

---

*Appendices: the five raw agent reports, verbatim.*

## Appendix A — Voice-mode speed (agent report)

# Ava Voice-Mode Speed Review — end-to-end pipeline audit

READ-ONLY review at branch `feat/premium-frontend-remodel` (working tree clean for `server/src` + `web/src`). All external-API timing figures are estimates (marked ~); everything structural is cited file:line.

## 0. Reality check — the code no longer matches the brief

These supersede the stated context; verified in code:

- **The 3-way OpenAI/Chatterbox/Hybrid toggle is gone.** Commit `777ecc0` (Jun 6) retired it; the toggle is now 2-way **OpenAI / Hume** (`server/src/state/voice-engine-pref.ts:13`, `server/src/routes/voice-engine.ts:6`, UI `web/src/voice/VoiceScreen.tsx:161-164`). A stale "chatterbox"/"hybrid" DB row falls back to "openai" (`voice-engine-pref.ts:11-12,26`).
- **Chatterbox is dead code.** `server/src/voice/chatterbox.ts` is referenced only by its own test; `/api/speak` is always OpenAI `gpt-4o-mini-tts` (`server/src/routes/voice.ts:84-90`). The owner's local cloned voice is currently unreachable from Ava.
- **"Transcribe-only" mode is unreachable in production.** `hybrid = !!deps.runAction` (`server/src/routes/voice-realtime.ts:789`) and `runAction: runVoiceAction` is wired unconditionally (`server/src/index.ts:482`). `REALTIME_HYBRID` is a legacy no-op flag (`index.ts:381-388`). So the realtime model **always speaks** for OpenAI engine; the client's transcribe path (`runAgentTurn`, `web/src/voice/useRealtimeVoice.ts:397-486`) only runs if the proxy ever says `mode:"transcribe"` — which it never does in prod.
- **The deferred WS close-1006 abort/guard has since landed:** client auto-reconnect capped at 2 with 800ms backoff (`useRealtimeVoice.ts:789-810`), and server aborts in-flight `do_on_computer` runs on client close via `actionAbort` + `killOnAbort` (`voice-realtime.ts:797,1088-1095`; `index.ts:433-434`).
- Stale comments worth knowing about: `index.ts:338,346,473` still describe the retired chatterbox/hybrid engine semantics.

## 1. Pipeline map (production = OpenAI hybrid; Hume variant noted)

### Stage A — Session connect (tapping the orb)
| Step | Where | Latency |
|---|---|---|
| `getUserMedia` | `useRealtimeVoice.ts:695-701` | ~100-500ms, **serialized before** the WS dial (`:717`) |
| WS to local server + upgrade auth | `voice-realtime.ts:737-768` | ~ms (loopback/LAN) |
| Server dials `wss://api.openai.com/v1/realtime?model=gpt-realtime` **per session** | `voice-realtime.ts:56-57,803-807` | ~300-900ms TLS+WS (happy-eyeballs floor 500ms/family, `net-tuning.ts:20-21`) |
| `session.update` + seed last 12 turns (`REALTIME_SEED_TURNS`) + hello | `voice-realtime.ts:854-893` | ~ms, fire-and-forget sends |
| Client audio worklet setup (on client-WS open, frames buffered until upstream ready) | `useRealtimeVoice.ts:720-766`, `voice-realtime.ts:830,901-909` | ~50-150ms |

Total to "listening": **~0.5-1.5s**. Hume adds an OAuth token fetch on first connect (cached ~30min, `voice-provider-config.ts:149-165`).

### Stage B — Mic capture + transport
- AudioWorklet posts **every 128-sample render quantum = 5.33ms** at 24kHz PCM16 (`useRealtimeVoice.ts:142-157`); each becomes base64 + a JSON WS frame (`:748-753`) → **~187 tiny WS messages/sec** upstream, forwarded verbatim by the proxy (`voice-realtime.ts:901-909`). Latency-fine, but heavy per-frame overhead (CPU + packet count) — worst exactly on the weak hotspot networks the owner hits.
- Mic is forwarded **only while `state === "listening"`** (VAD mode) or while a PTT turn is held (`voiceInputMode.ts:59-68`) — i.e. the mic is deaf while Ava speaks (see barge-in, issue #3).

### Stage C — End-of-speech detection (VAD)
- Server-side `server_vad`: `threshold 0.6`, `prefix_padding 300ms`, default `silence 600ms` (`voice-realtime.ts:70-75`); the reasoning toggle overrides the tail at **connect time only**: fast = **300ms**, thorough = **700ms** (`vadForReasoning`, `voice-realtime.ts:101-103`, read at `:836`).
- `create_response:false, interrupt_response:false` (`:114-126`) — VAD never auto-replies.
- PTT mode: `turn_detection:null`; Enter→Enter commits the buffer (`useRealtimeVoice.ts:947-965`), min 4800 bytes = 100ms guard (`voiceInputMode.ts:171-179`).

### Stage D — STT → reply trigger (the structural serialization)
After VAD stop, the proxy **waits for the full `input_audio_transcription.completed`** (`gpt-4o-transcribe`, `voice-realtime.ts:61,71`), runs the pure gate (`transcript-gate.ts:117-157`, ~0ms), persists the turn, and **only then** sends `response.create` (`voice-realtime.ts:1014-1054`). Whole-utterance transcription completion is ~0.3-1.5s after speech stop (external, unverified exactly). This is the anti-hallucination design — but it means **every hybrid turn pays VAD-tail + full-STT before the model even starts**, vs. native speech-to-speech which starts at VAD stop.

### Stage E — Reply generation + playback (chit-chat)
- Realtime model speaks; output is PCM16@24k, `speed: 1.15` (`buildHybridSessionUpdate`, `voice-realtime.ts:239-245`; `voiceConfig.ts:12`), voice `shimmer` default / `REALTIME_VOICE` override (`voice-defaults.ts:17`, `index.ts:483`).
- Client plays each delta immediately — `PcmStreamPlayer` schedules at the running playhead, starts on the **first** chunk, no pre-buffering (`realtime-audio.ts:69-96`). Good: zero added playback latency.
- **First audible chit-chat reply ≈ 0.3-0.7s (VAD) + ~0.3-1.5s (STT) + ~0.3-0.8s (model first delta) ≈ 1-3s.**
- Turn-around: mic reopens after a 350ms settle once `response.done` + audio drained (`useRealtimeVoice.ts:496-508`), 4s safety fallback (`:36,513-522`).

### Stage F — Task path (`do_on_computer`)
1. Model emits a silent function_call (`readToolCall`, `voice-realtime.ts:255-265,966-969`); proxy sends `ava.action` → client shows caption **but plays no sound** (`useRealtimeVoice.ts:579-585`).
2. `runVoiceAction` loops back over HTTP: `POST /api/chat` with `persist:false` and **no `voice:true`** (`index.ts:407-414`) → mode is always `"action"` (`chat.ts:243-247`).
3. Because `voice` is unset, the run **pays blocking playbook recall** — a side-model match awaited before the agent starts, ~1-2s typical, 8s timeout (`chat.ts:67-68,258-286`) — and full reasoning effort (`low`/`medium` via `mapReasoning`, `chat.ts:289-291`, `reasoning.ts:6-9`) instead of voice's `none`.
4. Steps stream back over an SSE poll loop (**100ms interval**, `chat.ts:497-512`); proxy sends `ava.step`; client humanizes (`humanize.ts:24-51`) and queues TTS.
5. Each narration phrase = one `POST /api/speak` → OpenAI synthesizes the **whole clip**, server buffers it fully (`await r.arrayBuffer()`, `voice.ts:64-76`), client downloads the **whole blob** before `Audio.play()` (`useRealtimeVoice.ts:341-357`). Queue is strictly serial: fetch clip N → play N to end → fetch N+1 (`speakWorker`, `:331-383`) — synthesis of N+1 happens **during silence**, not during playback of N.
6. Final result = `ava.result` → **one TTS clip for the entire result text** (`voice-realtime.ts:995`, `useRealtimeVoice.ts:594-601`).
7. Approval-gated tools: in hybrid the loopback SSE reader **ignores `approval_required`** and waits out the 15s auto-approve veto window (`index.ts:454-455`, `policy/runtime.ts:41`); the VoiceScreen approval card (`VoiceScreen.tsx:132-147`) is only wired in the dead transcribe path (`useRealtimeVoice.ts:445-455`).

**First audible feedback for a task ≈ VAD+STT (0.6-2.2s) + model tool-call turn (~0.5-1.5s) + playbook recall (1-2s) + first agent model turn (~1-3s) + SSE poll (≤0.1s) + TTS clip (~0.7-1.5s) ≈ 4-9s of dead air.**

### Stage G — Hume variant
Same proxy shape; Hume speaks its own LLM. Each `audio_output` is a 48kHz WAV clip, header-stripped + box-filter resampled to 24k per chunk server-side (`voice-realtime.ts:415-467`) — ~ms CPU, fine. `do_on_computer` handoff code exists (`:1217-1244`) but whether the tool is defined in the Hume EVI config (dashboard-side, `config_id`) **cannot be verified from this repo**. Prompt is budget-capped at 11k chars identity-first (`buildHumeVoicePrompt`, `:372-388`) — matches the known truncation fix.

## 2. Issues / bottlenecks, ranked by latency impact

1. **Task dead air: nothing audible until the first narrated step (~4-9s).** `ava.action` only sets a caption (`useRealtimeVoice.ts:579-585`); the persona explicitly forbids the realtime model from speaking during tasks (`voice-realtime.ts:185-189`). The instant "On it, Sir." ack exists **only in the dead transcribe path** (`useRealtimeVoice.ts:430`). Severity: high, every voice task.
2. **Whole-clip TTS, serial, uncached.** `/api/speak` buffers the full mp3 before responding (`voice.ts:64-76,90-92`); client waits for the full blob (`useRealtimeVoice.ts:348`); `speakWorker` never prefetches the next clip while one plays (`:337-358`); no cache, so identical phrases ("Done.", "Running a command") re-pay ~0.7-1.5s + OpenAI cost every time. A long task result is synthesized as ONE clip — time-to-first-sound scales with result length (~3-8s for a paragraph). Severity: high (tasks + every narrated step).
3. **No voice barge-in.** Mic forwarding requires `listening` (`voiceInputMode.ts:66-67`), and the server drops any transcript while `responseActive` (`voice-realtime.ts:1029-1035`). Interrupting Ava requires tapping the Pause button (`VoiceScreen.tsx:214-222`). Deliberate echo-safety, but it caps conversational speed: the user must wait out the reply + 350ms settle. Severity: high usability.
4. **Hybrid gate serializes full STT before `response.create`** (`voice-realtime.ts:1049-1054`): ~0.3-1.5s/turn structural adder vs. speech-to-speech. Intentional (anti-hallucination) — but the transcribe model is env-tunable (`REALTIME_TRANSCRIBE_MODEL`, `:88`) and `gpt-4o-mini-transcribe` would shave a chunk of it with zero code. Severity: medium-high, every turn.
5. **Voice tasks pay blocking playbook recall (1-2s, up to 8s) + non-minimal reasoning** because `runVoiceAction` omits `voice:true` (`index.ts:414`; `chat.ts:258,289-291`). Possibly intentional (playbooks help tasks), but it's a hard pre-roll await before any step exists to narrate. Severity: medium-high, every voice task.
6. **Silent 15s approval stall in hybrid.** `index.ts:454-455` comment confirms it deliberately waits out the veto window; no approval frame is sent over the realtime WS, so the user can neither hear about it nor approve early by voice. Severity: medium (only gated tools), but it's a fixed 15s.
7. **Regression (today, commit `2130664`): voice listens for `thought` but streamed reply text now rides `delta`.** `useRealtimeVoice.ts:433` vs `agent.ts:87-90,184-193`; the chat UI was updated (`useChatStream.ts:62`), voice wasn't. Currently masked because the transcribe path is unreachable (see §0), but: first-sentence early TTS + the `final`-remainder logic are silently broken, and reasoning summaries (which still ride `thought`, `openai-provider.ts:197-204`) would be **spoken as if they were the reply**, then double-spoken at `final` (`useRealtimeVoice.ts:457-468`). Landmine if transcribe mode is ever re-enabled. Severity: low now / high latent.
8. **Mic transport overhead: ~187 JSON+base64 WS frames/sec** (5.33ms quanta, `useRealtimeVoice.ts:142-157,748-753`). Not a latency adder on good networks, but on the owner's hotspot it multiplies loss/jitter exposure and main-thread work (base64 of 256B per 5ms). Severity: low-medium.
9. Minor: `useMicAmplitude` opens a **second** `getUserMedia` + AudioContext and `setState`s at 60fps while listening (`useMicAmplitude.ts:19-37`) → continuous VoiceScreen re-renders; per the project's own GSAP rule this belongs in a ref/quickTo. CPU, not pipeline latency.
10. Minor: reasoning-level → VAD tail (300/700ms) is sampled **at connect only** (`voice-realtime.ts:836`); flipping Fast/Thorough mid-session doesn't change endpointing until reconnect. Unlabeled behavior, not a bug per se.

## 3. Improvements, ranked impact×effort

**Quick wins (hours):**
1. **Instant ack on `ava.action`** — in `handleHybridAction` "working" branch (`useRealtimeVoice.ts:579-585`) `enqueueSpeak("On it, Sir.")`, or better a pre-baked local audio asset (0 API, 0 latency). Kills issue #1's perceived dead air; ~1 line + asset.
2. **TTS prefetch pipeline** — in `speakWorker` (`useRealtimeVoice.ts:337-358`), start the fetch for queue item N+1 while N plays (keep playback serial). Removes ~0.7-1.5s of silence between every narrated step. Small, contained change with the existing epoch guard.
3. **Sentence-split long texts at `enqueueSpeak`** (especially the task result, `useRealtimeVoice.ts:600`): split on sentence boundaries so the first sentence synthesizes/plays while the rest is in flight (combined with #2 = streaming-ish TTS without touching the server). The transcribe path already proved the pattern (`:439-442`).
4. **Server-side TTS LRU cache** keyed `(text, voice, speed)` in `/api/speak` (`voice.ts:78-97`) — step phrases and "Done." repeat constantly; instant replays + direct OpenAI cost savings (token-economics priority).
5. **Try `REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe`** — env-only experiment (`voice-realtime.ts:88`) to cut the stage-D STT wait; verify the gate still gets logprobs (`readTranscriptionCompleted`, `:608-621`) and hallucination quality holds.
6. **Batch mic frames to ~40-60ms** in the worklet (accumulate 8-12 quanta before postMessage, `useRealtimeVoice.ts:142-157`) → ~20 msgs/s instead of 187; friendlier to the hotspot and the main thread.
7. **Fix the `thought`→`delta` mismatch** in `useRealtimeVoice.ts:433` (listen to `delta`; keep `thought` out of spoken text) even though the path is currently dormant — it's a one-line landmine.

**Bigger bets:**
8. **True streaming TTS** — `/api/speak` pipe OpenAI's chunked response (PCM/WAV) through instead of `await r.arrayBuffer()` (`voice.ts:75`), client plays via the existing `PcmStreamPlayer` instead of `HTMLAudio` blob. Time-to-first-sound for any phrase drops to ~TTFB (~300ms). Medium effort; unifies on one player.
9. **Speculative `response.create`** — fire on `speech_stopped` when `speechMs` is comfortably above the gate threshold (clearly real speech), `response.cancel` if the gate then rejects (`voice-realtime.ts:1014-1054`). Recovers most of the ~0.3-1.5s STT serialization while keeping the gate authoritative. Costs occasional cancelled generations.
10. **Voice barge-in (duplex)** — keep mic forwarding while `responding` with the existing AEC constraints (`useRealtimeVoice.ts:697-700`), let server VAD `speech_started` during `responseActive` trigger the existing `interrupt()` machinery (epochs + `response.cancel` already built, `:888-924`, `voiceInputMode.ts:167-169`) instead of dropping the transcript at `voice-realtime.ts:1029-1035`. The hard part is echo robustness — gate on the transcript, not raw VAD, as a first step.
11. **Approvals over the realtime WS** — forward `approval_required` from the loopback SSE (`index.ts:451-455`) as an `ava.approval` frame; client speaks it + reuses the existing approve/deny plumbing (`useRealtimeVoice.ts:986-998`). Turns silent 15s stalls into a ~2s spoken yes/no.
12. **Non-blocking playbook recall for voice tasks** — run the match concurrently with the agent's first turn (or pass a flag from `runVoiceAction`) instead of the blocking await at `chat.ts:266-271`; saves 1-2s pre-roll per task without losing playbooks.

## 4. New voice feature ideas (speed/usability)

1. **Local earcon vocabulary** — tiny bundled sounds: "listening" tick on VAD reopen, "got it" blip when the transcript is accepted, a soft working-pulse every ~5s during long tool runs (hooking the existing SSE heartbeat, `chat.ts:495-507`). Zero API, removes all perception of dead air.
2. **Partial-transcript live captions + warm-up** — subscribe to the realtime `transcription.delta` events (currently ignored, `realtime-events.ts:79-80`) to caption while the user is still speaking, and use them to pre-warm the playbook match / session context so stage-F pre-roll overlaps with speech.
3. **Wake word ("Ava")** — tiny on-device keyword spotter on the home screen that calls the existing `start()` (`useRealtimeVoice.ts:685`), so voice starts before the user's hand reaches the orb; pairs with reconnect logic already present.
4. **Speak-while-acting result streaming** — `runVoiceAction` already reads the SSE stream (`index.ts:435-458`); also forward coalesced `delta` text of the *final answer* as it streams and TTS it sentence-by-sentence (using win #3's splitter), so long results begin speaking before `final` lands.
5. **Volume-duck pre-interrupt** — on first sign of user speech (local amplitude from the already-running `useMicAmplitude`), duck `PcmStreamPlayer` gain ~6dB before the full barge-in confirms; makes interruption feel instant even while the cancel round-trips.

**Could not verify:** exact OpenAI realtime STT/first-delta latencies (external service); whether the Hume EVI dashboard config defines `do_on_computer`; live `.env` values (`REALTIME_VOICE`, `AVA_VOICE_PROVIDER`, VAD overrides) since `.env` is gitignored and off-limits.

## Appendix B — Text-mode speed (agent report)

# Ava Text-Mode Speed Review

Scope: user presses Enter → full reply readable. Provider = OpenAI (`server/.env` has `OPENAI_API_KEY`, `LLM_PROVIDER` unset → defaults to openai, `server/src/config.ts:70-71`), orchestrator model `gpt-5.5`, side model `gpt-5` (`server/src/orchestrator/llm/openai-provider.ts:82-83`). All token figures are estimates at ~4 chars/token; real reasoning durations and cache-hit rates cannot be verified from code.

---

## 1. Latency budget (typical text turn)

Every typed turn is forced to `action` mode — full tool stack + orchestrator model, regardless of content (`server/src/routes/chat.ts:243-247`).

| # | Stage | What happens | Est. contribution | Citation |
|---|-------|--------------|-------------------|----------|
| 1 | POST /api/chat handler (sync part) | auth token lookup (1 SQLite query), session get/touch, `listMessages` for correction detection, user-row insert, `getSessionFull` + history reload, greeting check (2-3 queries) | ~1-5 ms total — better-sqlite3 is synchronous and local; **7-9 queries/message**, all sub-ms | `chat.ts:123-133, 179, 212-215, 221`; `auth/middleware.ts:13-31`; `greeting.ts:47-71` |
| 2 | **Playbook recall (BLOCKING)** | An awaited `gpt-5` streaming call matches the request against 50 playbook triggers before the agent starts AND before the POST returns | **~1-2 s every text turn, up to 8 s** (own comment: "Normal side-model matches return in ~1-2s") | `chat.ts:66-68, 258-286`; `playbooks/match.ts:15-18`; 50 files in `server/data/memory/playbooks/` |
| 3 | Agent boot | `buildSystemPrompt` = 4 file reads + prune; `loadProjectIndex` reads MEMORY.md (absent → no-op); tool builders are lazy (Chromium not booted) | ~1-2 ms | `orchestrator/agent.ts:115-130`; `system-prompt.ts:57-93`; `chat.ts:375-411` |
| 4 | OpenAI call — time to first output token | `responses.create` stream with ~19.5k-char system + ~27 tool schemas + history. Reasoning effort: text action = `low` (fast pref, the default) or `medium` (thorough) | network ~0.2-0.5 s + prompt ingest + **reasoning: seconds (dominant)**. No `prompt_cache_key`, no `previous_response_id` — relies solely on OpenAI automatic prefix caching | `openai-provider.ts:117-126`; `reasoning.ts:6-9`; `state/reasoning-pref.ts:12` (default "fast"); `chat.ts:289-291` |
| 5 | Per tool step (when used) | tools execute **sequentially** with `await` per call; each subsequent model turn re-sends full system + full message history + all tool schemas | tool runtime + one full OpenAI round-trip (incl. fresh reasoning) per model turn; +up to **15 s** veto stall for medium-tier tools (claude_code, computer_use, unknown) | `agent.ts:249-293, 178-183`; `policy/runtime.ts:41-44, 81-84`; `policy/classify.ts:60, 80, 104` |
| 6 | Server→client delivery | delta coalescing: flush on word boundary OR ≥24 chars OR 50 ms timer; SSE replay buffer polled every **100 ms**; 15 s heartbeat | ≤50 ms coalesce + ≤100 ms poll tick per batch — fine | `agent.ts:184-193`; `chat.ts:497-512` |
| 7 | Stream connect | EventSource opens only after the POST resolves (runEpoch++ after `await api.sendMessage`), so stage 2's 1-2 s also delays stream attach; a fast-finish race is handled by replaying the final | bounded by stage 2 | `web/src/chat/ChatScreen.tsx:154-160`; `chat.ts:463-481` |
| 8 | Frontend render | deltas are **never rendered live** — thinking indicator stays until `final`, then WordReveal animates word-by-word: stagger `min(45ms/word, 1.1s total)` + 0.3 s per-word blur-in | **+0.75-1.4 s after the model already finished** before the reply is fully readable; for long low-effort replies the user also waits the entire generation that was streaming all along | `web/src/chat/MessageList.tsx:101-106, 269-283`; `WordReveal.tsx:36-38, 60` |

The thinking indicator itself is instant (optimistic `pending` flips the same frame as send — `ChatScreen.tsx:36-38, 156`), so *feedback* latency is ~0; *answer* latency is stages 2+4(+5)+8.

---

## 2. Prompt-size audit (per turn, action mode)

Measured by assembling the real layers exactly as `system-prompt.ts:57-93` does:

| Component | Size | Tokens (est.) | Source |
|-----------|------|---------------|--------|
| Persona (`personality.md`) | 3,845 chars | ~960 | `server/data/memory/personality.md` |
| Capability map (static) | 4,543 chars | ~1,140 | `capabilities-content.ts:12-90` |
| Memory index (MEMORY.md) | **0 — file doesn't exist** | 0 | `system-prompt.ts:79`; `memory/paths.ts` (`MEMORY.md` absent from `server/data/memory/`) |
| Preferences | 2,165 chars | ~540 | `data/memory/preferences.md` |
| Observations (pruned at soft cap 2,000 tokens) | 2,726 chars | ~680 | `data/memory/observations.md`; `memory/budgets.ts:3-9` |
| Tool rubric (static) | 5,720 chars | ~1,430 | `tool-rubric.ts:3-110` |
| fs-roots block | ~470 chars | ~120 | `system-prompt.ts:45-55` |
| **System prompt total** | **~19,500 chars** | **~4,900** | measured |
| Tool schemas — **27 tools** every action turn (shell, control_app, 5×fs, claude_code, 7×chrome, computer_use, take_screenshot, self_improve ×2, read_logs, find_places, discuss ×2, memory ×3, read_claude_updates; shopify off — no creds) | ~9-11k chars (est.) | **~2,300-2,800** | `chat.ts:385-411`; `tool-registry.ts:24-39`; biggest: `find_places` ~1.2k chars (`places-mcp.ts:41-64`), memory_remember ~0.8k (`memory-mcp.ts:62-77`) |
| History — full transcript until >50 messages, then summary + last ~20 | ~1-4k tokens typical (only user/assistant text is persisted; tool traffic is not) | | `chat.ts:212-233`; `auto-summary.ts:21-22` |
| Latest turn + greeting/summary/playbook prefixes | ~50-300 | | `chat.ts:288` |

**Typical request ≈ 8,500-12,000 input tokens**, of which ~7,700 (system + tools) is a fixed tax on every turn. Biggest contributors: tool rubric + capability map (which substantially duplicate each other — both enumerate the same tools in prose), and the 27 tool schemas. Multi-step tasks re-send everything per model turn (`agent.ts:178-183`), so a 6-turn task ≈ 50-80k input tokens before tool outputs (shell truncates at 4,096 chars, fs/chrome_read_page at 8,192 — `shell-tool.ts:7`, `filesystem-mcp.ts:6`, `chrome-mcp.ts:112`).

Hidden side-spend (cost, not latency): past 50 messages, `maybeSummarize` re-sends the ENTIRE collapsed transcript to gpt-5 **every turn** (throughId moves each turn, `auto-summary.ts:24-49`); `autoTitle` and `complete()` calls pass **no reasoning effort** → gpt-5 defaults to medium reasoning for a 32-token title (`openai-provider.ts:90-98`, `auto-title.ts:30-35`); playbook distill runs after every successful ≥2-tool run (`chat.ts:318-329`).

---

## 3. Issues ranked by impact

1. **Blocking LLM playbook match adds ~1-2 s (cap 8 s) to every single text turn** — awaited before the agent starts and before the POST returns; with 50 playbooks on disk this fires always (`chat.ts:258-286`). Biggest single fixed-latency item in the path.
2. **Streamed deltas are discarded by the UI** — the whole pipeline (provider → coalescer → SSE → client) delivers live text, then `MessageList` deliberately doesn't render it; the user waits for `final` + a 0.75-1.4 s WordReveal (`MessageList.tsx:101-106`; `WordReveal.tsx:60`). For low-effort/long replies this hides seconds of already-available text.
3. **Reasoning summaries are never requested** — request sends `reasoning: { effort }` without `summary` (`openai-provider.ts:123-125`), so the `response.reasoning_summary_text.delta` handler (`openai-provider.ts:197-204`) and the UI's thought-caption path (`MessageList.tsx:111-116`) are dead for OpenAI. During the longest stage (thinking) the user sees only static "thinking…".
4. **Every text turn pays the full 27-tool + 4.9k-token-system tax** — text never uses conversation mode even for "thanks"/chit-chat (`chat.ts:243-247`); ~7.7k fixed input tokens/turn, doubly bad given OpenAI scarcity.
5. **Sequential tool execution** — `for (const call of pendingCalls) { await … }` (`agent.ts:249-293`); independent read-only calls (multiple fs_read, chrome_tabs+read_page) serialize.
6. **Full-history re-send per agent step, no `previous_response_id`, no `prompt_cache_key`** — `toResponsesInput` rebuilds the whole input array per turn (`openai-provider.ts:117-126, 23-54`). Prefix ordering IS cache-friendly (static system, append-only input, per-turn prefixes attached to the last message — `chat.ts:222-234, 288`), but caching is left entirely to OpenAI's automatic best-effort, and any mid-session memory write (`rememberObservation` on corrections, `chat.ts:140-152`; `memory_remember` tool) silently invalidates the system-prompt prefix for all later turns.
7. **15 s auto-approve veto window on medium-tier tools** — `claude_code`, `computer_use`, and any unknown tool stall up to 15 s each awaiting `waitForDecision` (`policy/runtime.ts:41-44, 81-84`; `classify.ts:60, 80, 104`).
8. **Rubric/capabilities duplication** — ~10.2k chars of prose where each tool is described twice (`tool-rubric.ts` vs `capabilities-content.ts`); ~1-1.5k tokens recoverable.
9. **Per-turn re-summarization past 50 messages** — cost issue (see audit) (`auto-summary.ts:24-49`).
10. **No `max_output_tokens` / verbosity control on the main stream** (`openai-provider.ts:117-126`) — reply length discipline is persona-only; long replies inflate both generation time and the WordReveal tail.
11. Minor frontend churn: `events` array grows unbounded across runs and every SSE event triggers a full-list re-render + smooth `scrollIntoView` (`useChatStream.ts:56`; `MessageList.tsx:71-73`); `liveEvents` filter + `deriveSteps` re-scan per render (`ChatScreen.tsx:113-122`). Negligible today at coalesced event volumes.
12. Dead weight, not latency: MEMORY.md is absent, so the memory-index layer AND the whole project-context system (`agent.ts:115-126, 253-263`; `project-index.ts:20-21`) are inert in this deployment.

## 4. Improvements ranked by impact × effort

1. **Unblock playbook recall (high impact, low effort)** — fire `matchPlaybook` concurrently with the first model call and inject the playbook as a message only if it resolves before the first tool dispatch; or replace the LLM match with local keyword/trigram scoring over the 50 triggers (they're short strings — `playbooks/store.ts:62-64`). Saves 1-2 s on every turn and one gpt-5 call.
2. **Render deltas live / progressive WordReveal (high perceived impact, medium effort)** — drive the existing word-by-word aesthetic from arriving deltas instead of waiting for `final` (the Stop-partial path already proves the plumbing works — `MessageList.tsx:240-254`). Time-box the catch-up animation so a burst still reveals in ≤1 s.
3. **Request reasoning summaries (high perceived impact, trivial effort)** — add `summary: "auto"` to `reasoning` (`openai-provider.ts:124`); the provider, agent (`thought` events), SSE, and caption UI are already wired end-to-end. Turns the dead "thinking…" seconds into visible progress. (Costs some output tokens — flag to owner.)
4. **Conversation-mode routing for trivial text turns (high token+latency impact, medium effort)** — the classifier exists (`intent-classifier.ts:56-63`) but is bypassed for text (`chat.ts:244-247`). Route classifier-conversation text turns to the side model with no tools + an escalation path (model asks for tools → re-run in action mode). Saves ~7.7k input tokens and the orchestrator model on chit-chat.
5. **Trim the fixed prefix (medium impact, low effort)** — merge rubric+capabilities (~1-1.5k tokens), tighten the find_places/control_app/memory_remember descriptions (~300-500 tokens), drop the empty layers. Also set `prompt_cache_key` (one line in `responses.create`) for cache routing affinity, and defer observation writes to turn-end so mid-session memory writes don't bust the prefix.
6. **Parallelize independent tool calls (medium impact, medium effort)** — `Promise.all` over `pendingCalls` when all calls are read-only tier (`classify.ts:7-11` already defines the set), keeping sequential order otherwise (`agent.ts:249`).
7. **Summarization stride + budgeted history (cost, low effort)** — only re-summarize when ≥N (e.g. 10) new messages have accumulated since `summary_through_message_id` (`auto-summary.ts:27-33`); cap raw history by chars not count.
8. **Effort hygiene on side calls (cost, trivial)** — `complete()` should pass `reasoning: { effort: "minimal" }` (`openai-provider.ts:93-98`); today autoTitle/summarize burn default-medium reasoning, and autoTitle's `max_output_tokens: 32` can even be eaten by reasoning tokens.
9. **Shorter veto window for medium tier** (e.g. 5 s, env-tunable already exists via `APPROVAL_AUTO_APPROVE_MS` — `runtime.ts:42-45`) given the owner's act-first stance.

## 5. Feature ideas to make text mode FEEL faster

1. **Live "thinking ticker"** — with reasoning summaries enabled (#3 above), stream the model's own summarized thoughts into the ThinkingIndicator caption (plumbing exists: `agent.ts:90`, `MessageList.tsx:111-116`). The longest silent stage becomes visible progress.
2. **Progressive reveal** — words appear as deltas arrive (#2 above); for burst replies it degrades gracefully to the current reveal. "Reading starts at first token" instead of "at last token".
3. **Step HUD with elapsed time** — extend ThinkingIndicator/ActivityPanel with "step 3 · 14s · reading the page…" plus a live tail of tool output (shell stdout last line) — all data already flows through `tool_call`/`tool_result` events (`activity-steps.ts`, `ActivityPanel.tsx`).
4. **Instant acknowledgment line from the playbook match** — when recall (made non-blocking) matches, immediately render a one-liner above the indicator: "Known task — following my *find-local-businesses* playbook (5 steps)". Real information, zero model latency, and it reuses the side-call the system already pays for.
5. **Draft-while-thinking for thorough mode** — when reasoning=medium, fire a parallel minimal-effort side-model call and show its answer dimmed as "quick take — refining…", replaced by the real final. Genuine wow-factor, but it doubles per-turn OpenAI spend — given the owner's token scarcity, ship behind a toggle, off by default.

**Verification limits:** OpenAI automatic-cache behavior, actual reasoning durations, and the claim that summary events require the `summary` request param are API-side behavior consistent with the code but not provable from this repo; token counts are 4-chars/token estimates; tool-schema size is summed from source by hand (~±15%).

## Appendix C — Usability / UX (agent report)

# Ava Frontend UX Review — flows & affordances (aesthetic untouched)

Reviewed: `App.tsx`, `orbit/`, `chat/`, `memory/` (+ `MemoryBrain.tsx`), `rules/`, `self/`, `voice/`, `approvals/`, `sessions/`, `push/`, `splash/`, plus `sw.ts`, `api.ts`, `theme.css`, and the server's stream/kill routes where needed to confirm client behavior. All paths relative to `C:/ai/chemiapebi/yovlisshemdzle/`.

---

## 1. What already works well

- **Flat IA, 1 click to everything core.** Persistent TubelightNav (Home/New/Chats/Memory/Rules/Self) stays mounted across panels (`web/src/App.tsx:63-74, 206-213`). New chat, memory, rules, self are all 1 click from anywhere except voice.
- **Instant feedback on send.** The synchronous `pending` flag shows the thinking indicator the same frame as send, before the POST resolves (`web/src/chat/ChatScreen.tsx:34-38, 154-160`), with a THINKING/EXECUTING/RESPONDING chip + humanized live caption (`web/src/chat/ThinkingIndicator.tsx:25-29`, `web/src/chat/MessageList.tsx:111-122`).
- **Humanized tool language everywhere** — "Running git status", "Opening bing.com" instead of raw tool names (`web/src/chat/humanize.ts:24-51`), shared by chat chips, the Activity panel, and voice narration.
- **Stop is honest.** Composer swaps send→stop while busy (`web/src/chat/Composer.tsx:176-195`); a stopped run renders the partial reply instead of discarding it (`web/src/chat/MessageList.tsx:235-257`); voice `interrupt()` kills the server run, cancels realtime generation, and flushes both audio paths (`web/src/voice/useRealtimeVoice.ts:888-924`). Server kill also cancels self-improvements (`server/src/routes/chat.ts` kill route).
- **Approval flow is genuinely good in chat**: veto-window countdown bar mirroring the server's 15s auto-approve, expandable raw args, resolved-state breadcrumb (`web/src/approvals/ApprovalCard.tsx:25-31, 84-121`).
- **Undo on chat delete** (5s window, Flip reorder) (`web/src/orbit/ChatListScreen.tsx:24, 115-135`).
- **Reduced-motion is a first-class 3-way in-app preference** with default "full" per owner taste, consumed consistently across ~every animated component (`web/src/lib/motionPref.ts`, `web/src/rules/RulesScreen.tsx:215-230`), plus a CSS catch-all (`web/src/theme.css:459-466`). `aria-label`s are broadly present; the rule toggle is a real `role="switch"` (`web/src/rules/RulesScreen.tsx:304-313`).
- **Stale-PWA fix verified shipped**: `skipWaiting` + `clients.claim` (`web/src/sw.ts:12-13`) with `registerType: "autoUpdate"` (`web/vite.config.ts:12`).
- **Voice turn-taking engineering** (barge-in epochs, PTT min-audio guard, settle/fallback reopen) is careful and test-backed (`web/src/voice/voiceInputMode.ts`, `useRealtimeVoice.ts:280-330, 488-538`).

---

## 2. Friction list, ranked by impact on the owner's daily use

**F1 — A running task is invisible and unstoppable from anywhere but its own live chat.**
- `busy` (which gates the Stop button) is `runEpoch > 0` (`web/src/chat/ChatScreen.tsx:100`), and `runEpoch` is reset to 0 when a session is (re)opened (`ChatScreen.tsx:51, 64`). The server *does* replay the run's events on reconnect (`server/src/routes/chat.ts:484-488`), so tool chips/Activity reappear — but Stop and the thinking indicator do not (`ChatScreen.tsx:100, 130`). Reopen a chat whose task is mid-flight (started earlier, from voice, or from the phone) and you cannot stop it. needs-live-verification for the exact replay rendering, but the busy-gating is plain in code.
- Nothing outside ChatScreen shows that *anything* is running: nav has no activity indicator, Home is silent, the chat list shows `status` in its type but never renders it (`web/src/orbit/ChatListScreen.tsx:215-267`, `web/src/api.ts:49-57`).

**F2 — Push approval notifications dead-end.** The SW declares Approve/Deny action buttons (`web/src/sw.ts:39-44`) but `notificationclick` ignores `event.action` and just opens `deepLink` (`sw.ts:48-67`). The deep link is `/?approval=<id>` (`server/src/push/deliver.ts:65`) — and **no code in `web/src` reads `?approval=`** (grep: zero matches). So the flow is: notification → splash (1.7s) → Home → guess which chat → open it → hope the card is still pending, racing a 15s auto-approve timer. The buttons that look like one-tap approve/deny do nothing of the sort.

**F3 — No elapsed time, step durations, or run timeline.** During a long multi-step task you see the current humanized step + a checklist of done/running/queued (`web/src/chat/ActivityPanel.tsx:73-99`, `web/src/chat/activity-steps.ts:14-34`) — but no per-step or total elapsed time, no timestamps, no way to expand a *successful* step's output (only failures expand, `web/src/chat/MessageList.tsx:222-227`). For a power user who runs 10-minute tasks, "is it stuck?" is unanswerable. Voice mode has a timer; chat has none (`web/src/voice/VoiceScreen.tsx:52-57` vs nothing in chat).

**F4 — Voice is a modal dead-end; can't listen/talk while reading another screen.** Voice is a full view in the `View` union (`web/src/App.tsx:19-27`); navigating anywhere unmounts the hook and tears down the WS/mic (`web/src/voice/useRealtimeVoice.ts:1000`). The nav is hidden in voice (`App.tsx:74`), so reaching Memory while talking = exit voice (killing the session) → Home → Memory. Also no nav entry for Voice at all — from Memory/Rules/Self it's 2-3 actions (Home → Space/orb).

**F5 — Voice approval affordance contradicts the mic gating.** The card says "Say *yes* to approve" (`web/src/voice/VoiceScreen.tsx:140`), but mic audio is only forwarded while state is `listening` (`useRealtimeVoice.ts:741-746`, `voiceInputMode.ts:59-68`), and during a pending approval the state is `thinking` (`useRealtimeVoice.ts:400, 579-585`). Worse, in push-to-talk, pressing Enter to *say* "yes" first calls `interrupt()` — which `api.kill()`s the very run awaiting approval (`useRealtimeVoice.ts:930-941`, `voiceInputMode.ts:77-79`). needs-live-verification (a server-side path could exist), but the client gating strongly suggests "say yes" can't work and Enter-to-speak is destructive here.

**F6 — Reopening a finished chat likely duplicates the last reply.** `fetchSession` loads the final assistant message into history (`ChatScreen.tsx:54-65`); the stream then replays that same reply as `final`+`done` when no run is active (`server/src/routes/chat.ts:463-481`); the promote effect appends it again as `a-0` since ids don't match (`ChatScreen.tsx:74-95`). needs-live-verification, but no dedup exists in the path.

**F7 — Mobile: the Activity panel crushes the conversation.** It is a fixed `w-[280px]` flex column with zero responsive handling (`web/src/chat/ActivityPanel.tsx:45-52`) and it force-expands whenever a tool starts (`ChatScreen.tsx:143-147`). On a 390px phone that leaves ~100px for messages mid-task. Collapsed state persists in localStorage but is overridden by the auto-expand each run.

**F8 — Mobile: no safe-area handling.** `viewport-fit=cover` is set (`web/index.html:5`) but `env(safe-area-inset-*)` appears nowhere in CSS (grep over `web/src/theme.css`: zero). Sticky composer (`Composer.tsx:101`), voice controls at `bottom-8` (`VoiceScreen.tsx:206`), and nav at `top-6` (`App.tsx:207`) sit in notch/home-indicator territory on iPhone standalone. needs-live-verification on the actual device.

**F9 — Errors are terse and offline is unhandled.** Run errors render as one red line, `error: {message}` (`MessageList.tsx:232-234`) — no retry button on the error itself, no detail expansion. The SSE silently retries every 1s forever with no "reconnecting…" indicator (`web/src/chat/useChatStream.ts:41-44`). There are no `online`/`offline` listeners anywhere (grep: zero). A chat-list fetch failure is swallowed and renders the **"NO CHATS YET"** empty state — indistinguishable from having no chats (`ChatListScreen.tsx:44-49, 192-207`). Dismissing a voice error *exits voice entirely* (`VoiceScreen.tsx:149-155` — `onClose={() => onExit(...)}`).

**F10 — Misleading microcopy teaches the wrong mental model** (this matters for a user who discovers features only when told):
- Home: "HOLD SPACE TO SPEAK" (`web/src/orbit/OrbitScreen.tsx:60-62`) — actually *press* Space once to enter voice (`OrbitScreen.tsx:25-34`); nothing is held, and inside voice the PTT key is **Enter**, not Space (`pushToTalk.ts:27-37`).
- Empty chat: "hold the orb to speak" (`ChatScreen.tsx:213`) — the mic button is a tap (`Composer.tsx:167-175`).
- The orb button's `aria-label="hold to speak"` (`OrbitScreen.tsx:51`) repeats the error.
- The event-gap warning says "see Sessions for the full trace" (`MessageList.tsx:259-264`) — **SessionsScreen is dead code**, unreachable from any view (`web/src/sessions/SessionsScreen.tsx`, no imports anywhere; `App.tsx` View union has no sessions entry).

**F11 — Retry/Like/Share are partly fake.** Every Ava bubble shows Retry, but it always re-sends the *last* user message regardless of which bubble you clicked (`ChatScreen.tsx:149-152`; same `onRetry` passed to all bubbles, `MessageList.tsx:199, 280`). Like/Dislike toggle pure local state that is never persisted or sent anywhere (`web/src/chat/message-actions.ts:1-17`) — a feedback affordance that feeds nothing. No edit-last-message, no per-message regenerate, no actions at all on user bubbles (`MessageList.tsx:306-328`).

**F12 — Input ceiling.** Enter-to-send/Shift+Enter is the only shortcut in chat (`Composer.tsx:158-163`). Typing while busy silently no-ops on Enter (`Composer.tsx:86-92`) — no queueing, no toast. No paste/drag of images or files (no `onPaste`/`onDrop`; `api.sendMessage` is text-only, `api.ts:33-37`). No slash commands. **No search** — neither within a chat nor across chats (no UI in `ChatListScreen`, no endpoint in `api.ts`). No Escape-to-go-back anywhere (the only Escape handler in the app is the memory inline-edit input, `MemoryScreen.tsx:396`). No command palette.

**F13 — Destructive inconsistency.** Chat delete has undo; memory observation/preference delete (`MemoryScreen.tsx:97-99, 422-424`), rule delete (`RulesScreen.tsx:129-132`), and pinned-chip delete commit immediately with no confirm and no undo.

**F14 — 3D brain on touch.** Zoom is wheel-only (`MemoryBrain.tsx:756`); `touchAction = "none"` kills native pinch and no two-pointer handler exists (`MemoryBrain.tsx:352`) — so phones cannot zoom at all, while the hint says "scroll to zoom" (`MemoryScreen.tsx:222-224`). Hover-reveal labels are pointer-hover-driven (`MemoryBrain.tsx:629-641`) — fine on desktop, hidden on touch until a tap opens the inspector. DPR is sensibly capped at 1.5 (`MemoryBrain.tsx:345`) and reduced-motion renders a static frame, so perf is respected.

**F15 — Splash tax.** Fixed 1700ms intro on every cold open, not skippable by tap/key (`web/src/splash/Splash.tsx:12-15`). On desktop-primary daily use this is pure latency.

**F16 — Smaller a11y/feedback gaps.** SegmentedTabs convey active state visually only (no `aria-pressed`/tablist semantics, `SegmentedTabs.tsx:56-72`). PanelSection clickable headers (Personality/Projects disclosures) are plain `<header onClick>` — no keyboard access, no role (`PanelShell.tsx:117-123`, `MemoryScreen.tsx:145-190`). Message action buttons are 28px (`MessageActions.tsx:19`) and the collapsed Activity tab is a ~20px-wide strip (`ActivityPanel.tsx:21-41`) — small on touch. Nav buttons are ~32px tall, icon-only on phones (`TubelightNav.tsx:45-48`). The "Full ignores Windows reduce-motion" promise (`RulesScreen.tsx:227-229`) is contradicted by the OS-keyed CSS kill-switch which still freezes all CSS keyframes (`theme.css:459-466`) — with OS reduce-motion on + app "Full", GSAP animates but orb-morph/nebula/chrome stop: a mixed state.

---

## 3. Improvements ranked by impact × effort (quick wins first)

1. **Copy truth pass** (minutes): "PRESS SPACE TO SPEAK"; "tap the orb"; fix `aria-label`; remove/replace the "see Sessions" gap text; in PTT show "↵ to talk" consistently. Fixes F10 with zero design change.
2. **Don't exit voice on error dismiss** — give the Alert its own dismiss; keep Exit as the X (F9; `VoiceScreen.tsx:149-155`).
3. **Distinct error state in chat list** (`ChatListScreen.tsx:44-49`) — set an `err` state like MemoryScreen does.
4. **Escape = back** globally (panels → Home, voice → previous, inspector → close). One window listener in `App.tsx`. (F12)
5. **Elapsed time on the thinking row + per-step durations in Activity** — timestamps already exist on events server-side; client can timestamp on arrival. Make completed steps tap-to-expand their result like failed chips do. (F3)
6. **Derive `busy` from the stream, not `runEpoch`** — e.g. "saw any event for an epoch without its done/killed/error" → Stop and the indicator survive reopen/another-device runs. Small, fixes the worst of F1.
7. **Dedupe the replayed final** against the last history assistant message (F6).
8. **Safe-area insets** on nav top, composer bottom, voice control row (3 CSS `env()` paddings) (F8).
9. **Memory/rule delete undo** — reuse the exact pending-delete pattern from ChatListScreen (F13).
10. **Activity panel responsive behavior** — below `sm`, render it as the collapsed edge tab by default and as a slide-over (not a column) when expanded; drop the auto-expand on mobile (F7).
11. **Queue-while-busy**: Enter while busy enqueues the message and shows it dimmed under the composer, auto-sent on run end (F12).
12. **Handle `?approval=<id>`** on boot: skip splash, open the owning chat, scroll to the card; and make SW `event.action` post approve/deny (or at minimum route through the deep link) (F2).
13. **Edit-last-message**: up-arrow in an empty composer prefills the last user message (kill current run if needed), per-bubble retry only on the last turn (F11).
14. **Pinch-to-zoom + touch hint for the brain** (two-pointer distance → dolly; swap hint text by pointer type) (F14).
15. **Skippable splash** (any key/tap → onDone) or skip when warm (`sessionStorage`) (F15).
16. **Persist reactions or remove them** — a dead thumbs-up erodes trust in every other control (F11).
17. **Update-ready toast**: surface `onNeedRefresh`/`controllerchange` as a small deck chip ("deck updated — tap to reload") so the skipWaiting fix is *visible*; whether the open PWA currently self-reloads is needs-live-verification (`vite.config.ts:12`, `sw.ts:12-13`).

---

## 4. UX-level feature ideas (deck-native)

1. **Command palette (Ctrl+K / long-press orb)** — a cyan glass overlay over the dotted surface: fuzzy-jump to chats, "new chat", "voice", "stop current run", "toggle fast/thorough", "pause self-dev", memory search. Single highest-leverage discoverability fix — it makes every buried feature typeable, and matches the HUD/mono aesthetic (reuse `CommandBar` styling).
2. **Run ticker on the deck nav** — while any session has a live run, a small pulsing `--ac-live` dot docks beside the TubelightNav with the current humanized tool + elapsed (`Running git status · 0:42`); click → jump to that chat; hold/right-click → global Stop. Kills F1 entirely and gives the "Ava is working" ambient signal the owner currently only gets inside one screen.
3. **Inline tool-run cards with a timeline rail** — upgrade the Activity column to a vertical timeline (the cyan spine pattern from SelfScreen, `SelfScreen.tsx:174-180`): each step gets start time, duration, ok/fail dot, expandable args/result; the rail persists into the transcript after the run so past tasks remain auditable (today steps exist only while the live event array is in memory).
4. **Notification center lamp** — one bell slot on the deck collecting: pending approvals (with the countdown), finished long runs ("task done — view result"), self-improvements awaiting plan approval, and SW "update ready". Each entry deep-links. This is the natural landing target for push taps (pairs with improvement 12).
5. **Cross-chat search** — a search field above "All chats" hitting a server FTS endpoint; results as `hud` mono rows (chat title · matched line with the term lit in `--ac`); Enter opens the chat scrolled to the message. The owner currently has zero recall over past runs.
6. **Quick-reply chips under Ava's last reply** — the chip pipeline already exists (`fetchSuggestedChips`, pinned chips in Rules); generate 2-3 contextual follow-ups per reply ("show me the diff", "run it", "explain why") rendered in the existing chip style above the composer. Cheap, big keystroke savings.
7. **Voice pip (picture-in-picture orb)** — instead of unmounting voice on navigate, allow "minimize": the live orb shrinks to a 56px floating disc bottom-right (state colors + amplitude intact, GSAP Flip does the transition — the `flipId="ava-orb"` machinery already exists) while you browse Memory/Rules; tap to re-expand, long-press to end. Directly answers "can I use voice while reading another screen" (F4) without restyling anything.
8. **"What's new on the deck" feed on Self** — surface the existing server-side changelog/claude-updates (`server/src/self/changelog`, claude-note log) as a read-only journal section. The owner currently learns about shipped features only when Ava mentions them in chat; this gives the information a permanent, glanceable home in an existing screen.

---

### Needs-live-verification summary
- Duplicate final bubble on reopening finished chats (F6) — code path strongly indicates it; confirm in browser.
- Voice "say yes" approval and PTT-Enter-kills-run (F5) — client gating is clear, but a server-side voice-approval path could exist.
- Whether an already-open PWA hot-reloads on SW activate (vs. next visit) with `registerType:"autoUpdate"` + injectManifest.
- iPhone standalone notch/home-indicator overlap (F8) and actual touch-target comfort of the 32px nav.
- Resumed-run rendering (Activity repopulating from replay) — replay buffer exists server-side; visual result unconfirmed.

## Appendix D — Task capability (agent report)

# Ava Task-Capability Review — Tools, Gaps, Robustness

Repo root: `C:/ai/chemiapebi/yovlisshemdzle`. All citations below are under `server/` at that root (e.g. `src/tools/shell.ts` = `C:/ai/chemiapebi/yovlisshemdzle/server/src/tools/shell.ts`).

Tool assembly point: `src/routes/chat.ts:374-422` (action mode gets the full stack; conversation/voice mode gets only `control_app`, discuss, memory, and update-log tools, `chat.ts:417-422`). Dispatch, budgets, and policy run through `src/orchestrator/agent.ts:249-302`.

---

## 1. Tool Inventory (complete — 27 registered in action mode, 3 of them inert)

| Tool | What it does | Input surface | Budget (orchestrator) | Quality notes |
|---|---|---|---|---|
| `shell` (`src/tools/shell-tool.ts:14`) | Any PowerShell 5.1 command; allow-by-default, destructive blocklist + .env/secret-file hard-block (`src/tools/shell-allowlist.ts:90-114`) | `{command}` only — **no cwd, no timeout override, no background flag** (`shell-tool.ts:27-33`; `runShell` supports cwd but it's never passed, `src/tools/shell.ts:12`) | 30s (`src/orchestrator/timeout.ts:2`), internal tree-kill at same 30s | PID registered for Stop (`shell-tool.ts:45-46`); tree-kill on timeout/abort (`shell.ts:53-58`); output scrubbed then truncated to **4,096 chars** (`shell-tool.ts:7`); no retry; exit code surfaced |
| `control_app` (`src/tools/control-app-mcp.ts:116`) | Native-app UI Automation + SendKeys via a .ps1 spawned directly (avoids cmd.exe quoting bugs, `:1-18`); no API cost | `{script}` (free-form PowerShell) | 30s (`timeout.ts:8`) | Same destructive/secret gate as shell (`:150-153`); UTF-8 BOM handling (`:160-166`); output 6,000 chars, scrubbed; PID-registered; **completely blind — no screenshot/verification of what it typed** |
| `fs_read` (`src/tools/filesystem-mcp.ts:38`) | Read UTF-8 file within fsRoots (`C:/ai/**`, `C:/projects/**`, `C:/Users/nikug/**`, `src/config.ts:66`) | `{path}` — **no offset/limit** | 5s | Truncates at **8,192 chars** (`filesystem-mcp.ts:6`); secret-scrubbed; junction/symlink-resolved secret block (`src/security/path-allowlist.ts:61-101`) |
| `fs_write` (`filesystem-mcp.ts:59`) | **Full overwrite only** — no append, no patch | `{path, content}` | 5s | mkdir -p of parents (`src/tools/filesystem.ts:41-47`); classified low → instant (`src/policy/classify.ts:48`) |
| `fs_list` / `fs_stat` (`filesystem-mcp.ts:75,95`) | One-level dir listing; size/mtime/isDir | `{path}` | 5s | Read-only tier → instant |
| `fs_delete` (`filesystem-mcp.ts:115`) | Single file / empty dir only (`recursive:false`, `filesystem.ts:79`) | `{path}` | 5s | High tier → 15s veto that **auto-DENIES** on expiry (`classify.ts:46`, `src/policy/runtime.ts:81`) |
| `claude_code` (`src/tools/claude-code-mcp.ts:29`) | Spawn `claude -p --permission-mode acceptEdits` in an allowlisted cwd — the only real multi-file edit path | `{prompt, cwd, model?}` | 600s, internal SIGTERM→SIGKILL at 595s so the child can't zombie (`claude-code-mcp.ts:11-15`) | Subscription auth (strips `ANTHROPIC_API_KEY`, `claude-code.ts:59-64`); blocks `--dangerously-skip-permissions` (`:35,82-84`); output capped 16,384; abort-kill ladder (`:134-143`); **medium tier → every call stalls 15s for the veto window** |
| `chrome_navigate/click/type/press_key/read_page/screenshot/tabs` (`src/tools/chrome-mcp.ts:37-144`) | Drive one persistent, headed Chromium profile (logins persist); lazy boot on first use (`chrome-mcp.ts:16-24`, rebuild-if-closed `src/index.ts:93-109`) | url / CSS selector / text / key | 5-30s each (`timeout.ts:5-6`) | `read_page` truncated at 8,192; `chrome_screenshot` returns a **file path the model cannot see**; **no tab-switch, scroll, back, wait-for, download, or upload tools**; new tab/popup silently steals the active page (`src/tools/chrome.ts:55-61`) |
| `computer_use` (`src/tools/computer-use-mcp.ts:19`) | Nested vision loop — **browser tab only** (surface = the Playwright page; `environment:"browser"`, `src/tools/computer-use.ts:280`); Anthropic `claude-sonnet-4-5` preferred (hardcoded `computer-use.ts:93`), OpenAI `computer-use-preview` fallback | `{task}` | **60s** (`timeout.ts:7`) — but the inner loop allows **100 model iterations** (`computer-use.ts:63`) → guaranteed budget blowout + zombie (see Robustness #2) | Abort-checked per iteration (`:90`); screenshots collected to disk; LIVE (both API keys present in `.env`) |
| `take_screenshot` (`src/tools/screenshot/screenshot-mcp.ts:20`) | Desktop PNG via PowerShell System.Drawing → `Downloads/Ava/screenshots` (path-jailed, `screenshot.ts:83-98`) | `{path?}` | 30s default | Returns **path + bytes only — the agent loop is text-only and never sees the image** (`src/orchestrator/llm/types.ts:19-23`) |
| `self_improve` (`src/tools/self-improve-mcp.ts:3`) | Queue a change to Ava's own code; explicit trigger → plan-gated | `{goal}` | 30s default (returns instantly) | See §4 |
| `self_improve_status` (`self-improve-mcp.ts:37`) | List/detail intents (queued→…→swapped/failed) | `{id?}` | 30s default | Reads DB; honest per-state phrasing |
| `read_logs` (`src/tools/activity-log-mcp.ts:4`) | Tail Ava's own pino logs (newest file, last 4,000 lines, ≤100 entries) | `{level?, contains?, limit?}` | 30s default | Read-only in nature but **not in the read-only classifier set → pays the 15s medium-tier stall** (`classify.ts:7-11,104`) |
| `shopify_list_products` / `shopify_get_product` / `shopify_update_product` (`src/tools/shopify-mcp.ts:39-152`) | Admin REST 2024-10: list/filter, read full body_html, PUT title/description; never sends images | `{limit?, query?}` / `{id}` / `{id, title?, body_html?}` | 30s default; 20s per HTTP request (`shopify-mcp.ts:9,35`) | **INERT — `SHOPIFY_STORE`/`SHOPIFY_ADMIN_TOKEN` are absent from `server/.env` (verified by name-only listing), so the tools are never registered** (`src/index.ts:287-288` → `chat.ts:406`). No 429/backoff handling |
| `find_places` (`src/tools/places-mcp.ts:36`) | Google Places API (New) text search; multi-query fan-out (≤12 queries × ≤4 pages), dedupe, website-presence filter — the lead-gen tool | `{query?, queries?, maxResults?, websiteFilter?}` | **30s default — too small for the fan-out the tool description itself recommends** (`places-mcp.ts:47-51`; 20s per request `:94`) | **LIVE** — `GOOGLE_PLACES_API_KEY` present in `.env` (value length 39). Unclassified → 15s stall per call |
| `discuss_with_claude` / `read_discussion` (`src/tools/discuss-mcp.ts:10,32`) | Background **read-only** `claude -p` consult on the repo (5-min cap, `index.ts:254`); result relayed into the session + push (`index.ts:260-266`); DB-persisted | `{topic}` / `{id?}` | 30s default (queue returns instantly) | The only truly backgrounded task pattern in the system; stale rows failed at boot (`index.ts:79-83`) |
| `memory_read` / `memory_remember` / `memory_forget` (`src/tools/memory-mcp.ts:10,58,141`) | Durable memory: preferences/observations/projects, refresh/supersede/forget semantics | enums + text | 30s default | `memory_read` is in the read-only set (instant); remember/forget low → instant |
| `read_claude_updates` (`src/tools/update-log-mcp.ts:13`) | Read Claude's dev-log notes (honest attribution) | `{limit?}` | 30s default | Unclassified → 15s stall |
| Voice: `do_on_computer` (`src/routes/voice-realtime.ts:197-210`) | The realtime voice model's only tool — loops back into the full `/api/chat` agent over loopback (`index.ts:396-467`); preempts a stuck prior run via kill+retry on 409 (`index.ts:418-426`) | `{task}` | n/a | Per-step `ava.step` frames narrated via client TTS (`voice-realtime.ts:580-588`, step events read off SSE `index.ts:451`) |

**Dead/inert summary:** `shopify_*` (3 tools, no creds — owner's APIs-over-UI-automation choice is wired and tested, `shopify-mcp.test.ts`, just waiting on creds). Hume voice path: keys present but zero credits and no tools (known gap). Everything else is live. The `rules` allowlist system exists (`src/policy/rules.ts`) but the live DB contains exactly one rule and it **failed to parse** (`parsed: null, status: failed`) — so no rule-based allows are active.

---

## 2. Top Capability Gaps (ranked by value to this user)

1. **Email + Calendar — nothing exists.** Zero hits for gmail/imap/smtp/outlook/calendar in `src/`. "Read my email, reply to X, put it on my calendar" — the bread-and-butter assistant tasks — fail today or degrade to blind browser/SendKeys driving. Cheapest: Gmail API + Google Calendar API with a one-time desktop OAuth flow, tokens in `server/.env`; ~5 tools (`email_search/read/send/draft`, `calendar_list/create`). The Shopify tool file is a perfect template for the shape.
2. **No scheduled/recurring tasks.** No cron/scheduler anywhere (`grep cron|schedule`: only the intent-type string). "Every morning at 8, check X and ping me" is impossible. The pieces all exist: a SQLite table + interval loop in `index.ts` that POSTs a stored prompt through the existing loopback-chat pattern (`index.ts:396-467`) and delivers via the existing `notifyDone` push. The "overnight" self-improve loop is itself only a **manually launched script** (`scripts/auto-improve-loop.ts:129` — the only creator of `trigger:"schedule"` intents; the 3 schedule-triggered swaps in the DB are from manual runs).
3. **Surgical file editing — currently a corruption hazard.** `fs_write` is overwrite-only (`filesystem.ts:37-51`) and `fs_read` truncates at 8,192 chars (`filesystem-mcp.ts:6`) with no offset/limit — so the natural read-modify-write loop on any file >8KB **writes back a truncated file**. The only safe edit path is a 15s-stalled, up-to-10-minute `claude_code` run. Cheapest fix, no creds: an `fs_edit` tool (exact old→new string replace, error if not-unique) + `offset/limit` params on `fs_read`.
4. **No background/long-running jobs.** Every tool call is synchronous inside the turn; `shell`'s 30s cap kills `npm install`, builds, large downloads, ffmpeg jobs — with no override and no "run in background". Only `discuss_with_claude` is backgrounded; generalize that exact pattern (DB row + fire-and-forget + relay into session + push, `src/state/discussions.ts`) into `job_start/job_status/job_kill` with pidfile registration.
5. **Desktop vision — Ava cannot see the screen.** `take_screenshot` returns a path; tool results are text-only (`llm/types.ts:19-23`); `computer_use`'s vision is confined to the browser tab (`computer-use-mcp.ts:49-50`). So `control_app` types into native apps **blind** — the system prompt even claims "I use this to see what is on screen" (`src/orchestrator/tool-rubric.ts:29-31`), which is currently false. Cheapest: a `describe_screen` tool — capture + one Anthropic/OpenAI vision call returning text (key already present); next step: a desktop `ComputerSurface` so `computer_use` can drive native apps.
6. **Browser robustness ceiling.** No tab switch (tabs are listed but unselectable), no scroll tool, no wait-for-selector, no back, popups steal the active page (`chrome.ts:55-61`), downloads vanish (no `download` handler in `chrome.ts`), no file upload. Each is a ~20-line Playwright addition.
7. **No lightweight web fetch/search.** Every web lookup boots headed Chromium and scrapes innerText. A `fetch_url` tool (plain HTTP + text extraction) plus an optional search API key (Brave/Tavily) would make read-only lookups ~10x faster and free the shared browser.
8. **Messaging (WhatsApp/Telegram).** Today: blind `control_app` SendKeys. Cheapest real fix: Telegram Bot API (one token, trivial HTTP) for Ava↔Sir messaging; WhatsApp Web via the existing persistent-login Chromium for sends.
9. Clipboard and Office docs: clipboard is already coverable via `shell` (`Get-Clipboard`/`Set-Clipboard`) — fine. Office creation has no path beyond shell-scripted COM/python; lower priority.

---

## 3. Robustness Issues (ranked, with evidence)

1. **A 5-minute hard wallclock kill nullifies the 1000-step design.** `createStuckLoop` halts on the **first tool_result arriving ≥5 minutes after run start, regardless of progress** (`src/orchestrator/stuck-loop.ts:1,64-67`; unit test confirms the semantics, `stuck-loop.test.ts:33-42`). The agent then aborts the run as "stuck" with "I've been trying for a while without progress, Sir. Halting." (`agent.ts:97-102`). This directly contradicts the lifted turn cap's stated intent — "real tasks... must never be cut off mid-work" (`agent.ts:146-153`) — and the 600s `claude_code` budget: a 6-minute coding task completes its file edits, then the run is killed before the model can read or report the result. Every multi-phase task (the Shopify-style edits, lead-list sweeps, long browses) dies at ~5 minutes. Fix: make the wallclock a true *no-progress* clock (reset on successful, novel tool results), or raise/remove it and rely on the no-progress window + Stop.
2. **`computer_use` zombie loop racing the shared browser.** Orchestrator budget is 60s (`timeout.ts:7`) but the inner loop runs up to 100 model iterations (`computer-use.ts:63,87`). `withTimeout` only rejects the promise — nothing cancels the dispatched work (`agent.ts:283`, `timeout.ts:11-34`), and the loop's only exit is the *run-level* abort (`computer-use.ts:90`), which a timeout doesn't fire. After 60s the agent moves on while the orphaned loop keeps clicking/screenshotting the **same shared page** the next `chrome_*` call is using, and keeps spending API credits invisibly. Fix: pass a per-dispatch AbortController into ctx and abort it in the `withTimeout` rejection path, and/or give `computer_use` an internal deadline like `claude_code`'s kill margin (`claude-code-mcp.ts:11-15`).
3. **15-second approval tax on every unclassified tool — including read-only ones.** Unknown tools default to medium → "ask" (`classify.ts:104`, `enforce.ts:33-37`) → approval row + push + 15s veto wait (`runtime.ts:81-84`). That hits `find_places`, `read_logs`, `read_claude_updates`, `read_discussion`, `discuss_with_claude`, `self_improve_status`, and `shopify_*` once enabled — plus `claude_code` (explicitly medium, `classify.ts:60`) on **every call**. Verified live: the rules table holds one rule and it failed to parse, so nothing rescues this. For a "maximum speed" north star, the API tools added *for speed* are the slowest to start. Fix (keeps the destructive gates intact): classify the read/query tools read-only/low and `find_places`/`shopify_list/get` low; leave `shopify_update_product`, `self_improve`, `claude_code` as-is if desired.
4. **No mid-task durability: restart loses everything in flight.** Recovery kills orphan PIDs and marks active sessions "interrupted" with a "send a new message to continue" note (`src/state/recovery.ts:14-31`) — there is no checkpoint/resume. Tool calls/results live only in the in-memory `messages` array; the `tool_calls` DB table exists but is **never written** (`src/state/schema.sql:23`; no INSERT anywhere), and the next turn rebuilds context from user/assistant text only (`chat.ts:228-233`). So the step-budget-exhausted promise "tell me to continue and I'll pick up where I left off" (`agent.ts:313`) resumes with no memory of which items were already processed. Cheapest: persist tool_call/tool_result rows (the table is already there) and inject a compact "previous run progress" digest on continue.
5. **`find_places` budget mismatch.** The tool description instructs the model to fan out up to 12 queries (`places-mcp.ts:47-51,12-13`), but the tool isn't in `TOOL_BUDGET_MS` so it gets the 30s default (`agent.ts:278`) while each request alone may take 20s (`places-mcp.ts:94`). Big sweeps — its whole purpose — will be rejected at 30s while the fetches continue ownerless. Give it its own generous budget and thread `ctx.signal` into the fetches.
6. **Shell ergonomics undermine multi-step work.** No `cwd` parameter despite `runShell` supporting it (`shell-tool.ts:39-47` vs `shell.ts:12`) — every command runs in the server's cwd and each call is a fresh process, so the model must re-`Set-Location` per call; 4,096-char output cap (`shell-tool.ts:7`) chops build logs; 30s cap (above). Cheap: add `cwd?` and `timeoutMs?` (capped) to the schema.
7. **Popup/tab steal with no recovery tool.** Any new page becomes the active page (`chrome.ts:55-61`); with no `chrome_switch_tab`, a stray popup permanently derails the browsing session until navigation resets it.
8. **No automatic retry anywhere** — single-shot fetches with no backoff (e.g. Shopify 429s, `shopify-mcp.ts:25-37`). Consistent with the "never retry silently" honesty rule (`tool-rubric.ts:76`), but it means transient network blips cost whole turns; a single tagged retry on idempotent GETs would be safe.

**What's genuinely solid (verified):** Stop's kill chain works end-to-end — abort signal into every tool ctx (`agent.ts:127-130`), pidfile-tracked children tree-killed at the kill endpoint (`chat.ts:517-543`), shell/control_app/claude_code all register PIDs and tree-kill on abort/timeout, orphans reaped at boot (`index.ts:89`, `recovery.ts:14-21`), Stop also cancels self-improvements (`chat.ts:541`) and pending approvals resolve as expired-not-approved (`src/state/approvals.ts:110-126`). Error feedback to the model is good: structured `is_error` results (`tool-registry.ts:62-73`), a malformed-args sentinel that never runs garbage (`tool-registry.ts:53-61`), and a post-failure injection forbidding false success claims (`agent.ts:299-302`, `tool-result-consistency.ts:98-103`). Playbook learning from successful runs is a real differentiator (`chat.ts:296-330`, `src/playbooks/store.ts`). Secrets are scrubbed before truncation in every output path.

---

## 4. Self-Improvement Pipeline (capability summary + structural risks)

Pipeline (`src/self/improver.ts:93-183`, wiring `index.ts:140-238`): **reflect** (LLM brief via OpenAI) → **plan gate** for user-triggered runs (parks at `awaiting_approval`, approve/reject/cancel resolves it, `improver.ts:118-138`) → **implement** in a throwaway git worktree under tmpdir via a `claude -p acceptEdits` worker → **verify** (tests + build + boot-smoke; flightcheck is report-only and never gates, `index.ts:174-185`) → commit → **`assertSwapSafe`** (refuses diffs touching security/policy/approval/self-machinery) → **fast-forward-only `swapTo`** (refuses to drop concurrent commits, `src/self/swap.ts:15-30`) → detached **watchdog** that reverts if health fails, skipping rollback if newer work landed (`swap.ts:39-53`, `index.ts:213-224`). Stoppable everywhere (red Stop cancels all, `improver.ts:82-91`); single-flight with FIFO queue (`improver.ts:32-33`); orphaned intents failed at boot (`index.ts:65-68`).

Structural risks to task capability:
- **Hot-swap = `git reset --hard` on the live repo** (`swap.ts:29`) while `tsx watch` reloads the server — any in-flight chat run dies mid-task, and it collides with concurrent human dev work (the fast-forward guard protects *commits*, not uncommitted edits). Known hazard; worth an "are runs active?" check before swap.
- **Track record: 11 of 21 intents failed, 1 rolled back, 9 swapped** (live DB). Each failure burns OpenAI reflect tokens — relevant given OpenAI scarcity.
- The "overnight loop" is a manual script, not a service (`scripts/auto-improve-loop.ts`) — there is no in-server scheduler that could run it unattended (ties into Gap #2).
- `restart` is a no-op relying on tsx watch (`index.ts:210`) — fine in dev, a gap for any pm2/prod future.

---

## 5. New Capability Ideas (ranked by value × feasibility)

1. **`fs_edit` + ranged `fs_read`** — exact-string replace with uniqueness check; `offset/limit` on read. Removes the active file-corruption hazard, makes small edits instant instead of a 10-minute claude_code run. ~1 day, no creds. Surface: `src/tools/filesystem.ts` + `filesystem-mcp.ts`.
2. **Gmail + Google Calendar tools** — Google APIs, one desktop OAuth, tokens in `.env`, registered conditionally exactly like Shopify (`chat.ts:406-407`). Highest daily utility of anything on this list.
3. **Recurring scheduler** — `scheduled_tasks` table + a 30s interval loop in `index.ts` that fires due prompts through the existing internal-token loopback chat (`index.ts:396-467`) and pushes results via `notifyDone`. Also gives the overnight self-improve loop a real home. ~1-2 days, no creds.
4. **Background job manager** — generalize the discussions pattern (`src/state/discussions.ts` + fire-and-forget runner + session relay + push) into `job_start` (shell or task prompt), `job_status`, `job_kill`; register PIDs so Stop and boot-recovery already work. Lifts the 30s shell ceiling for installs/builds/downloads.
5. **Desktop vision loop** — `describe_screen` (existing `takeScreenshot` + one vision-model call → text) now; then a desktop `ComputerSurface` (PowerShell or nut-js mouse/keyboard + the existing capture) so `runComputerUse` can drive native apps, not just the browser tab. Uses the Anthropic key already in `.env`. This is what makes `control_app` trustworthy.
6. **`fetch_url` + search API** — plain HTTP fetch with readability extraction (no Chromium boot) + Brave/Tavily search (one key). Faster lookups, frees the shared browser, fewer computer_use credits.
7. **Parallel subagent fan-out** — a `spawn_task` tool creating N concurrent child sessions via the loopback pattern; **prerequisite:** per-run browser contexts or a browser pool, since cross-session concurrency currently races one shared page (acknowledged at `index.ts:111-114`).
8. **Telegram bridge** — bot token in `.env`, ~150 lines: Ava can message Sir (and receive commands) off-Tailscale; doubles as the delivery channel for scheduled tasks and background-job completions.

## Appendix E — Efficiency & reliability (agent report)

# Ava Efficiency & Reliability Review (read-only, 2026-06-10)

## 1. Token budget per typical message

### 1.1 Main agent call (every typed turn = "action" mode, `gpt-5.5`)

Every typed message — including "thanks" — takes the full action path: orchestrator model + full tool stack (`server/src/routes/chat.ts:236-247`; the regex intent classifier at `server/src/orchestrator/intent-classifier.ts:56-63` is only trusted for voice). Models: `gpt-5.5` orchestrator / `gpt-5` side (`server/src/orchestrator/llm/openai-provider.ts:82-83`).

System prompt, assembled per run (`server/src/orchestrator/system-prompt.ts:57-93`), measured from live files:

| Layer | Source | Size |
|---|---|---|
| Persona | `server/data/memory/personality.md` | 3,905 chars |
| Capabilities map (static) | `orchestrator/capabilities-content.ts:12-90` | ~4,400 chars |
| Memory index | `MEMORY.md` absent in live dir → skipped | 0 |
| Preferences | `server/data/memory/preferences.md` | 2,209 chars |
| Observations (auto-pruned at 2k-token soft cap, `memory/budgets.ts:3-9`) | `observations.md` | 2,830 chars |
| Tool rubric (action only, byte-stable) | `orchestrator/tool-rubric.ts:3-110` | ~5,700 chars |
| fsRoots block | `system-prompt.ts:45-55` | ~450 chars |
| **Total (action)** | | **~19.5k chars ≈ 4.9k tokens** |

Tool schemas: 26 tools wired per action turn (counted from `routes/chat.ts:385-411` + the `name:` grep across `server/src/tools/*-mcp.ts`; Shopify/Places inert without creds). Descriptions are lean (shell ~620 chars `tools/shell-tool.ts:18-26`; memory_remember ~250 `tools/memory-mcp.ts:62-63`); serialized total ≈ **9k chars ≈ 2.2-2.5k tokens**.

History: summary (≤1,024 output tokens, `orchestrator/auto-summary.ts:41-46`) + messages after `summary_through_message_id`, else all (threshold 50, keep 20 — `auto-summary.ts:21-23`, `chat.ts:213-219`). Tool calls/results from prior turns are *not* persisted/resent (`chat.ts:228-233`) — good.

**First step of a typical turn ≈ 8-10k input tokens.** Each agent-loop step resends everything plus accumulated tool results (truncation caps: shell 4,096 `shell-tool.ts:7`, fs/chrome 8,192 `filesystem-mcp.ts:6`/`chrome-mcp.ts:112`, control_app 6,000 `control-app-mcp.ts:30`). A 10-step browsing run reaches ~25-40k input tokens on its final step; cumulative ~150-250k input tokens/run, mostly cache-discounted (see 1.3).

### 1.2 Hidden side calls per turn

- **`matchPlaybook` — every typed action turn** (51 playbooks live in `server/data/memory/playbooks/`): index ~7KB ≈ 1.8k tokens to `gpt-5` (`playbooks/match.ts:9-17`, gated only by non-empty index, `chat.ts:258-286`). Even "ok thanks" pays this.
- **`maybeSummarize` — O(N²) re-summarization.** Once a session passes 50 messages, *every* turn re-sends the ENTIRE transcript from message 0 to N-20 (`auto-summary.ts:24-35`: `all.slice(0, cutoffIndex)`, not since-last-summary), and `throughId` moves every turn so the dedupe guard at `auto-summary.ts:32-33` never skips. Voice always resumes the most-recent session (`voice-realtime.ts:863-866`), so sessions get long. At 300 messages this is ~15-40k side-model tokens *per turn*. **Likely the single biggest hidden burner.**
- `distillPlaybook` after every successful ≥2-tool run (`playbooks/capture.ts:17`), `autoTitle` once per session (`chat.ts:154-164`), chip labels with 24h cache (`orchestrator/chip-summarizer.ts:29-49`). Minor.

### 1.3 Prompt caching

- Structure is deliberately cache-friendly: real `priorMessages` array (`orchestrator/agent.ts:54-59`), byte-stable rubric/capabilities (`tool-rubric.ts:1-2`, `capabilities-content.ts:10-11`), volatile greeting/summary/playbook prefixes ride the final user message (`chat.ts:223-227, 288`).
- But nothing is verified or tuned: no `prompt_cache_key`, and `response.completed`'s usage block (with `cached_tokens`) is ignored (`openai-provider.ts:117-126, 206-214`). Cache hit rate is **unmeasurable today**.
- Cache-buster: observations sit *before* the rubric+fsRoots (`system-prompt.ts:81-87`), so every `memory_remember` invalidates the ~6.2k-char static suffix too.
- **Reasoning items are dropped between tool steps**: `toResponsesInput` rebuilds input from text/function_call/output only (`openai-provider.ts:23-54`); no `previous_response_id` in the agent loop (it *is* used in `tools/computer-use.ts:408`). For gpt-5.x tool loops OpenAI recommends returning reasoning items — omitting them forces re-reasoning every step (extra output tokens + weaker cache).
- Reasoning defaults are frugal: conversation `none`→"minimal", action `low` (`agent.ts:181-182`); user toggle maps fast/thorough → low/medium (`orchestrator/reasoning.ts:6-9`); voice forces `none` (`chat.ts:289-291`). No `max_output_tokens` on stream calls (`llm/types.ts:36-52`) — outputs unbounded.

### 1.4 Voice economics

- **Hybrid (realtime model speaks) is now always-on for OpenAI**: `hybrid = !!deps.runAction` (`voice-realtime.ts:789`) and `runAction` is wired unconditionally (`index.ts:478-487`); engine pref is only `openai|hume` (`state/voice-engine-pref.ts:13`). The cheaper transcribe-only path is unreachable. Chitchat is billed at realtime *audio* token rates.
- Per connect: ~13.4k-char conversation-mode system prompt + voice persona + updates block as instructions (`voice-realtime.ts:839-854`) + 12 seeded turns (`REALTIME_SEED_TURNS`, `voice-realtime.ts:871-888`).
- WS upstream held open while the voice screen is open — no server idle timeout (none in `buildRealtimeProxy`); mic audio streams continuously in VAD mode (`web/src/voice/useRealtimeVoice.ts:741-753`). I cannot verify from code whether OpenAI bills uncommitted buffered audio.
- Transcription: `gpt-4o-transcribe` per utterance (`voice-realtime.ts:70-75`); push-to-talk text-chat mic uses the same model via `/api/transcribe` (`routes/voice.ts:50-53`).
- **Chatterbox (free, local) is retired**: `/api/speak` always uses paid `gpt-4o-mini-tts` (`routes/voice.ts:84-92`; commit `777ecc0`); `voice/chatterbox.ts` is dead code. Every narrated agent step in a voice task = one paid TTS call (`voice-realtime.ts:979-981` → `useRealtimeVoice.ts:331-360`).

### 1.5 Self-improvement pipeline

`reflect` = one `gpt-5.5` call at medium effort, system ≈ SELF.md (2,167 chars) + ~400 chars (`self/reflect.ts:9-22`, `self/identity.ts:8-17`). Implement runs on the Claude subscription (`index.ts:144-172`); verify is local. Only explicit triggers exist — no overnight scheduler is actually wired (trigger `"schedule"` appears only as a type, `self/intents.ts:4`). **OpenAI cost per improvement is small (~1-2k tokens); the pipeline is already aligned with the token-economics preference.**

## 2. Top cost reducers (impact × effort, no capability loss)

1. **Make auto-summary incremental** — summarize only messages after `summary_through_message_id` (fold into prior summary) and only every ~10 turns past threshold (`auto-summary.ts:24-35`). Est. **20-40% of total daily tokens** on long/resumed sessions; ~20-line change.
2. **Return reasoning items (or `previous_response_id`) in the agent loop** (`openai-provider.ts:23-54, 117-126`). Cuts per-step re-reasoning on every multi-tool run. Est. **10-25% on action runs**; medium effort (store reasoning items per turn).
3. **Skip/clamp `matchPlaybook`**: hash-cache prompt→slug, skip for messages <4 words with no imperative (reuse `classifyIntent`), and cap the index sent (top-K by keyword overlap instead of all 51 triggers) (`chat.ts:258-286`, `match.ts:12-13`). Saves ~2k side tokens on *every* typed turn; small effort.
3. **Re-wire local TTS for step narration** (Chatterbox code exists: `voice/chatterbox.ts:26-47`) or narrate only milestones instead of every tool step (`voice-realtime.ts:979-981`). Eliminates ~100% of narration TTS spend; small effort (it was working before `777ecc0`).
5. **Cache restructure**: move observations (the only intra-day-volatile layer) after the rubric/fsRoots (`system-prompt.ts:79-87`) so a `memory_remember` no longer invalidates the static suffix; optionally add `prompt_cache_key` per lane. Est. 5-10% input savings; trivial effort — but verify with usage logging first (Section 4).

(Bigger lever if desired: a transcribe-only voice toggle to avoid realtime audio-output rates for chitchat — but always-hybrid is a deliberate UX choice, so it's a knob, not a defect.)

## 3. Reliability issues by blast radius

1. **No process-level `unhandledRejection`/`uncaughtException` handlers** (grep: only a test references them) **and the chat run IIFE has try/finally with no catch** (`chat.ts:293-450`). `emit()` performs SQLite writes (`chat.ts:331-347`); a throw there or anywhere in `runAgent` outside its stream try/catch rejects a void-ed promise → Node default = **whole-server crash mid-task**. Blast radius: everything.
2. **No `listen` error handler → EADDRINUSE crash-loops** (`index.ts:372-374`). Matches the documented self-dev-swap downtime; `shutdown()` also never closes the HTTP server or flushes pino (`index.ts:355-368`; `logger.flush` exists at `logs/logger.ts:80-95` but is never called).
3. **No task resume after restart.** ActiveRuns/SSE buffers are in-memory (`orchestrator/active-runs.ts:12-13`, `sse/buffer.ts:15-22`); tsx-watch reload (`server/package.json` dev script; self-swap relies on it, `index.ts:209-211`) kills in-flight runs. Boot recovery is decent — orphan PID kill + "interrupted" system message (`state/recovery.ts:12-33`), stale intents/discussions failed (`index.ts:65-83`), worktree prune (`index.ts:72-77`), stale voice tokens revoked (`index.ts:391-394`) — but nothing resumes; the user re-asks.
4. **Self-dev `git reset --hard` still clobbers uncommitted work.** Guards present: fast-forward-only swap (`self/swap.ts:15-30`), watchdog revert skips if HEAD moved (`swap.ts:39-53`), safety-critical-path block (`self/safety-guard.ts` via `index.ts:201-207`), worktree isolation. Missing: a dirty-working-tree check before reset — the exact collision hazard on record remains for uncommitted edits.
5. **Voice 1006 path — largely addressed**: server aborts the in-flight do_on_computer run on client close (`voice-realtime.ts:794-797, 1088-1096`; kill-on-abort in `index.ts:432-434`); client auto-reconnects ≤2 attempts on 1006/1011 (`useRealtimeVoice.ts:793-802`). Remaining gap: no upstream-side reconnect; a dropped *upstream* socket ends the session to the client. (The exact scope of the previously "deferred guard" I could not verify from code.)
6. **Data safety**: SQLite WAL (`state/schema.sql:2`) but **no backup mechanism anywhere** (grep); memory `.md` writes are non-atomic `writeFileSync` (`memory/store.ts:9-11`) — a crash mid-write can truncate observations/preferences; `messages` grows unbounded (currently 836KB — fine, but no pruning); `tool_calls` table is dead — defined (`schema.sql:23-33`) and never inserted.
7. Tool errors are well surfaced: per-tool timeout budgets (`orchestrator/timeout.ts:1-9`), error results fed back to the model + a no-false-success reminder (`agent.ts:284-301`), stream errors persisted into the transcript (`chat.ts:338-346`), stuck-loop halt (`agent.ts:91-103`). Solid.

## 4. Observability gaps + 3 cheapest additions

Gaps: **zero token/cost accounting** (usage events ignored, `openai-provider.ts:206-214`); no per-stage latency anywhere (`tool_calls.duration_ms` column exists, never written); health endpoint is uptime-only (`routes/health.ts:5-11`; `/_status` is sessions count, `routes/status.ts:11-22`) — the post-swap watchdog polls a health check that can't see a broken provider; pino logs record lifecycle but not timings (`read_logs` tool reads them back, `tools/activity-log.ts:90-102`).

Cheapest high-value additions:
1. **Log usage from `response.completed`** (input/cached/output tokens + model + runId) in `openai-provider.ts` — ~15 lines. Answers both "what does a day cost" and "is prompt caching actually hitting" (currently unverifiable).
2. **Per-turn timing line in `runAgent`**: ms-to-first-delta, per-tool dispatch duration (timer around `registry.dispatch`, `agent.ts:283`), turn count — ~10 lines; makes "why was that reply slow" answerable from `read_logs`.
3. **Expand `/api/health`**: provider+model, active runs, improvement queue state, DB size, last error timestamp — ~20 lines; also makes the self-dev watchdog meaningfully stricter.

## 5. Feature ideas

1. **Cost dashboard on the Self screen** — daily token/cost split by lane (agent, side calls, realtime voice, TTS/STT) from the new usage log, with a "today vs 7-day" sparkline.
2. **Latency-breakdown chip per reply** — queue / playbook-match / TTFT / tools / total, riding the existing SSE event stream (events already carry `ts`, `sse/buffer.ts:31`).
3. **Auto model-routing with an escalation hatch** — typed non-imperative turns go to the side model with one `escalate_to_agent` stub tool; the moment it's called, re-run on the full action stack (fixes the over-conservative-classifier regression without paying gpt-5.5 for "thanks").
4. **Task resume after restart** — persist the run's `messages` array per runId in SQLite; on boot, recovery offers "continue interrupted task" instead of only apologizing (`recovery.ts:23-32`).
5. **One-click data safety** — nightly `db.backup()` + tmp-rename atomic memory writes + dirty-tree guard before self-dev `reset --hard` — three small changes that close items 4 and 6 above.

## Not verified (explicit)

- Live `.env` (REALTIME_*, FORCE_INTENT, LLM_PROVIDER, Hume keys) — intentionally not read; defaults assumed.
- OpenAI billing behavior for idle realtime sessions / uncommitted audio buffers, and gpt-5.5 pricing — code-only review; savings percentages are directional estimates.
- Actual prompt-cache hit rates (no instrumentation exists to confirm).
- Whether production runs `tsx watch` vs `node dist` (dev script + no-op swap restart strongly imply tsx watch).
- The intended scope of the previously deferred "voice-1006 guard" beyond what's now in code.
