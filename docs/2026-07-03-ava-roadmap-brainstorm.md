# Ava — Architecture Review & Roadmap Brainstorm

**Date:** 2026-07-03 (overnight, autonomous)
**Basis:** full-codebase survey, 10+ live end-to-end capability tests, and a night of
hands-on work inside every major subsystem (playbooks, self/*, tools, chat pipeline,
watches). This is not speculation — every claim below was verified against running code.

---

## Part 1 — The architecture as it stands

### What Ava fundamentally is
A **single-user, single-machine agent loop** with five load-bearing pillars:

1. **The orchestrator** (`orchestrator/agent.ts` + `routes/chat.ts`) — one model-driven
   tool loop per turn, mode-split (action vs conversation), streaming everything it does
   over resumable SSE. This is the spine, and it is *good*: clean event grammar
   (`tool_call/tool_result/thought/delta/final/approval_*`), per-tool timeout budgets,
   stuck-loop detection, graceful degradation at every seam.
2. **The tool belt** (24 tools) — browser (persistent logged-in profile), filesystem
   (allowlisted), shell, app control, screen vision (`look_at_screen`, new tonight),
   memory, watches (new tonight), self-improvement, Claude consultation. Between them
   there is almost always a path to what Sir wants; live tests confirmed the model
   *finds* those paths, including recovering from walls (Google bot-block → wttr.in).
3. **The learning layer** — playbooks (capture → distill → recall), as of tonight with
   real optimization mechanics: win/loss records, rolling durations, lessons from
   failures, merge-on-recapture, demotion of losers. This is the "gets faster with use"
   organ, and its metrics now actually accumulate instead of resetting.
4. **The safety spine** — risk classifier → approval cards (with push + auto-approve
   countdown), path allowlist, secret scrubbing, and the self-improvement pipeline's
   worktree isolation + verify gate + hard safety-diff guard + watchdog rollback.
   This is genuinely well-engineered — better than most production agent products.
5. **The self-model** — SELF.md identity, persona file, self-changelog (wired tonight),
   friction ledger (wired tonight), self-improvement intents with full UI lifecycle.
   Ava can now know what she is, what she's changed, and what keeps going wrong.

### Honest weak points (observed, not theorized)
- **Reachability**: Tailscale isn't installed on this machine yet — Ava currently only
  exists at `localhost`. A phone-first assistant that's unreachable from the phone is
  a demo, not an assistant. This is the single highest-leverage hour of work remaining.
- **Typed = always action mode**: every typed message spins the full agent (orchestrator
  model + tool wiring + Chromium wait). "thanks" costs the same pipeline as "reorganize
  my disk". The intent classifier exists and is trusted for voice — text bypasses it.
- **`computer_use` is dark** on this account (OpenAI's `computer-use-preview` is gated).
  `look_at_screen` (tonight) covers *seeing*; full visual *control* needs either an
  Anthropic key (the tool already prefers Anthropic when configured!) or OpenAI tier access.
- **No native calendar/email** — the two most-requested assistant surfaces run only
  through browser automation after a manual login. Workable, but brittle vs APIs.
- **Prod-mode self-swap is incomplete**: a hot-swap updates source, but `node dist`
  keeps serving old code until rebuild+restart (fine under `tsx watch`, a real gap
  under pm2). Documented in code, still true.
- **Recall is lexical**: paraphrases with zero token overlap silently skip playbook
  recall. Tonight's shorter triggers + keyword corroboration shrank the miss rate,
  but the ceiling is embeddings.

---

## Part 2 — Vision-vs-reality map (Sir's spec)

| Spec pillar | Status tonight |
|---|---|
| Web automation & research | **Working** (tested: search, compare, summarize, adaptive fallbacks) |
| File management | **Working** (tested: organize-by-type in 9s via one shell script) |
| Computer control | **Working** for apps/shell/screenshots; full vision-control gated (see above) |
| Productivity (docs/notes/summaries) | **Working** (fs + browser + memory) |
| Multi-step workflows | **Working** (tested end-to-end, visible step-by-step) |
| Personal memory & personalization | **Working** (persona + preferences + observations + session summaries) |
| Workflow optimization system | **Built tonight** (playbooks v2: metrics, lessons, versions, demotion) |
| Long-term monitoring | **Built tonight** (watches: scheduler + push + audit sessions) |
| Self-development | **Wired tonight** (UI initiator, real pause, changelog, friction-first loop) |
| Messaging (WhatsApp) | **One QR scan away** (flow verified to the login screen; guide written) |
| Calendar & scheduling | Browser path ready after Google login; API integration proposed below |
| Decision making / smart workflows | Emergent from the above — improves as playbooks accumulate |

---

## Part 3 — Proposals

### Tier 1 — days of work, outsized payoff

**1. Make Ava reachable (Tailscale + autostart)** — *ops, ~1 hour*
Install Tailscale, set `TAILSCALE_IP`, run `scripts/install-autostart.ps1` (pm2 + boot).
Until this lands, everything else is furniture in a locked room. Do this first.

**2. Morning briefing routine** — *~0 new architecture*
A recurring watch (`once:false`, interval 24h, or a `run_at` field for exact-time) whose
prompt is "assemble Sir's morning: weather, top 3 relevant news, today's calendar (once
logged in), any triggered watches, any pending approvals" → push notification + a
session he opens with coffee. The watches engine built tonight already carries 90% of this.

**3. One-shot reminders ("remind me at 18:00")** — *small schema addition*
Add `run_at INTEGER NULL` to watches: scheduler fires it once at/after that time.
"Remind me to call Mom at 6" becomes `watch_create` with a fixed time. Trivial, huge
daily-life value, and the rubric teaches Ava to self-register them.

**4. Typed-message intent classification** — *flip one condition, measure*
Trust `classifyIntent` for text like voice already does (keep `FORCE_INTENT` escape
hatch). Cuts latency and cost for every conversational turn. The risk (misrouting a
real task to chat-mode) is bounded: conversation mode keeps memory tools, and the fix
is one retry with an explicit verb.

**5. Google Calendar + Gmail APIs (OAuth)** — *the biggest capability unlock*
Proper `calendar_list/create/move` and `gmail_search/draft/send` tools over OAuth
(one-time device-flow consent; tokens in DATA_DIR). Browser automation stays as
fallback. This converts the two most-used assistant categories from "possible" to
"reliable in 2 seconds" — exactly the workflow-evolution story (v1 browser → v2 API)
the optimization spec describes.

**6. Playbooks & watches panels in the Mind screen** — *read-only UI, APIs exist*
`GET /api/playbooks` and `GET /api/watches` (both new tonight) have no UI yet. A
"Learned workflows" card (trigger, uses, win rate, avg seconds, version) and a
"Standing watches" card make Ava's learning *visible*, which Sir explicitly asked for.

**7. Actionable approval pushes** — *close the loop from the lock screen*
Approval pushes exist for self-improvement plans; generalize: any `approval_required`
sends a push naming the tool + summary, deep-linking to the session. Combined with #1,
Sir can unblock Ava from anywhere.

### Tier 2 — a week or two each, strategic

**8. Routine detection (the "Morning Startup" spec item)**
Nightly job mines session history for repeated task shapes (same playbook recalled at
similar times / same first-message patterns) → Ava *proposes*: "You ask for X most
mornings — want it automated?" Acceptance creates a watch/routine. All ingredients
(playbook uses, session timestamps, chips UI for suggestions) already exist.

**9. Skills: from playbooks-as-text to playbooks-as-code**
The real workflow-evolution endgame: when a playbook's `uses` crosses a threshold with
a clean record, Ava (via `claude_code` + the existing worktree/verify pipeline) writes
a parameterized *script* implementing it, registered as a first-class tool. Text steps
are advice; scripts are guarantees (deterministic, testable, 100× faster, near-zero
tokens). The self-improvement safety machinery — worktree, tests, safety-diff, rollback
— is *exactly* the right factory for these.

**10. Cost & usage ledger**
Providers already return token usage per stream; persist per-run cost to a table,
roll up into `avg_cost` per playbook (the spec explicitly lists cost as a workflow
metric) and a simple usage view. Also powers a "budget guard" watch ("warn me at $X/day").

**11. Semantic recall (embeddings) for memory + playbooks**
Local embedding index (sqlite-vec or a tiny ONNX model — no cloud dependency) over
memory observations + playbook triggers. Kills the lexical-recall ceiling and makes
"that PDF thing from last month" findable. Contained: one indexer, one query path,
fallback to today's token matching.

**12. Telegram as a second notification/command channel**
Web-push on iOS PWAs is fragile. A Telegram bot gives reliable pushes with action
buttons (approve/deny inline!) and a remote command channel when the PWA isn't open.
Small surface: one poller, reuse the existing auth/approvals plumbing.

### Tier 3 — fundamental, sequence after the above proves out

**13. Autonomy ladder for self-improvement**
Graduated trust using data that now exists (intents outcomes + friction ledger):
categories of change earn auto-approval after N consecutive clean ships, regress to
gated on any rollback. Turns the overnight loop from "supervised experiment" into
"trusted background gardener" at a pace the evidence justifies.

**14. Nightly memory consolidation**
A reflection job that compresses observations → durable structured memory with
decay/promotion (promote.ts exists, underused), keeping the prompt lean while
personalization compounds. This is what makes month-6 Ava feel qualitatively
different from week-1 Ava.

**15. Parallel sub-runs for compound tasks**
"Compare these 5 laptops" currently serializes. `ActiveRuns` already manages
concurrent sessions; add a `spawn_subtask` tool + a join step. Wall-clock for research
tasks drops ~Nx. Needs care with the single browser profile (tab-per-subtask or
context pool).

**16. Full desktop control, deterministically**
Two tracks: (a) add an Anthropic API key — `buildComputerUseTool` already prefers it,
zero code; (b) for known apps, UI-Automation-tree control via PowerShell (inspect
element tree → click by accessibility ID) — deterministic, fast, no vision tokens.
Vision (`look_at_screen`) then serves verification rather than navigation.

### What I would deliberately NOT do
- **No purchase/send autonomy** — approvals stay on money-moving and outward-facing
  actions regardless of trust level. The cost of one bad send exceeds a year of clicks.
- **No sub-5-minute watch intervals** (each check is a real agent run; the rubric now
  teaches frugality) and no unbounded watch counts without the cost ledger (#10) first.
- **No plugin/marketplace architecture** — single-user product; the self-improvement
  pipeline IS the extension mechanism.
- **No LangChain-style framework rewrite** — the hand-rolled loop is a feature: it's
  auditable, testable, and exactly as complex as it needs to be.

---

## Part 4 — Suggested sequence

```
Week 1  (daily-life value):   #1 Tailscale+autostart → #3 reminders → #2 briefing → #4 intent split → #6 panels
Week 2  (capability):         #5 Calendar/Gmail APIs → #7 approval pushes → WhatsApp login + first real sends
Week 3+ (compounding):        #10 cost ledger → #8 routine detection → #9 skills factory → #11 embeddings
Then:                         #12 Telegram → #13 autonomy ladder → #14 consolidation → #15 parallelism → #16 desktop
```

The thread through all of it: **capture → measure → propose → automate → trust** —
each stage feeding the next with evidence rather than hope. Ava's architecture already
has the right bones for this; tonight the measurement organs (playbook metrics, friction
ledger, changelog, watch records) came online, which is what makes every later stage
possible without guesswork.
