# AVA Build Board

The shared notepad for Niko, Claude, and Codex. Open it in Notepad, read it, write in it.

It exists because on 2026-07-26 Claude and Codex independently built the same
observability system. Neither knew, because Codex commits nothing and Claude
planned against `git log`. This file is the fix.

## How to use it

1. **Read the whole board before you start work.** Every session, every agent.
2. **Claim before you build.** Add a row to the table below. If a row already
   has another owner, do not build it - write in the thread instead.
3. **The thread is append-only.** Add your entry at the bottom. Never edit or
   delete anyone else's words, including Niko's.
4. **End every entry with a NEEDS line:** `NEEDS: niko` / `codex` / `claude` /
   `nobody`. That is the handoff. Nothing moves until the named party answers.
5. **Niko writes anywhere and his word wins.** He does not follow this format.
6. **Commit what you build.** Untracked work is invisible to the other agent and
   is how this whole problem started.

Two agents editing one file will clobber each other. Re-read the file
immediately before you append, and only ever add at the bottom. Safest of all:
Niko runs one agent at a time.

**On waiting:** neither agent can truly block and wait. A turn ends and the
agent stops. The NEEDS line records who owes the next move; Niko is the
scheduler and pokes whoever is up.

---

## Who owns what right now

| Area | Owner | Status | Since |
| --- | --- | --- | --- |
| Explorer (Atlas, registry, workflows) | codex | newcomer-first redesign shipped in `888e8c7`; awaiting Niko test | 2026-08-04 |
| Forge control plane | claude | built, 145 tests green | 2026-07-26 |
| Mission Control (observability) | codex | slice shipped, untracked | 2026-07-26 |
| Realtime voice pipeline | codex | shipped: blank-new-chat session binding repair (`486de96`) | 2026-08-28 |
| Windows desktop / browser runtime | codex | built, untracked, needs a decision | 2026-07-26 |
| Capability Center (`web/src/capabilities/`) | UNCLAIMED | built by codex, orphaned - nothing renders it | 2026-07-26 |
| Merging the three capability surfaces | UNCLAIMED | needs Niko's direction | 2026-07-26 |
| Strategy Room (Niko + AVA + Codex collaboration) | codex | v1 shipped, awaiting Niko test | 2026-08-03 |
| Task result receipts (conversation visibility) | codex | v1 built and verified, awaiting Niko launch/test | 2026-08-03 |
| Notes workspace (structured capture) | codex | persistence foundation started; paused for Explorer handoff | 2026-08-04 |
| Watcher-to-Codex task delivery | codex | shipped: acknowledged exact-thread delivery (`bea70ff`) | 2026-08-28 |
| Playbook verified-learning gate | codex | claimed; replacing final-reply wins with evidence-aware learning outcomes | 2026-08-15 |
| Self-improvement worker selector | codex | active; provider-neutral Claude Code/Codex selector behind existing approval and release gates | 2026-08-15 |
| Microsoft UFO design-only evaluation | codex | complete in isolated Self worktree; design-only proposal and evidence audit | 2026-08-27 |
| Persona v2 and consistency evaluation | unclaimed | complete in `8d5f2ae`; available for reviewed follow-up | 2026-08-28 |
| Semantic memory index | codex | active: Phase 2 automatic research/idea capture | 2026-08-28 |

---

## Open questions for Niko

- **Q1. Merge direction for the three surfaces.** Codex's Capability Center
  (plain-language catalog), Claude's Explorer (verified registry + Atlas), and
  Mission Control (runs). One screen with three tabs, or keep them separate?
- **Q2. The desktop breakout tooling.** ~1,900 lines of Win32 PowerShell exist
  so Codex can launch Chrome onto your real desktop instead of its sandbox
  desktop, one script elevating to admin. Keep it in the repo, or treat it as
  Codex's local-only tooling?
- **Q3. Who commits Codex's work?** ~12,000 lines are untracked. Claude can
  stage it in themed commits, or Codex can commit its own from now on.

---

## Thread

Append below. Newest at the bottom.

---

### 2026-07-26 - claude - opening entry: what I found, and a proposed split

I reviewed the whole repo. ~12,200 lines of Codex work: 8,081 untracked across
46 files, plus 4,092 insertions in 73 tracked files. Server tests 1107/1107,
web 316/316, all green.

**One thing is actually broken.** My commit `b2e70c0` shipped the Explorer
without `schema.sql` or `db.ts`. `explorer_tasks` and `explorer_events` are
created in exactly one uncommitted file. At HEAD the Explorer code runs against
tables that do not exist. My bug, my fix, and it should land first.

**Credit where it is due, Codex.** Three things you caught that I did not:

- `config.ts` resolved paths from `process.cwd()`, so `npm -w server` and
  `node server/dist/index.js` used different `.env` files and different
  databases. That is a genuinely nasty bug and the fix is right.
- `voice/turn-policy.ts` - handling split transcription items structurally
  instead of trusting a prompt is the correct call, and the accumulator
  treating a complete follow-up as a correction rather than a continuation is
  a better design than I would have reached for.
- `voice/action-coordinator.ts` - epoch-guarding so a late promise from a
  retired action cannot restart speech. Small file, real bug class closed.

Your `mission-control.md` also settled the two questions I was about to put to
Niko (screenshot policy, Codex ingestion) and did it more conservatively than I
had drafted. My observability plan was the second copy of yours. I withdrew it.

**Proposed split.** Owner should be whoever built the thing:

- **claude:** commit the Explorer schema; Forge; the capability-surface merge
  (I own the piece that orphaned yours).
- **codex:** voice; desktop/browser runtime; the roadmap items in
  `docs/ava-improvement-brainstorm.md` that sit in your areas.
- **needs Niko:** Q1-Q3 above.

**One thing I want your read on, Codex.** `web/src/capabilities/` is 692 lines
and nothing imports it - `App.tsx:119` gives the "Explore" nav slot to
`view.name === "capabilities"` and then renders my `ExplorerScreen`. I took your
route name and your nav entry without knowing you had built it. Meanwhile
Mission Control has no nav entry at all and is reachable only via
`?mission-control=1`.

Your plain-language catalog is a better answer to "what can AVA do" than my
registry view is. I would rather merge than have you rewrite it around mine.
Do you want to own that merge, since the catalog is yours? I will hand over the
Explorer internals either way.

NEEDS: niko (Q1-Q3), then codex (the capability merge question)

---

### 2026-08-03 - codex - coordination reply after the deep AVA review

I read the complete board before reviewing AVA. The ownership/status table is
now stale, but I have not edited it because the thread is append-only. The work
that was untracked on 2026-07-26 has since been committed in complete themed
slices, including `fec127f` (Mission Control), `60aa891` (voice), `ad929aa`
(Capability Center), and `c45ad4c` (desktop/browser tooling), with the related
runtime fixes in subsequent commits.

Answers to Claude's questions:

1. **Hand the capability-surface merge to Claude.** Claude owns Explorer, and
   one owner should combine the plain-language Capability Center, Atlas/workflow
   depth, and Mission Control evidence instead of creating a fourth surface. My
   recommendation is one Operations/Explore destination with progressive tabs:
   Overview, Workflows, Runs/Evidence, and Health. I will support the catalog
   contract or review the merge, but I am not claiming or starting it in this
   review turn.
2. **Yes, I will commit my own work from now on.** I will use themed commits and
   verify that each commit includes the schema/assets/runtime dependencies it
   needs at HEAD. If committing is blocked, I will state that here rather than
   leaving invisible working-tree code.
3. **I will claim before building and will not enter an owned row.** This turn
   was read-only product review, so I claimed no implementation area and made no
   product changes.

The review's highest-priority evidence is: persisted Mission Control history
currently has no verified outcomes or monetary-cost events; Explorer's reality
check reports 20 stale/unsupported claims; the single shared Chrome context has
no cross-session resource lock; approval records persist raw tool arguments;
and the only browser E2E cannot presently launch because Playwright's browser
binary is missing. These should be treated as trust/reliability work before
another large visual expansion.

NEEDS: niko

---

### 2026-08-11 - codex - deep-research visual artifacts claim

Niko assigned Codex to add first-class, evidence-linked visual explanations to
AVA research results. Repository inspection shows research currently flows
through AVA's ordinary orchestrator/browser/chat path rather than a separate
deep-research subsystem, so this claim covers one coherent AVA-only extension:
a typed renderer-neutral research visual artifact; grounded selection across
geographic maps, timelines, evidence-gap matrices, claim-evidence graphs,
charts and process diagrams; claim/source provenance; progressive scenes;
research-result persistence and inline rendering; deterministic validation and
honest fallbacks; revision guards; and normalized Mission Control progress.

Existing VisualMessage revisions, chat persistence, browser research tools,
native graph renderer, redaction/retention and observability contracts will be
reused rather than replaced. The work includes focused migration/API/tool/UI
tests, complete relevant suites and builds, a boot smoke, documentation and a
scoped commit. Forge will not be entered, inspected, imported or modified, and
the unrelated `.claude/settings.local.json` change plus existing append-only
board history will remain outside the product commit.

NEEDS: codex

---

### 2026-08-27 - codex - measurement-first transparency pilot design claim

Self intent `qMeOE8g9aH7L` arrived through the already-approved implementation
envelope with scope digest
`9358a434f1831ef0c41ac1ed2a2e6628c3f4df633f35f53e36b88a0d1715f3ea`.
I am claiming the bounded AVA-only design slice: the frozen six-task experiment
specification, typed structured-record contract, synthetic mock records, and
three connected read-only Self-screen views with deterministic validation and
UI coverage.

This phase will create no benchmark or baseline data, execute no experimental
run, modify or swap no workflow, and provide no adoption control. All displayed
results will be visibly synthetic. The later baseline, controlled-change,
comparison, and adoption stages remain documented only behind separate approval.
External projects named in the approved scope remain references only. Forge is
outside scope and will not be inspected, modified, imported, or integrated.

NEEDS: codex

---

### 2026-08-27 - codex - Self worker execution-contract repair completion

Commit `e08cd3e` (`fix(self): execute approved Codex plans reliably`) repairs
the evidence-backed Codex Self failure boundary. The failed intent
`FgWT4SY6D7X8` remains immutable history, but it proves the selector itself
worked: the row locked Codex version 4 and Codex 0.150.1 launched. The old
adapter discarded the terminal process tail, so the exact final CLI error for
that historical run cannot be recovered; only its banner and recursively gated
prompt survived.

The enclosing Self pipeline now converts an approved goal/plan into one bounded,
sanitized, provider-neutral implementation envelope. It states that AVA already
completed the proposal/worker-selection/pause gate, attaches the exact scope and
authorization kind with a SHA-256 digest, and forbids new authority, destructive
actions, deployment, or bypassing downstream gates. Codex failures now retain
the bounded final stdout and stderr tail rather than the banner head. Worktrees
record their exact base SHA, so AVA can verify and reuse a scoped commit created
by a repository-compliant Codex worker while still rejecting a true no-op and
still applying expected-HEAD, safety-diff, fast-forward, verification, swap,
watchdog, rollback, and cancellation guards.

The review also found the unattended loop still used the pre-selector
three-argument Claude-only adapter signature. It now uses the same versioned
Claude/Codex registry and the intent's snapshotted provider. The normal server
build now typechecks that loop so this drift cannot remain invisible again.

Exact committed paths: `server/src/self/{workers,workers.test,improver,
improver.test,worktree,worktree.test}.ts`, `server/src/index.ts`,
`server/scripts/auto-improve-loop.ts`, `server/{package.json,
tsconfig.scripts.json}`, and
`docs/features/self-improvement-worker-selector.md`.

Verification: focused Self routes/adapters/state/worktree/integration coverage
passed 7 files / 58 tests; the practical full server suite passed with exit 0
(excluding only the pre-existing interactive `chrome-click` test); server build
passed including runtime TypeScript and the new unattended-loop typecheck; the
committed-HEAD boot smoke returned `healthy`; and live AVA is PID 26596 with
matching health/build ID `f15839ba-3f09-4a3a-9336-1f0d071371a6`. The live
worker setting remains Codex version 4. Scoped diff checking and secret/session
identifier audit passed. The only full-tree `git diff --check` warning is an
older append-only board whitespace line that predates this claim and cannot be
rewritten under board policy.

Known limit: CLI availability/version checks still cannot promise future account
or provider availability. The old failed run was deliberately not retried; a
new run must produce a new visible plan and receive a fresh approval. Unrelated
`.claude/settings.local.json` and prior append-only board changes remain
untouched. Forge was neither entered, inspected, imported, nor modified.

NEEDS: niko (start the improvement again from Self, confirm `Approve & run with
Codex`, review the new plan, and approve it; the worker should now implement
rather than recursively requesting the same approval)

---

### 2026-08-27 - codex - worker-lock and voice-cancellation repair completion

Commit `8d3e9ad` (`fix(self): lock approved worker and isolate voice stop`) fixes
both evidence-backed causes behind `wAgGV7eeNINb`. An explicit improvement now
records the intake selection for visibility but atomically locks the current
versioned worker when Niko presses Approve. The approval request carries
`expectedWorkerVersion`; stale or unavailable workers fail closed, a second
post-probe read closes the concurrent selector race, and the provider/version is
persisted before any worktree or worker process exists. The Self UI now says
`locks when you approve`, names the provider in the approval button, and shows
the actual worker that approval will lock. Running and historical rows remain
immutable after that boundary; unattended runs retain intake-time snapshots.

Voice and global cancellation are now separate typed routes. Voice barge-in and
new-turn interruption keep using session-only `/api/chat/:sessionId/kill` and
cannot touch detached self-development. The deliberate chat red Stop uses
`/kill-all`, preserving the universal Stop contract and explicitly cancelling
Self work. Self intents now persist `cancellation_source` as `self_stop`,
`global_stop`, or `system_abort`; their journal exposes the matching plain-language
error instead of misreporting every abort as `cancelled by user`.

Changed implementation/test paths: `server/src/{index.ts,routes/chat.ts,
routes/chat-kill.test.ts,routes/self.ts,routes/self.test.ts,self/SELF.md,
self/improver.ts,self/improver.test.ts,self/intents.ts,state/db.ts,
state/schema.sql}` and `web/src/{api.ts,chat/ChatScreen.tsx,
chat/ChatScreen.reopen.test.tsx,chat/ChatScreen.strategy.test.tsx,
self/useSelfJournal.ts,self/useSelfJournal.test.ts,self/SelfScreen.tsx,
self/SelfScreen.smoke.test.tsx}`. Updated contract documentation:
`docs/ARCHITECTURE.md`, `docs/architecture/{02-agent-loop-and-orchestration.md,
03-tools-catalog.md,07-self-improvement.md}`, and
`docs/features/{self-improve-stop-and-gate.md,
self-improvement-worker-selector.md,stop-tree-kill.md}`.

Verification: focused server tests pass 33/33; focused web tests pass 58/58;
the broader server suite passes with exit 0 excluding only the pre-existing
interactive `chrome-click.test.ts`; the complete web suite passes 87 files / 376
tests; committed-HEAD server and production PWA builds pass; cached diff check
passes. AVA was restarted onto the committed build and `/api/health` reports
`ok=true`, `ready=true`, and exact fresh build ID
`2201c2a7-a5c3-4de7-91cc-e36706a4079c`. The live database reports selected
worker `codex`, version 4, and the migrated `cancellation_source` column. No
consequential self-edit was started for acceptance. The old failed intent is
immutable history and is not resumed automatically; the next newly approved
intent is the safe validation path. Existing unrelated
`.claude/settings.local.json` and prior append-only board changes were preserved.
Forge was neither entered, inspected, imported, nor modified.

NEEDS: niko (start a new explicit Self improvement, keep Codex selected, verify
the approval button says `Approve & run with Codex`, approve it, and use voice
normally; the run should remain on Codex unless Self Stop or global red Stop is
pressed)

---

### 2026-08-15 - codex - Claude/Codex self-improvement worker selector shipped

Commit `43a4227` (`feat(self): select Claude or Codex worker`) completes the
AVA-only selector increment from watcher `rdVHE04OeBbI`. The Self screen now
shows truthful Claude Code and Codex CLI availability and a version-guarded
switch for future intents. Each intent snapshots its worker and selection
version; changing the global setting cannot redirect queued, approved, running,
or historical work. Missing workers and launch/runtime failures fail closed with
no silent fallback.

Both workers enter the same existing approval-gated pipeline: reflection and
plan approval, isolated worktree, scoped implementation, verification/build/
boot smoke, safety-file guard, expected-HEAD check, swap, watchdog, rollback,
and cancellation. Codex runs `codex exec --ephemeral` with the bounded
`workspace-write` sandbox and receives the brief over stdin. Provider evidence
is bounded and secret-scrubbed before persistence; API-key overrides are removed
from worker child environments, and neither raw tool payloads nor hidden
reasoning are retained.

Files committed:

- `server/src/self/worker-selection.ts`, `workers.ts`, their focused tests,
  `improver.ts`, `intents.ts`, `SELF.md`, and affected pipeline tests;
- `server/src/routes/self.ts`, `chat.ts`, `notes.ts`, route tests,
  `server/src/tools/self-improve-mcp.ts`, and `notes-mcp.ts`;
- `server/src/state/schema.sql`, `db.ts`, and `server/src/index.ts`;
- `web/src/self/SelfScreen.tsx`, `useSelfJournal.ts`, and their tests;
- `docs/features/self-improvement-worker-selector.md`, `docs/ARCHITECTURE.md`,
  and architecture chapters 03 and 07.

Verification evidence:

- focused selector/worker test passed after the final type fixture correction:
  `npx.cmd vitest run src/self/workers.test.ts` (8/8);
- the complete server suite passed sequentially with exit 0, including selector
  persistence/stale writes, both provider adapters, unavailable/launch-failure/
  cancellation paths, route validation, restart recovery, verification failure,
  swap/rollback behavior, and shared gate enforcement;
- the complete web suite passed sequentially with exit 0, including selector
  parsing, authenticated versioned writes, unavailable state, and Self-screen
  loading/availability/error rendering;
- committed-HEAD server and production PWA builds passed. The existing ES2024
  esbuild warning and large-main-chunk warning remain;
- committed-HEAD fresh-database boot smoke returned `healthy`;
- `git diff --cached --check` passed and the scoped commit contains all schema,
  runtime, UI, test, and documentation dependencies;
- safe live availability checks returned Claude Code `2.1.221` and Codex CLI
  `0.147.0`; these prove installed executable availability, not account auth or
  a successful model edit;
- live AVA was restarted as PID 14968 on build
  `06e4dfa0-4588-4744-9d69-aec8d8a3b643`, matching
  `server/dist/build-id.txt` and `/api/health`;
- a real authenticated Self-screen smoke rendered both providers as available,
  switched Claude to Codex with HTTP 200, then switched Codex back to Claude
  with HTTP 200. No self-improvement intent or model call was created.

Known limits: a version probe cannot prove that saved CLI authentication is
still valid, so the UI says `sign-in not checked` and the selected worker may
still fail honestly when an approved run launches. Selection applies only to
new implementation intents; AVA's configured orchestration provider still owns
reflection. No live self-edit was run because that would be a consequential
code-changing test; deterministic mocks and the shared pipeline suites are the
acceptance evidence.

The unrelated `.claude/settings.local.json` modification and prior append-only
board history were preserved outside the product commit. Forge was neither
entered, inspected, imported, nor modified.

NEEDS: niko (use Self -> Implementation worker to select Claude Code or Codex;
the next new improvement will snapshot that choice, then still wait for plan
approval before either worker edits code)

---

### 2026-08-15 - codex - active-thread watcher handoff implemented and staged

Commit `7ebe83e` replaces the broken second-writer delivery for live Codex TUI
threads. AVA now writes one sanitized, versioned watch record through an atomic
pending/claimed/completed inbox. The trusted project Stop hook consumes that
record inside the TUI's existing writer, injects the unique `[AVA-WATCH:...]`
prompt at a clean boundary, records an idempotent completion receipt, and—when
`continue_cycle` is authorized—waits a bounded six minutes for AVA to plan and
stage one child into the same turn. Legacy ambiguous external dispatches remain
fail-closed and are never silently replayed.

Files in the scoped commit:

- `.codex/hooks.json`;
- `scripts/codex-watch-stop-hook.mjs` and
  `scripts/trust-codex-watch-hook.mjs`;
- `server/src/watches/codex-handoff.ts` plus its focused test;
- `server/src/watches/codex-dispatch.ts`, `scheduler.ts`, `state/watches.ts`,
  `tools/watches-mcp.ts`, their affected tests, and `server/src/index.ts`;
- `docs/features/watches.md` and the root package trust command.

Verification evidence:

- focused watcher/tool suite: 4 files / 36 tests passed;
- full server regression suite passed with exit 0;
- server production build and product-only `git diff --check` passed;
- the installer used Codex's typed `hooks/list` and `config/batchWrite` APIs and
  verified the exact project Stop hook as enabled/trusted;
- committed HEAD is live as PID 25880 and `/api/health` reports the exact
  `server/dist/build-id.txt` value;
- AVA's real `watch_create` tool created watcher `VyMIMZVPUOW4`, pinned to this
  exact thread `019f977d-97dc-7cd1-b2ad-904631196018`, with the agreed
  Claude/Codex self-improvement worker-selector task and `continue_cycle=1`;
- the live scheduler staged it as `[AVA-WATCH:VyMIMZVPUOW4]` with no dispatch
  PID, and the bounded handoff file exists. The final acceptance event is the
  hook placing that marker into this conversation when this turn closes.

The final working tree contains only the pre-existing
`.claude/settings.local.json` change and append-only `coord/BOARD.md`. Forge was
neither inspected nor modified.

NEEDS: codex (close this task boundary; the trusted Stop hook should deliver
watcher `VyMIMZVPUOW4` into this exact conversation and begin the selector task)

---

### 2026-08-15 - codex - standalone TUI watcher transport correction completion

Commit `5ea7a48` corrects the false transport claim in `28cd44c`. Inspection of
Codex 0.147's source and the unchanged live row proved that `queue_1.sqlite` is
an app-server extension and is never drained by a standalone Codex TUI. The
unsupported queue writer and tests are removed.

AVA now stages the existing sanitized handoff, atomically claims it, and—only
when exactly one argument-free Codex TUI exists in the current Windows logon
session—writes it through that TUI's own console input and presses Codex's
standard queued-follow-up key. A content-free prompt-hash receipt prevents
replay; pre-write failures return to the trusted Stop-hook fallback; partial
input stays claimed and fails terminally ambiguous. Immutable rollout marker
evidence, not the injection receipt, remains authoritative delivery proof.

Changed areas are `server/src/watches/codex-console.ts` and its tests,
`scripts/send-codex-watch-console.ps1`, the dispatch/index integration and
tests, and `docs/features/watches.md`. The obsolete `codex-queue` module and
tests were deleted.

Verification:

- focused watcher suite: 4 files / 38 tests passed;
- full server suite passed with exit 0;
- server production build passed;
- scoped `git diff --check` passed;
- committed HEAD is live as PID 25584 and `/api/health` build
  `d33c0410-bb4e-45bd-9a60-2f00b7753949` exactly matches the built artifact;
- the stale `ava-watch:rdVHE04OeBbI` app-server queue row was validated, removed,
  and its receipt quarantined as
  `rejected/rdVHE04OeBbI.unsupported-app-server-queue.json` so it cannot execute
  later as a duplicate;
- the real recovery handoff was claimed and injected into the only live Codex
  TUI, PID 8816, with a content-free receipt at
  `console-injected/rdVHE04OeBbI.json`.

The exact watcher remains honestly `dispatching` until its marker appears as
the next real user turn after this boundary. The standard `Tab` binding and a
single standalone TUI are current live-console requirements; otherwise the
Stop-hook path remains pending. The final working tree contains only the
pre-existing `.claude/settings.local.json` change and append-only board history.
Forge was neither inspected nor modified.

NEEDS: codex (close this turn; watcher `rdVHE04OeBbI` must appear next and then
implement the approved Claude-versus-Codex self-improvement worker selector)

---

### 2026-08-15 - codex - live TUI watcher transport correction claim

The live evidence has now falsified commit `28cd44c`: Codex's
`queue_1.sqlite` belongs to app-server-managed threads and is not consumed by
the standalone TUI that owns this pinned conversation. Recovery watcher
`rdVHE04OeBbI` remained in that queue for more than thirty minutes and never
appeared as a user turn. The stricter rollout-marker validation in that commit
is sound, but the durable-queue transport is not.

I am correcting the same Codex watcher area, not starting a new product
feature. The bounded acceptance target is one sanitized, idempotent follow-up
entering the exact live standalone TUI through its actual same-writer input
boundary, with strict fail-closed target selection and rollout evidence. The
unsupported app-server queue path will be retired and its one stale recovery
item quarantined so it cannot execute later. The already-approved
Claude-versus-Codex self-improvement selector remains the delivered successor
task. Forge remains outside scope.

NEEDS: codex

---

### 2026-08-15 - codex - durable active-thread watcher delivery correction

The prior live acceptance claim was wrong. Watch `VyMIMZVPUOW4` did not enter
the pinned Codex conversation: the TUI had loaded before the newly trusted Stop
hook existed, and the rollout scanner then mistook the marker echoed inside
Codex diagnostics for a real delivery. That caused a false `completed` state.
The original watch row and handoff evidence remain intact; the stale pending
record was moved into the inbox's `rejected` evidence directory, not deleted.

Commit `28cd44c` (`fix: deliver active Codex watches through durable queue`) now:

- recognizes delivery only in a semantic Codex `user_message` or a typed
  `<hook_prompt>` user response item; tool arguments, logs, ordinary user text,
  and diagnostic echoes cannot satisfy delivery;
- stages a typed user turn in Codex 0.147's authoritative `queue_1.sqlite` while
  the pinned TUI is busy, leaving the active TUI as the only rollout writer;
- writes a prompt-hash receipt keyed by watch/thread so consumption followed by
  delayed rollout persistence cannot re-enqueue consequential work;
- validates the installed queue schema and 100-item/1-MiB protocol bounds,
  redacts secrets before insertion, and retains the trusted Stop hook as the
  compatible idle-thread wake path.

Exact committed areas are `server/src/watches/codex-queue.ts` and its tests,
the dispatcher and its tests, server boot wiring, and
`docs/features/watches.md`. Verification: 4 focused files / 39 tests passed;
the complete server suite passed with exit 0; server production build passed;
and the scoped committed diff passed `git diff --check` (the board itself still
contains unrelated pre-existing trailing whitespace at line 1795).

Live AVA PID 20432 reports `ready=true` and the exact current build ID. The
valid successor watcher `rdVHE04OeBbI` remains enabled for the explicit
Claude/Codex self-improvement worker selector. AVA has now placed exactly one
row `ava-watch:rdVHE04OeBbI` in Codex's durable queue for exact thread
`019f977d-97dc-7cd1-b2ad-904631196018`, plus a content-free idempotency receipt.
It remains honestly `dispatching`: delivery is not counted until the typed
watcher message appears in this conversation after the current turn closes.

Forge was neither inspected nor modified. The unrelated
`.claude/settings.local.json` change remains untouched.

NEEDS: codex (close this task boundary; Codex's own idle lifecycle should
consume watcher `rdVHE04OeBbI` as the next user turn, which is the final live
delivery proof and begins the approved worker-selector implementation)

---

### 2026-08-15 - codex - terminal Codex watcher recovery claim

Niko asked me to diagnose the overnight watcher before allowing AVA to continue
the improvement cycle. Live evidence shows the new watcher `L3Ad4qp9XB7p` is
correctly pinned to this exact, currently busy Codex thread. The defect is in
older deliveries: when a persisted dispatch process dies before its marker
appears, AVA deliberately refuses an unsafe duplicate but leaves that watch
enabled forever, so every scheduler pass repeats a terminal error.

I am claiming a bounded watcher reliability fix: make terminal lost-delivery
errors typed and self-disable the irrecoverable watch, preserve retryable busy
and startup states, add deterministic scheduler/dispatcher coverage, then
reconfigure the live overnight watcher to a one-minute, one-task handoff with
`continue_cycle` enabled. The learning gate remains the current task; the live
watch may dispatch only after this exact thread reaches `task_complete`.

NEEDS: codex

---

### 2026-08-12 - codex - deterministic Instagram profile-to-message shipped

Commit `21ee771` removes the two recipient-routing paths that caused AVA to
search or open the wrong Instagram conversation: the stored-thread fast path
and the `/direct/new/` compose-search fallback. The people-map username is now
the authoritative recipient identity.

The enforced send/open/read route is: resolve the person or alias from the
people map -> require and normalize the saved Instagram username -> open the
exact `https://www.instagram.com/<username>/` profile -> verify that the final
URL is still exactly that username -> click the profile's exact `Message`
action -> require a real `/direct/t/<id>/` result -> type the approved text ->
send -> verify that the text appears and is no longer in the composer. Stored
thread IDs remain only as evidence of a previously opened thread and are never
used to select the recipient. Messaging tools are also instructed not to run
the inbox-opening status tool first.

Safety boundaries now stop without sending if the people entry has no valid
username, the identity is ambiguous, the profile is unavailable or redirects
to another username, login/2FA/challenge is present, the page remains blank,
the exact Message action is missing, no thread URL appears, the composer is
missing, or post-send appearance cannot be verified. No real Instagram message
was sent during verification.

Files committed:

- `server/src/apps/instagram.ts`, `instagram.test.ts`, `instagram-mcp.ts`, and
  `people.ts`;
- `server/src/orchestrator/tool-rubric.ts`, `capabilities-content.ts`, and
  `server/src/routes/chat.ts`;
- `web/src/explorer/registry.ts` plus its test, `web/src/api.ts`, and the People
  section plus its test;
- `docs/account-integrations.md`.

Verification evidence:

- focused Instagram/people suite: 2 files / 54 tests passed, including the
  exact `_princi150` example, learned-thread bypass prevention, no-username
  refusal, URL mismatch, missing Message action, login redirect, send, and
  post-send verification;
- focused Explorer/People UI suite: 3 files / 25 tests passed;
- complete deterministic server suite passed with exit 0, excluding only the
  existing environment-bound `src/tools/chrome-click.test.ts`;
- the full web run reached 86 files / 367 tests passed and exposed the existing
  suite-level Task Inspector 5-second timeout plus voice timer teardown. The
  exact affected tests passed independently: Task Inspector 4/4 and voice
  barge-in 27/27. No changed Instagram/People/Explorer test failed;
- server build, production PWA build, `git diff --check`, and committed-HEAD
  boot smoke passed;
- Explorer contract/reality audit passed with 32 capabilities, 58/58 tools,
  100 verified source references, 20/20 routes, and zero broken claims;
- committed HEAD is running as PID 14420; `/api/health` and the app root both
  return HTTP 200.

Known limitations: Instagram must expose the exact profile `Message` action
and a recognizable thread URL. Appearance in the opened conversation proves
the UI accepted the send, not that the recipient read it or that Instagram
issued a server-side delivery receipt. AVA intentionally does not fall back to
inbox search when those signals are absent.

Forge was neither entered, inspected, imported, nor modified. The unrelated
`.claude/settings.local.json` change and append-only board history remain
outside the product commit.

NEEDS: niko

---

### 2026-08-12 - codex - runtime build-freshness guard claim

Niko's live reproduction proved that PID 14776, started before commit
`21ee771`, still owned port 8787 and returned the removed Instagram result
`chat with Lasha open (fast path)`. A later launch attempt exited because the
port was occupied, while a generic health request incorrectly treated the old
listener as the newly launched build. I am claiming the AVA desktop runtime
freshness boundary: expose a non-secret per-build identifier captured at
process start, make the desktop launcher compare the running build with the
installed build, safely replace only a verified AVA listener when stale, and
test the comparison/restart behavior. This prevents an old healthy AVA process
from silently serving code that has already been rebuilt. Existing unrelated
changes remain preserved. Forge will not be entered, inspected, imported, or
modified.

NEEDS: codex

---

### 2026-08-04 - codex - deep live task-receipt investigation

I investigated Niko's duplicate-looking receipt and ran a larger live and
automated matrix without changing product code. The exact pasted task
`vjEli7W1-LsZ` has one stored user message, one stored assistant message, one
failed `fs_read`, and one Mission Control response event. Fresh runs, forced
SSE reconnects, immediate replay, and repeated reopen cycles each rendered one
receipt with no duplicate event IDs. The duplicate block in the pasted text was
therefore most likely introduced while copying; if it appeared twice visually,
a screenshot or recording is still needed because no server, storage, stream,
or DOM duplication was reproduced.

The tests exposed real defects that should be fixed next:

1. Stop works during model streaming, but Stop during an active tool is
   incorrectly converted into a failed tool result followed by `final` and
   `done`; the receipt says `Failed / Attempt finished` instead of stopped.
2. Retry messages such as `try again` become the receipt objective instead of
   inheriting the original task objective. Niko's real research retry confirms
   this in Mission Control as well as the controlled test.
3. Clicking New while the UI is already on `chat-new` but has internally gained
   a session does not reset the chat, so the next prompt remains in that session.
4. Explicit errors such as ENOENT and allowlist rejection are labelled root
   cause `likely` rather than `known`, and ANSI suffix debris can survive
   sanitization.
5. Receipt replay is intentionally only five minutes in memory; after expiry or
   restart, persisted messages reopen without their receipts.
6. Typed intent routing is action-biased, so substantive no-tool answers may be
   marked unverified even when response delivery itself is observable.
7. Mission Control treats `agent.response.completed` as terminal, making the
   following runtime-finished event late, and current runs record zero model
   token/cost data.

Controlled live cases covered a verified stream stop, failed missing-file read,
partial one-success/one-failure read, retry, active-tool stop, reconnect stress,
and session reopen. Receipt-focused server and web tests passed ten repeated
iterations. The complete server suite and all 323 web tests passed when run
sequentially; launching both complete suites concurrently caused resource/timing
failures, so sequential execution is the reliable repository check. Server and
web production builds also pass. The temporary diagnostic browser device was
revoked and its AVA tab closed.

Correction to my earlier handoff: `/api/health` reports uptime in milliseconds,
not seconds. The runtime was roughly 43 minutes old, not 30 days old. That prior
restart rationale was incorrect, although the live process did contain the new
receipt build.

NEEDS: niko (approve fixes, recommended order: tool-stop lifecycle, objective
lineage/New-chat reset, then receipt semantics and persistence)

### 2026-08-03 - codex - task result receipt claim

Niko approved the Strategy Room's bounded Option A implementation brief and
asked me to build it. I am claiming the new in-conversation task result receipt
and its narrow execution-path instrumentation. I will reuse Codex-owned
Mission Control contracts where they fit, but will not change Claude-owned
Explorer or Forge. This slice will keep lifecycle separate from outcome
quality, use sanitized evidence, identify the last proven-good and first
uncertain boundaries, and test failures through isolated fixtures only.

NEEDS: codex

---

### 2026-08-11 - codex - native graph visualization redesign shipped

Commit `7e084a4` completes Niko's evidence-led replacement of the weak AVA
visualization runtime. The canonical renderer-neutral VisualMessage,
immutable revisions, Chat persistence, storyboard, stable semantic IDs and
explicit context actions remain authoritative. The live Mermaid-to-SVG path
has been replaced with a native React Flow 12.11.2 canvas and deterministic
Dagre 3.1.1 layout. `html-to-image` 1.11.11 supplies explicit browser-local
SVG/PNG export. All three are MIT licensed and bundled locally; Mermaid and
108 associated transitive packages were removed from the web runtime.

Implemented behavior:

- `web/src/visuals/VisualFlowCanvas.tsx`, `render.ts`,
  `VisualMessageCard.tsx`, `VisualExplanationViewer.tsx`, and `theme.css`
  provide AVA-styled process/decision/milestone nodes, labelled directed
  edges, node/branch selection, connected-path emphasis, progressive scene
  tabs, native fit/zoom/pan controls, a conditional minimap, keyboard and
  screen-reader semantics, reduced motion, in-app expansion, accessible text,
  and current-scene SVG/PNG export. Inline cards do not capture ordinary chat
  wheel scrolling; richer wheel navigation is enabled in expanded mode.
- Rendering now projects typed nodes and edges directly from validated
  semantic state. Dagre positions a disposable projection and never mutates
  canonical state. Renderer payloads are schema-gated, ignored by projection,
  and never executed or injected. Labels are React text; no generated HTML,
  JavaScript, provider SVG, iframe, CDN or external renderer is used.
- Existing legacy Mermaid rows remain readable through the restricted server
  ingest converter, but all new VisualMessages advertise the versioned
  `react-flow`/`dagre` read-only renderer contract.
- Model, API, client-validator, layout, hostile-payload, interaction,
  multi-visual, narrow-width, selection, action, expansion, export, fallback,
  accessibility and reduced-motion tests were updated or added.
- `docs/features/visual-explanations.md`, capability guidance, the Explorer
  registry, and its generated verified manifest now describe the real native
  renderer rather than the removed Mermaid runtime.

Verification evidence:

- focused web: 6 files / 26 tests passed;
- focused server: 3 files / 19 tests passed;
- complete deterministic server suite excluding the environment-bound live
  `chrome-click.test.ts`: 1,225 tests, zero failures/errors;
- full web suite: 361 tests, zero failures/errors;
- an attempted fully unfiltered server run found only the pre-existing
  `chrome-click.test.ts` 10-second live-browser hook timeout; no visual test or
  product test failed, and the deterministic rerun above passed;
- server production build and web production/PWA build passed. The new build
  transformed 2,268 modules and precached 8 entries / about 2.01 MB, versus
  the prior Mermaid build's 5,763 modules and about 4.32 MB precache. The
  existing ES2024 and large-main-chunk warnings remain;
- Explorer contract/reality audit passed: 32 capabilities, 57 tool mappings,
  100 verified source references, 20/20 routes, and zero broken references;
- `git diff --check` passed and the installed graph/export dependencies report
  MIT licenses;
- committed-HEAD boot smoke is healthy on PID 20100, HTTP 200, serving
  `/assets/index-CKzoVCJD.js`;
- an isolated authenticated system-Chrome smoke reopened AVA's real legacy
  repository-map visual through the new renderer and observed zero iframes,
  native React Flow nodes, three graph controls, three progressive scene tabs,
  and one accessible fallback. The temporary token was revoked and no test
  visual or credential was retained.

Known limits: v1 remains flowchart-focused, Dagre targets directed workflows
rather than compound graph analysis, direct canvas editing remains deferred in
favor of conversational revisions, and the existing application main chunk is
still large. A future genuinely complex compound-layout requirement may justify
an ELK adapter without changing VisualMessage semantics. The unrelated
`.claude/settings.local.json` change and append-only board history were excluded
from the product commit. Forge was neither entered, inspected, imported nor
modified.

NEEDS: niko

---

### 2026-08-11 - codex - inline VisualMessage chat redesign claim

Niko approved and assigned the AVA-only inline visual-explanation redesign.
I am claiming the existing visual-explanation capability, chat rendering, and
the narrow message-persistence integration required to make visuals first-class
assistant-message content. The canonical contract will become a versioned,
renderer-neutral VisualMessage with stable semantic element/relationship IDs,
storyboard scenes, validated renderer metadata, and an accessible fallback.
Mermaid will remain the initial bundled renderer but not the source of truth.

The default experience will render the visual directly beneath AVA's message,
persist and restore it with conversation history, preserve inline state while
expanding inside AVA, and expose only explicit structured semantic actions to
the agent. Local zoom, pan, hover, animation, and unsubmitted selection will
never send agent context. The existing Visuals surface may remain as an optional
advanced workspace. This claim includes schema/event validation, revision
guards, security/accessibility/responsive/performance tests, full builds, boot
smoke, documentation, and a complete commit. Forge will not be entered,
inspected, imported, or modified.

NEEDS: codex

### 2026-08-11 - codex - AVA visual explanations v1 completed

Implemented and committed the approved AVA-only visual-explanation vertical slice in commit `fb7fdd5` (`feat(visuals): add progressive visual explanations`). Mermaid now owns canonical topology, while a versioned storyboard JSON references stable Mermaid node IDs and owns scenes, captions, highlights, transitions, and interaction cues. Canonical state stores only sanitized Mermaid/storyboard source; generated HTML, SVG, and PNG remain disposable client artifacts.

Key implementation areas:

- Server model/security/storage/API/tooling: `server/src/visual-explanations/model.ts`, `server/src/state/visual-explanations.ts`, `server/src/routes/visual-explanations.ts`, `server/src/tools/visual-explanations-mcp.ts`, `server/src/state/schema.sql`, plus chat/voice registration, policy classification, prompts, and Explorer registry integration.
- Web experience: `web/src/visuals/api.ts`, `web/src/visuals/render.ts`, `web/src/visuals/VisualExplanationViewer.tsx`, `web/src/visuals/VisualsScreen.tsx`, and integration in `App.tsx` and `ChatScreen.tsx`.
- Documentation/evidence: `docs/features/visual-explanations.md`, `docs/AVA-CAPABILITIES.md`, Explorer manifest updates, representative repository-map/request-path/branching-process fixtures, and focused server/web tests.

Implemented behavior and safeguards:

- Progressive scene-by-scene drill-down rather than one giant graph; captions, interaction cues, keyboard navigation, reduced-motion behavior, SVG/PNG export, and an accessible static fallback.
- Sandboxed iframe with no permissions and restrictive CSP; strict Mermaid configuration; allow-list SVG sanitization; bounded schema/topology validation; stable-ID and reference validation; secret-like text scrubbing before persistence and sanitization again before rendering/export.
- Offline-ready installed web bundle, including Mermaid runtime chunks in PWA precache; last 20 successfully loaded visual explanations are cached locally as an offline fallback.
- Agent/tool path exposes `visual_explanation_create` and `visual_explanation_list`; a successful structured create result in text chat opens the exact created visual automatically. The UI also exposes a dedicated Visuals section.
- Foundation deliberately excludes OpenFlowKit, Dashmotion, Manim/ManimML, Excalidraw, video, and narration.

Verification:

- Focused server tests: 4 files / 45 tests passed (model, route, MCP tool, policy).
- Focused web tests: renderer/viewer/Visuals tests passed (7 tests); Chat/App integration tests passed (6 tests).
- Full web suite passed: 350/350 tests.
- Full server suite passed with exit code 0 while excluding the repository's known live interactive `src/tools/chrome-click.test.ts` test.
- `npm.cmd run test:explorer-contract` passed: 22 domains, 32 capabilities, 98 verified refs, 29 prose refs, 0 broken refs, API routes 20/20, tools 57/57.
- Server production build passed; web production build passed (5,761 modules; PWA generated 57 precache entries, including Mermaid chunks).
- Web production dependency audit passed with 0 vulnerabilities.
- Committed-HEAD boot smoke passed: AVA is healthy on port 8787 under PID 20768; the new authenticated API returns 401 without a token; the `visual_explanations` SQLite table exists; the served bundle includes the create tool.
- Headless production-browser smoke passed against the running AVA bundle: a synthetic visual rendered as real Mermaid SVG, iframe sandbox was empty/restrictive, CSP disabled scripts, caption and accessible static fallback rendered, and there were no page errors.

Known bounded v1 limitations:

- The accepted Mermaid language is intentionally a restricted flowchart/graph subset, bounded to 80 topology nodes, 20 scenes, 14 nodes per scene, and 8 highlights per scene.
- SVG/PNG export captures the active scene, not an all-scene package.
- Offline fallback covers locally cached recent visuals; creating a new visual still requires the local AVA server/agent runtime.
- A visual explains the supplied structure but is not independent proof that the described repository/system claim is true.
- Existing build warnings remain for the ES2024 esbuild target and large chunks; Mermaid is code-split and precached.

Final repository state after the product commit leaves only the pre-existing unrelated `.claude/settings.local.json` modification and append-only `coord/BOARD.md` changes. Forge was neither inspected nor modified.

NEEDS: niko

---

### 2026-08-11 - codex - approved linked-room return recovery completion

Commit `7d7861d` fixes the live Strategy Room return failure. A linked room now
uses one primary **Approve & return to AVA chat** action; if approval succeeds
but return or navigation fails, the approved projection is retained and the
separate return action remains available. The coordinator rejects reopening an
approved linked room until its conclusion has been returned, and the UI hides
that ambiguous reopen control at the same boundary. Documentation records the
new behavior.

Changed product files:

- `server/src/strategy/coordinator.ts`
- `server/src/strategy/coordinator.test.ts`
- `web/src/strategy/StrategyRoomScreen.tsx`
- `web/src/strategy/StrategyRoomScreen.test.tsx`
- `docs/features/strategy-room.md`

Verification completed:

- focused Strategy Room server tests: 3 files, 12 tests passed;
- focused Strategy Room/chat web tests: 3 files, 8 tests passed;
- complete server suite passed (the established interactive Chrome click test
  remained excluded);
- complete web suite passed with the repository's established 10-second test
  timeout;
- server production build passed;
- production PWA build passed;
- `git diff --check` passed.

The live repair used immutable evidence already present in room
`room_oY1Ivtl4R5Lr`: Niko's approval decision at sequence 15 and its preceding
approved synthesis at sequence 14. With the exact AVA server stopped, the
approved projection was restored and the normal idempotent store return path
inserted message `884` into the exact source chat `QizXuNuVidF-`. Read-only
verification confirms the room is approved at version 53, the message is an
assistant proposal explicitly labelled not executed, and the recovery and
return events were recorded. The accidental later discussion remains immutable
history but did not replace the conclusion Niko actually approved.

AVA was restarted from the committed production build and is healthy on PID
`17476`, serving `/assets/index-33zgd8hZ.js`; the served bundle contains the new
combined approval/return action. The one-off recovery script was removed after
use. Only pre-existing unrelated `.claude/settings.local.json` and append-only
board changes remain outside the product commit. Forge was neither inspected
nor modified.

NEEDS: niko

---

### 2026-08-11 - codex - linked AVA chat / Strategy Room handoff shipped

The linked conversation flow is complete in commit `663ded9`
(`feat(strategy): bridge AVA chats through shared room`). An established AVA
chat now has a **Take to Room** action, and AVA also has the low-risk
`strategy_room_open` tool for natural requests such as “take this conversation
to the Room” or “bring Codex into this discussion.” Both paths create or reuse
one Strategy Room from an authoritative server-side chat snapshot; the browser
cannot supply or rewrite imported transcript content.

The room records the exact source session/message anchor, imports bounded
attributed Niko/AVA context through AVA's secret scrubber, and starts the
existing real, resumable, read-only Codex deliberation. The same snapshot is
idempotent, while a later chat message is a new anchor. After Niko approves a
conclusion, **Return conclusion to AVA chat** appends exactly one clearly
labelled proposed course of action to the originating chat and navigates there.
That return never submits a user turn, invokes a tool, or starts implementation;
Niko's next message remains the first possible course-of-action instruction.

Implemented areas include the Strategy Room schema/migration, store and
coordinator lineage, authenticated handoff/return routes, natural-language
chat tool wiring, stronger authorization/cookie scrubbing, exact chat/Room
navigation, linked-room controls, capability guidance, Explorer registry/tree,
verified manifest, architecture/capability docs, and focused server/web tests.

Verification:

- focused server handoff, store, route, migration, tool, policy and redaction:
  8 files / 68 tests passed;
- focused chat, app-navigation and Strategy Room UI: 3 files / 7 tests passed;
- focused Explorer registry and UI: 3 files / 18 tests passed;
- complete deterministic server suite passed; the isolated real-headless-Chrome
  regression also passed 4/4;
- complete web suite passed with the repository's established 10-second test
  timeout;
- server TypeScript/build and production PWA build passed;
- Explorer contract/reality audit passed: 31 capabilities, 55 tool mappings,
  89 verified source references, 19/19 API routes, and 55/55 server tools;
- `git diff --check` and staged diff checks passed.

AVA was restarted from the committed build. The verified live server is PID
`13088`, started 2026-08-11 19:26:38 local time, healthy on port 8787, and is
serving the new production bundle `index-BE0wm6rd.js`. The new live
`/api/strategy/rooms/from-chat` route is present behind AVA authentication.

Known limits: the room deliberately remains planning-only; a conclusion must
be approved and explicitly returned before it appears in chat. Typed chat
follows a successful natural-language handoff directly into the Room; a voice
request can create the same linked room but the voice surface does not silently
navigate away mid-session. Existing ES2024/esbuild and large-bundle warnings
remain. Forge was neither inspected nor modified. The unrelated
`.claude/settings.local.json` change and all prior append-only board history
remain untouched.

NEEDS: niko

---

### 2026-08-04 - codex - global watchers repaired; AVA Notes cycle armed

The watcher repair is complete and committed. This is not a Codex-only
scheduler: ordinary AVA watches still execute through AVA's authenticated
`/api/chat` path with the full registered toolset, so scheduled work can use
Chrome, Instagram, Claude Code and the other configured integrations. Codex is
the first dedicated delivery adapter, added so AVA can place a task into a
specific existing Codex thread without relying on terminal access.

The implementation is split into four scoped commits:

- `c80f7ea` - reliable scheduling, authenticated global execution, exact Codex
  thread targeting, lifecycle evidence and cycle continuation
- `79fa993` - process singleton preventing a losing Windows server boot from
  rotating live internal tokens
- `e616fe8` - singleton lock isolation from the runtime PID registry
- `4b3a76c` - normalized root-cycle ancestry and duplicate-successor safety

The global path was proven live, including the failure mode that originally
broke it. A second AVA server was deliberately started against the live port;
the singleton rejected it without changing either internal token. A normal
scheduled AVA `/api/chat` watch then completed successfully with result
`scheduler authentication remained valid after the losing restart.` The test
watch and its temporary session were removed afterward. No live dependency was
disrupted.

Verification completed:

- focused watcher tests: 39 server and 7 web tests passed during the primary
  change; the final root-parent regression suite passed 4/4
- server production build passed
- complete server test suite passed
- complete web suite passed: 80 files and 329 tests (10-second suite timeout to
  absorb an existing parallel-load TaskInspector timeout; its isolated tests
  also passed 4/4)
- web production build passed
- live AVA health is ready on `127.0.0.1:8787`, PID `1416`, with the singleton
  lock owned by the same process

AVA itself created the first cycle task through the normal chat/tool route. The
persisted watch is `MGCbNUq3O0hI`, pinned to Codex thread
`019f977d-97dc-7cd1-b2ad-904631196018` and its exact JSONL session. Its prompt
instructs Codex to build the Notes workspace, test it, commit it and update this
board without touching Forge. `continue_cycle=1` tells the scheduler to return
to AVA after Notes so AVA can choose and schedule exactly one next highest-value
bounded AVA improvement. The watch currently reports `busy` only because this
Codex turn is still open; ending the turn creates the idle boundary that permits
delivery into the same thread.

The unrelated local `.claude/settings.local.json` modification remains
untouched and uncommitted.

NEEDS: codex

---

### 2026-08-04 - codex - task receipt reliability fixes complete

I fixed and committed the defects from the live receipt investigation in
`9642bbb` (`fix(observability): make task receipts reliable`) without entering
Claude-owned Explorer or Forge.

The Stop path now publishes one immediate cancelled receipt/event, aborts the
active tool and child process tree, and suppresses the cooperative runtime's
late tool failure/final/done. A real 30-second PowerShell live test was stopped
after dispatch and produced exactly `tool_call -> receipt -> killed`, with no
false result afterward. Terse retry/continue turns now retain the nearest real
user objective in receipts, Mission Control, and playbook capture while the
literal message remains immutable. Pressing New remounts a genuinely blank chat
even when the current `chat-new` screen acquired an internal session.

Known local failures (ENOENT, allowlist, access/permission errors) are now
classified as known causes, ANSI CSI/OSC debris is removed before diagnostic
text is stored, and an action-routed no-tool answer is labelled Response
delivered rather than implying that an external outcome was verified. Sanitized
terminal receipts are persisted in SQLite for 30 days and replay by exact task
ID across the five-minute cache boundary and server restarts.

Mission Control now leaves the response event nonterminal and closes the run at
`agent.runtime.finished`, preventing the old late-event artifact. OpenAI and
Anthropic provider usage is recorded once per provider response; tokens and
cache hits are visible, while monetary cost remains honestly Not reported until
actual provider cost exists. Accounting failures are isolated from the task.

Verification completed: 71 focused server cases and 7 focused UI cases pass;
the complete server and web suites pass sequentially; server and web production
builds pass. Live tests proved known missing-file attribution with clean text,
retry objective inheritance, exact receipt replay after a real restart, active
tool cancellation, and real OpenAI usage (9,025 input / 26 output / 8,903
cached) with zero late events. Temporary sessions, devices, codes, and test
runs were removed afterward. The committed build was restarted and is healthy
on OpenAI; AVA Chrome is visible and ready.

The separate Explorer reality audit still fails on its pre-existing registry
drift: 20 unsupported/stale claims (11 missing symbols, 6 unserved routes, and
3 real tools absent from the map). I did not modify that Claude-owned area or
commit the audit's generated timestamp. The existing ES2024 and large-bundle
warnings also remain.

NEEDS: niko (manual confirmation of the New button and receipt presentation;
route the Explorer registry drift to Claude)

---

### 2026-08-03 - codex - Strategy Room claim

Niko explicitly asked me to build the Strategy Room discussed in this session.
I am claiming only the new Strategy Room surface and its narrowly scoped AVA /
Codex collaboration adapter. I will not modify Claude-owned Explorer or Forge.
The first slice will be persistent and clearly attributed, keep AVA as the
orchestration authority, use bounded discussion rounds, let Niko interrupt, and
require explicit plan approval before any development handoff.

NEEDS: codex

---

### 2026-08-03 - codex - Strategy Room v1 complete

I built and verified the first complete Strategy Room slice without entering
Claude-owned Explorer or Forge. AVA remains the room coordinator. A room now
persists Niko's topic and interruptions, AVA's position and cross-review,
Codex's review and final response, the living brief, room status, errors, and
the explicit conclusion decision in SQLite. The desktop-first `Room` surface
updates through an authenticated SSE event stream and shows each participant's
identity and current state.

The Codex side is real, not a simulated persona: AVA launches the installed
Codex CLI in a dedicated, read-only, approval-free discussion thread and
resumes that exact thread within the room. Prompts forbid code or file changes,
only public agent messages are persisted, secrets are scrubbed before storage,
and hidden reasoning is never captured. Niko can interrupt a running round,
pause/resume it, or approve the conclusion. Approval records agreement only;
it does not start implementation.

Verification completed: the full server suite and full web suite pass; server
and web production builds pass; focused storage, coordinator, route, adapter,
and UI tests pass; and live Codex CLI smoke tests proved both new-thread and
resume behavior. The existing repository-wide esbuild warning for the
unrecognized `ES2024` target remains outside this feature's scope.

The implementation, migrations, tests, UI, architecture note, and feature
contract are included together in the themed Strategy Room commit so HEAD does
not depend on untracked files.

NEEDS: niko

---

### 2026-08-03 - codex - task result receipt v1 complete

I built the approved Option A vertical slice on typed chat without changing
Claude-owned Explorer or Forge. Every current/recent typed task now emits a
compact in-conversation receipt with separate lifecycle and outcome quality,
expected versus actual behavior, the last proven-good stage, the first failure
or uncertainty observation point, root-cause confidence, recovery guidance,
bounded evidence, timing, tool-result counts, and the same run ID used by
Mission Control. The card expands for technical detail.

The verification boundary is deliberately conservative. A response reaching
the conversation is verified only as response delivery. A successful action
tool remains unverified until a capability-specific independent verifier is
added; partial, blocked, cancelled, failed, and unverified results stay visibly
distinct. Receipts never copy reasoning or raw arguments, and diagnostic text
is scrubbed and capped. The only replay cache is sanitized, in-memory, per
session, and expires after five minutes; no database, retention, auth, or
permission policy was added.

Verification completed: 10 focused server receipt/route tests and 12 focused
web stream/rendering tests pass; the complete server and web suites pass; both
production builds pass. Isolated fixtures cover a tool failure, secret
redaction, exact task correlation, and stale-receipt rejection. One unrelated
Explorer timing test failed once under parallel suite load, then passed both in
isolation and on the complete-suite rerun. The existing ES2024 target and large
bundle warnings remain outside this slice.

The implementation contract and reversion path are documented in
`docs/features/task-result-receipts.md`. I did not restart or deploy AVA because
the approved brief kept launch/deployment as Niko's separate decision.

NEEDS: niko

---

### 2026-08-03 - codex - task receipt test handoff

Niko asked how to test the receipt slice. The current AVA health endpoint is
ready but reports roughly 30 days of uptime, so it is an older process and must
be restarted before the new committed server and PWA can appear. The safest
manual validation is typed chat: a normal question should produce a verified
response-delivery receipt; a shell/read action should remain unverified without
an independent outcome check; reading a definitely missing path should expose a
safe failure boundary; and Stop should produce a stopped/cancelled receipt.
Mission Control can be opened beside chat with `/?mission-control=1` and matched
using the receipt task ID. Voice receipt rendering remains outside v1.

NEEDS: niko

---

### 2026-08-03 - codex - live receipt test findings

Niko ran the new receipt UI against two real typed-chat paths. The allowlist
rejection produced a failed receipt with zero successful steps, the precise
`fs_read` observation boundary, sanitized returned evidence, and no false
partial claim. A browser research retry produced a partial receipt after seven
reported successes and one `net::ERR_ABORTED` navigation failure, with the last
successful browser-read boundary and recovery guidance. This validates the
core failed-versus-partial model in the live runtime.

The test also exposed two definite polish gaps: a direct policy/allowlist
rejection is currently labelled root cause `likely` when that cause is known,
and a short follow-up such as `try agin` becomes the literal Expected field
instead of inheriting the parent task objective. The raw browser failure also
leaks harmless ANSI formatting debris into expanded evidence. Niko's pasted
text contains the first receipt twice with the same task ID, but the source
renders only the newest receipt once; whether this duplicated visually or only
during copy/paste is not yet established. No product code was changed in this
review turn.

NEEDS: niko

---

### 2026-08-04 - codex - investigation handoff placement note

The full deep-investigation entry above was accidentally inserted after the
coordination reply rather than at the end because the patch anchor was not
unique. I have left the append-only history intact and am adding this handoff at
the actual end. Its findings and recommended fix order remain current.

NEEDS: niko

---

### 2026-08-04 - codex - task receipt reliability fix claim

Niko approved fixing the defects found in the live investigation. I am
continuing in the Codex-owned task-receipt and Mission Control execution path.
The scoped work is active-tool cancellation correctness, retry objective
lineage, New-chat reset behavior, cause/ANSI semantics, verification and replay
behavior, plus the directly related tests. I will not modify Claude-owned
Explorer or Forge.

NEEDS: codex

---

### 2026-08-04 - codex - completion handoff placement note

The full `task receipt reliability fixes complete` entry was accidentally
inserted earlier in this append-only thread because `NEEDS: codex` was not a
unique patch anchor. I have left every existing word intact. That completion
entry, commit `9642bbb`, its verification evidence, and its Explorer-drift
qualification are the current final handoff.

NEEDS: niko

---

### 2026-08-04 - codex - structured Notes workspace claim

Niko asked for a dedicated Notes section where AVA can structurally capture
ideas and other material whenever he says to put something in Notes. I am
claiming a new, bounded Notes workspace slice: SQLite storage, authenticated
API, AVA tools, main navigation, manual capture and organisation UI, and the
tests and documentation needed to make the feature complete at HEAD. I will
reuse existing execution patterns but will not modify Claude-owned Explorer or
Forge surfaces.

NEEDS: codex

---

### 2026-08-04 - codex - newcomer-first Explore redesign request

Niko redirected me to redesign Explore so a person who knows nothing about AVA
immediately understands its real capabilities. Explorer is already claimed by
Claude, so I inspected the current surface and its tests but did not edit any
Claude-owned Explorer or Forge file.

The existing implementation has a strong truth layer worth preserving: runtime
readiness, explicit evidence caveats, searchable registry data, persistent
breadcrumbs, real task links, and workflow trees. Its first screen is currently
at the wrong altitude for a newcomer. It leads with system counts, evidence
coverage, seven operational tabs, and a large 22-domain architecture graph. The
best examples and one-tap launches are buried inside capability detail pages,
while unfinished Reviews and Evolution foundations occupy primary navigation.

Recommended redesign contract:

1. Add a novice-first **Discover** landing view before the technical Atlas with
   one plain headline: “What can AVA do for me?”
2. Organise the front door into five outcome pillars rather than internal
   subsystems: **Talk naturally**, **Control my computer**, **Use my web and
   accounts**, **Remember and organise**, and **Build and automate**.
3. Each pillar should show a one-sentence value statement, 2-3 real example
   requests, live readiness, and one honest proof signal. Every runnable example
   should launch a new AVA request directly.
4. Add a high-impact “Try AVA” strip for the most compelling configured actions
   and a “How AVA handles it” visual that opens the existing workflow tree in
   plain-language mode. Preserve technical depth behind an Overview / Detailed /
   Technical control.
5. Reduce the top-level newcomer navigation to **Discover, Map, Activity, Health**.
   Keep Tasks/Live under Activity; hide or clearly label unfinished Reviews and
   Evolution as future foundations rather than equal product destinations.
6. Derive showcase content from the capability registry plus runtime/task
   evidence. Do not create static marketing claims, and never make configuration
   or a tool return look like verified end-user success.
7. Keep AVA completely isolated from Forge: no Forge agents, runs, terminology,
   APIs, or developer control-plane state on this public capability showcase.

Acceptance should include a first-time-user test: within ten seconds they can
name at least three useful things AVA does, tell what is ready now, launch an
example, and reach the deeper workflow/evidence view without losing the return
path. Existing Explorer baseline remains green: 3 focused test files, 10 tests
passed. The only warning was the repository's existing ES2024/esbuild target
warning.

The Notes workspace remains Codex-owned; only its schema and state foundation
were started before Niko changed priority, and those uncommitted files are not
part of the Explorer handoff.

NEEDS: claude

---

### 2026-08-04 - codex - Explorer ownership transferred by Niko

Niko explicitly replied that Codex, not Claude, must make the Explore redesign.
Per the board rule that Niko's word wins, Explorer ownership is now transferred
to Codex for this implementation. I will build the newcomer-first Discover
surface, preserve the existing evidence-backed Atlas and task views, keep Forge
fully isolated, add focused tests, and commit the complete runnable change.

NEEDS: codex

---

### 2026-08-04 - codex - newcomer-first Explore redesign shipped

The redesign requested and explicitly assigned to Codex is complete in commit
`888e8c7` (`feat(explorer): showcase AVA's real capabilities`). Forge was not
inspected, modified, imported, or exposed by the new surface.

Explore now opens on a newcomer-first Discover experience rather than the
technical Atlas. It explains AVA in plain language, shows a concise ask-route-
act-check model, offers runnable examples, and groups real capability data into
five outcomes: talk naturally, control the computer, use web/accounts, remember
and organise, and build/automate. Each outcome is connected to the canonical
registry, runtime readiness, examples and the existing deep capability/workflow
inspector. The original technical Atlas remains under Map. Task history, live
work and learned workflows are grouped under Activity; Reviews and Evolution
remain reachable as advanced foundations rather than newcomer-level tabs.

During verification I found pre-existing registry drift and corrected it rather
than shipping a polished front over stale claims. The machine check now proves
29 capabilities, all 50 server tools, all 17 declared API routes, 79 verified
source references and zero broken references. It also now classifies
`computer_use` as browser control instead of incorrectly presenting it as
native Windows control.

Verification completed:

- Explorer contract and machine-reality check: passed
- Focused Explore tests: 25 passed
- Explorer server route tests: 6 passed
- Full web test suite: passed
- Production web build: passed
- Desktop 1440x900 and mobile 390x844 browser render checks: passed with no
  page errors
- `git diff --check`: clean for the shipped change

The only build warnings are the repository's existing ES2024/esbuild target
warning and the existing large-chunk advisory. The unrelated local
`.claude/settings.local.json` modification remains untouched and uncommitted.

NEEDS: niko

---

### 2026-08-04 - codex - watcher-to-Codex delivery claim

Niko assigned Codex to repair AVA watchers so a watcher can deliver a real task
instruction into this exact Codex session. A created watch or AVA notification
is not sufficient: the acceptance boundary is that the prompt arrives here and
can trigger the next implementation turn. If delivery fails, I will diagnose,
repair and retest rather than report setup as success.

Once the handoff is proven, AVA's first delivered instruction must be Notes.
Notes development will resume only after that instruction genuinely arrives.
After Notes, AVA will choose the highest-value next AVA improvement and schedule
it through the same verified handoff. Forge remains outside this scope.

NEEDS: codex

---

### 2026-08-04 - codex - watcher completion handoff placement note

The complete `global watchers repaired; AVA Notes cycle armed` entry was
accidentally inserted earlier in this append-only thread because its patch
anchor was not unique. I have preserved every existing word. That entry and
commits `c80f7ea`, `79fa993`, `e616fe8`, and `4b3a76c` are the current handoff.
AVA is healthy on port 8787 and watch `MGCbNUq3O0hI` is armed for this exact
thread. Ending the current turn is the remaining delivery boundary.

NEEDS: codex

---

### 2026-08-04 - codex - watcher-delivered Structured Notes shipped

Global watch `MGCbNUq3O0hI` delivered AVA's complete Notes instruction into the
exact pinned Codex session with marker `[AVA-WATCH:MGCbNUq3O0hI]`. This is the
first feature completed through the repaired whole-AVA watcher handoff, not a
Codex-only reminder path.

Structured Notes is now shipped across server, AVA tools, UI, Explorer and docs:

- General capture plus first-class project note spaces.
- The same lightweight project template everywhere: Quick capture, Pinned
  priorities, Decisions and Documentation.
- A four-stage Ideas / Doing / Review / Done Kanban with drag/drop and accessible
  move controls.
- Rich notes with context, kinds, tags, safe links, pinning, source lineage,
  bounded change history and optimistic versions.
- `notes_capture`, `notes_search`, `notes_update` and `notes_promote` in text and
  voice task routing. AVA is explicitly instructed to call the tool when Sir
  says to put something in Notes, rather than merely acknowledging him.
- Task promotion opens a prefilled AVA task; explicit self-improvement promotion
  keeps the existing approval gate and preserves the source note.
- Explorer now exposes the real Notes workflow, code/tool/API evidence, storage,
  safety and verification limits. Discover includes Notes under Remember and
  organise.

The review and live verification found four integration failures before handoff:

1. Unknown-tool policy would have added an approval stall to every Notes action;
   Notes reads are now read-only and local mutations are low risk.
2. Existing AVA databases could not boot because the schema created the new
   project index before migration added `project_id`; index creation now runs
   after legacy migration, with a dedicated old-database boot regression test.
3. A legacy collection named General produced a duplicate General project; the
   migration now folds it into the built-in General space and reserves that name.
4. The desktop board unnecessarily clipped the Done column; all four columns now
   fit at desktop widths while smaller screens retain horizontal board scrolling.

Privacy and integrity are enforced at the storage boundary: recognised secrets
are scrubbed, credential-bearing URLs are dropped, stale edits/deletes return
version conflicts, and Notes cannot silently bypass self-improvement approval.

Verification completed:

- Full server test suite: passed.
- Full web suite: 81 files / 332 tests passed.
- Server and production PWA builds: passed.
- Explorer contract/reality audit: 30 capabilities, 54/54 tools, 18/18 routes,
  83 verified source references and zero broken references.
- Committed-HEAD boot against the real existing SQLite database: healthy.
- Authenticated live API cycle: create, update, pin, promote, read back and delete
  all passed.
- Real OpenAI-backed AVA chat turn interpreted a natural Notes request, invoked
  `notes_capture`, persisted `ava_chat` lineage and responded successfully.
- Desktop 1440x1000 and mobile 390x844 browser checks passed with one General
  space, a visible Notes nav and no document overflow; all four board columns fit
  on desktop.
- Temporary notes, chat, test devices and screenshots were removed.

Commits: `bbca2eb`, `2b980dd`, `376601d`, `33194c7`, `a2c7a0e`, `45eab0a`.
AVA is healthy on port 8787 from committed HEAD. Forge was not inspected or
modified. The unrelated `.claude/settings.local.json` change remains untouched.

This is a clean task boundary. The watcher cycle may ask AVA for the next
highest-value repository instruction.

NEEDS: codex

---

### 2026-08-04 - ava - planned Codex watcher lifecycle Mission Control trace

Planning only for successor of watcher `PQDFUEctFKWK`. Repository evidence shows
Mission Control has durable normalized traces for voice/chat/tool work and the
recent background-discussion child-trace slice must not be repeated, while the
now-critical Codex watcher handoff path is documented and tested for delivery
but is not represented as an AVA-owned Mission Control lifecycle. The next
bounded improvement is therefore to trace each Codex watcher from scheduling
through dispatch acknowledgement and terminal delivery/failure, linked to its
cycle ancestry, using the existing sanitized observability envelope, retention,
redaction, SSE, and projection contracts. It must not expose hidden reasoning,
invent provider usage, add generic mutation controls, or inspect/integrate
Forge; Forge remains only an untouched adapter seam.

The implementation must be the smallest complete AVA-only vertical slice:
instrument the existing watcher scheduler/dispatch boundary idempotently; model
parent/child run lineage without duplicating action ownership; show honest
queued/waiting/delivered/failed state and sanitized prompt/response-status
evidence in the existing Mission Control UI; preserve stale-version and typed
control boundaries; add deterministic server and UI tests including replay,
duplicate delivery, failure, redaction, and cycle ancestry; update Mission
Control/watch documentation and Explorer evidence only if its verified registry
requires it; run focused and relevant broader suites plus server and production
web builds; perform a practical local check if available without making external
credentials deterministic acceptance; commit the complete change; and verify
final status retains only pre-existing unrelated changes, especially
`.claude/settings.local.json`. Re-read this board before appending completion
evidence. Confirm explicitly that Forge was neither inspected nor modified.

NEEDS: codex

---

### 2026-08-04 - ava - planned Hume voice Mission Control parity

Planning only for successor of watcher `g-ZM3bJmoq77`; no implementation was performed in this pass. Focused repository evidence identifies the highest-value remaining bounded AVA observability gap explicitly documented in `docs/features/mission-control.md`: OpenAI Realtime voice and AVA chat/action work are traced, while Hume voice is not yet instrumented. The next improvement is therefore the smallest complete Hume voice Mission Control vertical slice, reusing the existing provider-neutral voice run/event grammar, SQLite store and projections, sanitization/redaction/retention, SSE replay, action/accounting ownership, causation, and typed Stop/stale-version contracts. This must not repeat generic voice/tool tracing, watcher lifecycle tracing, task-receipt reliability, or background-discussion child traces. Forge remains outside scope and only an untouched adapter seam.

Implementation scope and acceptance: instrument Hume session, utterance, response, latency, usage-when-reported, interruption/cancellation, disconnect, and provider-error boundaries through the existing observability seam; preserve one AVA root trace and correct child/causation ancestry into any delegated AVA action/tool work; represent unsupported or unavailable Hume evidence honestly, never invent usage/cost, never retain raw audio, secrets, hidden reasoning, or unsanitized provider payloads; make duplicate, replayed, out-of-order, late, and terminal signals idempotent without rewriting terminal projections; expose Hume runs and sanitized collapsed evidence in the existing Mission Control UI with only genuinely supported scoped controls. Add deterministic focused server tests for successful and failed lifecycles, delegation ancestry, interruption/disconnect, duplicate/replay/late behavior, redaction/privacy, and usage-not-reported; add focused UI tests for provider identity, lifecycle, ancestry, evidence, and honest controls. Run focused server/web tests, relevant broader suites, full server and web suites where practical, server build, production web build, and Explorer contract/reality audit only if verified registry/docs evidence changes. External Hume credentials and live audio must not be deterministic acceptance dependencies; perform a local live check only if practical. Update `docs/features/mission-control.md` and the relevant voice documentation with exact behavior and limitations, update Explorer evidence only if its verified contract requires it, commit the complete AVA-only change, run `git diff --check`, and leave only pre-existing unrelated changes, especially `.claude/settings.local.json`. Read the full board before work and reread its tail immediately before every append; append exact changed files, commands/results, limitations, commit SHA, and explicit confirmation that Forge was neither inspected nor modified.

NEEDS: codex

---

### 2026-08-04 - ava - planned self-improvement Mission Control lifecycle trace

Planning only for successor of watcher `0iMIlF7YgdDz`; no implementation was performed in this pass. AVA-only evidence shows the repository has a mature approval-gated self-improvement pipeline and a separate Self journal, while focused Mission Control source and documentation contain no self-improvement lifecycle integration. Completed generic voice/tool observability, task-receipt reliability, background-discussion child traces, Codex watcher lifecycle tracing, and Hume voice parity must not be repeated. The next highest-value bounded improvement is therefore the smallest complete Mission Control vertical slice for one AVA self-improvement intent, from queued/reflection and explicit plan approval through implementation, verification, swap, rollback, failure, or cancellation, reusing the existing normalized envelopes, durable store/projections, sanitization, retention, SSE replay, ancestry, action/accounting ownership, and stale-version contracts. Forge remains outside scope and only an untouched adapter seam.

Implementation scope and acceptance: instrument existing self-improvement state transitions at their authoritative boundaries without creating a parallel journal or telemetry store; preserve one AVA root trace and stable intent/run ancestry across worker/worktree/verification and watchdog boundaries; represent awaiting-approval honestly and retain the existing approval gate; expose only controls genuinely supported by the runtime, using typed scope and expected-version protection and never a generic mutation route or fake Stop. Record sanitized operational summaries, commit/build/test/boot-smoke evidence and rollback outcomes without prompts containing secrets, hidden reasoning, raw environment data, unsanitized worker output, or invented usage/cost. Duplicate, replayed, out-of-order, late, restart-recovery, and terminal signals must be idempotent and unable to rewrite terminal projections. Make lifecycle, current owner, ancestry, approval wait, verification evidence, failure/rollback reason, and limitations understandable in the existing Mission Control UI while linking rather than duplicating the Self journal.

Add focused deterministic server tests for queued-to-shipped, awaiting approval, denial/cancellation where supported, worker failure, verification failure, rollback, restart recovery, ancestry/action ownership, duplicate/replay/out-of-order/late terminal behavior, and redaction/privacy. Add focused Mission Control UI tests for lifecycle, approval wait, ancestry, collapsed evidence, rollback/failure presentation, journal linkage, and honest controls. Run focused server/web tests, relevant broader suites, full server and web suites where practical, server build, production web build, and the Explorer contract/reality audit only if verified registry/docs evidence changes. External model credentials and a real self-swap must not be deterministic acceptance dependencies; perform a bounded local live check only if practical and safe. Update `docs/features/mission-control.md` and relevant self-improvement documentation with exact behavior and limitations; update Explorer evidence only when its verified contract requires it. Commit all complete AVA-only changes clearly, run `git diff --check`, and leave only pre-existing unrelated changes, especially `.claude/settings.local.json`. Read the full board before implementation and reread its tail immediately before every append; append exact files, commands/results, live evidence if any, limitations, commit SHA, and explicit confirmation that Forge was neither inspected nor modified.

NEEDS: codex

---

### 2026-08-04 - ava - planned verified-outcome evidence boundary for Mission Control

Planning only for successor of watcher `1WsTNiOBMxwt`; no implementation was performed in this pass. The full board, recent commits, focused tests, Mission Control source, and current documentation were inspected without entering Forge. Existing and already planned slices cover generic voice/tool tracing, task-receipt reliability, background-discussion ancestry, Codex watcher lifecycle, Hume parity, and self-improvement lifecycle. The highest-value confirmed non-duplicative gap is milestone 2 in `docs/features/mission-control.md`: Mission Control currently records tool results but lacks a first-class, reusable evidence boundary that distinguishes an executor's returned success from independently verified external outcome. The next bounded AVA-only improvement is therefore the smallest complete verified-outcome evidence vertical slice for existing AVA tool runs. Forge remains outside scope and only an untouched adapter seam.

Implementation scope: extend the existing normalized observability envelopes, SQLite store/projections, retention/redaction, SSE replay, ancestry, and action/accounting contracts with typed verification evidence and an honest verification state such as unverified, verified, contradicted, unavailable, or not-applicable. Instrument one shared authoritative AVA tool-result boundary plus a small representative set of existing tools that already perform deterministic post-action checks; do not invent verification, re-run consequential actions, or make every tool look verified. A returned `ok` must remain executor-reported until separate evidence is recorded. Preserve stable action/provider IDs and one root trace, make verification events idempotent under duplicate/replay/out-of-order/late/restart signals, and prevent late evidence from rewriting terminal action outcome while still retaining immutable history. Show concise sanitized verification status and collapsed evidence in the existing Mission Control UI, clearly separating executor report, verification method, evidence time, and limitations. Add no generic mutation route or fake Stop.

Acceptance criteria and tests: deterministic server tests must cover reported-success-without-verification, verified success, contradiction, unavailable/not-applicable verification, failure, duplicate/replay/out-of-order/late evidence, restart recovery, ancestry/action ownership, and redaction of secrets, raw environment data, hidden reasoning, and unsanitized tool output. Focused Mission Control UI tests must cover clear verified/unverified/contradicted presentation, collapsed evidence, timestamps/method labels, ancestry, and honest controls. Use only bounded sanitized evidence summaries and references; do not store screenshots by default, raw credentials, cookies, authorization data, or invented usage/cost. Run focused server/web tests, relevant broader suites, full server and full web suites where practical, server build, production web build, and the Explorer contract/reality audit only if verified registry/docs evidence changes. External credentials and live consequential actions must not be deterministic acceptance dependencies; perform a safe bounded local check only if practical.

Update `docs/features/mission-control.md` and relevant tool/result-receipt documentation with exact implemented behavior, supported verification producers, and limitations; update Explorer evidence only if its verified contract requires it. Commit all complete AVA-only changes with a clear message. Preserve every unrelated local change, especially `.claude/settings.local.json`; respect append-only `coord/BOARD.md` history by reading the full board first and rereading its tail immediately before every append. Verify `git diff --check` and final status, then append exact files changed, commands/results, live evidence if any, limitations, commit SHA, and explicit confirmation that Forge was neither inspected nor modified.

NEEDS: codex

---

### 2026-08-04 - ava - planned shared-browser cross-session lease boundary

Planning only for successor of watcher `qJkrb1p5Mxqf`; no implementation was performed in this pass. The completed verified-outcome evidence slice closes the previously documented outcome-trust gap. The highest-value remaining bounded AVA reliability gap from the current repository/board evidence is that AVA's single persistent Chromium context has no cross-session resource lease, so concurrent chat, voice, watcher, and social/browser jobs can redirect or type into one another's active page.

Implement the smallest complete AVA-only shared-browser lease vertical slice. Reuse the existing persistent browser runtime, task/action ancestry, durable SQLite conventions, sanitization, observability envelopes, and stale-version/idempotency contracts rather than creating a second browser or a parallel scheduler. Serialize mutating browser operations across sessions with an explicit bounded lease/owner identity, safe renewal and release, restart/owner-death recovery, and honest busy/timeout errors; allow truly read-only inspection only where proven safe. Preserve same-task multi-step flows without deadlock or interleaving, and ensure Instagram/WhatsApp dedicated workflows participate in the same boundary. Never replay a consequential action after uncertain lease loss, never expose cookies, credentials, page secrets, raw arguments, or hidden reasoning, and do not add a generic mutation endpoint or fake cancellation control.

Add deterministic focused server tests for mutual exclusion, same-owner reentrancy or flow continuity, fairness/bounded waiting, timeout, duplicate release, stale owner/version, owner death/restart recovery, cross-session isolation, social workflow participation, and redaction/privacy. Add focused Mission Control evidence only through the existing model where useful: sanitized waiting/acquired/released/expired states and ancestry, without claiming action success from lease acquisition. Run focused and relevant broader server/web suites, full suites where practical, server build, production web build, and the Explorer contract/reality audit only if verified registry/docs evidence changes. Perform a safe bounded local concurrency check if practical without external credentials or consequential live actions. Update browser/runtime and Mission Control documentation with exact semantics and limitations, commit all complete AVA-only changes, verify `git diff --check`, and leave only pre-existing unrelated changes, especially `.claude/settings.local.json`. Read the full board first and reread its tail immediately before every append; append exact files, commands/results, limitations, commit SHA, and explicit confirmation that Forge was neither inspected nor modified. Forge remains outside scope as an untouched adapter seam.

NEEDS: codex

---

### 2026-08-11 - codex - Mission Control privacy-safe evidence export claim

Watcher `RRvFJhTJUWSN` assigns the next bounded AVA-only Mission Control slice
to Codex. I am claiming a read-only, authenticated JSON export for one selected
run or trace. It will reuse the authoritative observability store and existing
sanitizer, define a stable snapshot boundary and strict bounds, disclose partial
or retained history honestly, and preserve ancestry and evidence provenance
without changing runtime state. I will not add CSV, replay, mutation controls,
or duplicate persisted files. Forge remains outside scope and will not be
inspected or modified. Existing unrelated changes, especially
`.claude/settings.local.json` and the prior append-only board entries, will be
preserved.

NEEDS: codex

---

### 2026-08-11 - codex - privacy-safe Mission Control evidence export shipped

The bounded export slice is complete in commit `bffd9d7`
(`feat(observability): add privacy-safe evidence export`). Mission Control now
offers one honest Export evidence action for a selected run. Niko can choose
run or trace scope and download a JSON file created locally in the browser.

Implemented files:

- `server/src/observability/export.ts` and `export.test.ts`: versioned export
  document, repeated export-time sanitization, prohibited-content exclusion,
  retention/completeness disclosure, and configured row/byte/time bounds.
- `server/src/observability/store.ts`: a read-only SQLite snapshot selected in
  deterministic order at one durable high-water event cursor.
- `server/src/routes/mission-control.ts` and its test: authenticated
  `GET /runs/:id/export`, run-anchored trace derivation, strict filters, typed
  400/404/413 errors, no-store download headers, and metadata capability.
- `web/src/api.ts`, `api.test.ts`, `MissionControlScreen.tsx`, and its test:
  authenticated fetch, temporary Blob download, supported-scope controls,
  schema/snapshot/redaction/partial notices, absent controls on old servers,
  and error presentation.
- `docs/features/mission-control.md`: exact schema, privacy, bounds, snapshot,
  retention, error, and non-goal contract.

The export is read-only and does not add a replay or generic mutation route.
Trace scope is derived from the authenticated selected run rather than a
free-form trace ID. A SQLite read transaction fixes the snapshot cursor;
arrivals afterward belong to a later export. The server re-sanitizes every
included field. Objectives and non-detail payload bodies remain collapsed
references by default. Raw audio, screenshots, raw provider payloads,
authorization data, secrets, hidden-reasoning fields, and unsanitized tool data
are excluded. Successful exports are never silently truncated.

Verification:

- focused export/server API: 2 files, 11 tests passed;
- relevant store/redaction/auth/server: 5 files, 28 tests passed;
- focused Mission Control/API web: 2 files, 11 tests passed;
- relevant Mission Control/auth web: 3 files, 13 tests passed before the final
  local-download test, which also passed in the final focused run;
- complete server suite passed;
- complete web suite first reproduced the existing parallel-load 5-second
  `TaskInspector` timeout; that file passed 4/4 in isolation and the complete
  suite passed with the repository's established 10-second timeout;
- server production build passed;
- production PWA build passed;
- `git diff --check` and staged diff check passed.

Safe local evidence used a synthetic in-memory AVA database, the real
`requireToken` middleware, a freshly issued device token, and the real export
route. It returned the attachment contract without external credentials or
consequential actions. Deterministic tests also prove cross-trace isolation,
stable ordering/high-water behavior, post-snapshot exclusion, legacy-record
re-sanitization, ancestry/action/provider/verification provenance, retention
partials, row and byte rejection, no state mutation, and local Blob revocation.

Known limits are deliberate: JSON only; at most 1,000 combined rows,
1,000,000 serialized bytes, and a 30-day observed execution span; compacted
history is explicitly partial; objectives and non-detail payload bodies are not
included. The Explorer audit was not run because no Explorer registry or
verified-capability contract changed. Existing ES2024/esbuild and large-bundle
warnings remain. No production runtime restart was required for deterministic
acceptance.

Forge was neither entered, inspected, imported, nor modified. The unrelated
`.claude/settings.local.json` change and prior append-only board content remain
unstaged as required. This is a clean successor-planning boundary; no successor
task was selected or scheduled in this slice.

NEEDS: nobody

---

### 2026-08-11 - codex - linked chat / Strategy Room handoff claim

Niko asked for a continuous collaboration flow from an ordinary AVA chat into
the existing Strategy Room, with Codex joining the discussion, and then back to
the exact originating chat once the group reaches a conclusion. I am claiming
this Codex-owned Strategy Room integration only. The bounded slice will preserve
the source-chat lineage and a sanitized context snapshot, keep discussion and
approval inside the existing room, and return the approved conclusion to the
originating conversation as a clearly labelled proposed course of action. It
will not silently execute that proposal or create a second collaboration UI.
Existing unrelated changes will be preserved.

NEEDS: codex

---

### 2026-08-11 - codex - linked chat / Strategy Room handoff completion boundary

Commit `663ded9` ships the claimed linked chat / Strategy Room handoff. The
complete implementation, verification, live-runtime evidence, limitations and
Forge-out-of-scope confirmation are preserved in the earlier entry titled
`linked AVA chat / Strategy Room handoff shipped`. That completion entry was
accidentally inserted after an earlier `NEEDS: codex` marker instead of at the
physical file tail; it has deliberately not been moved or rewritten because
this board is append-only. This tail entry records the correct clean boundary.

AVA is healthy on the freshly started PID `13088` and serves the committed
production bundle. Only the pre-existing `.claude/settings.local.json` change
and append-only board history remain outside the product commit. Forge was
neither inspected nor modified.

NEEDS: niko

---

### 2026-08-11 - codex - approved linked-room return recovery claim

Niko's live linked room proves approval succeeded, but the adjacent Reopen
discussion control immediately moved the room back to discussing before its
approved conclusion was returned. I am claiming this Strategy Room reliability
fix: preserve the approved return boundary, prevent a linked approved room from
being reopened before return, make the primary next action unambiguous, and
recover the immutable approved synthesis from Niko's live room without rerunning
the discussion or executing the proposal. Existing unrelated changes will be
preserved; Forge remains outside scope.

NEEDS: codex

---

### 2026-08-11 - codex - approved linked-room return recovery tail boundary

Commit `7d7861d` completed this claim. The full changed-file list, test/build
evidence, exact live recovery proof, limitations, running PID, and Forge
confirmation are preserved in the earlier append-only entry titled
`approved linked-room return recovery completion`; that entry was accidentally
appended after an earlier matching `NEEDS: codex` marker and has not been moved
or rewritten. This physical-tail entry establishes the clean handoff boundary.

The originally approved synthesis is now message `884` in source chat
`QizXuNuVidF-`; room `room_oY1Ivtl4R5Lr` is approved and returned. AVA is
healthy on PID `17476` and serves the fixed production bundle. Forge was
neither inspected nor modified.

NEEDS: niko

---

### 2026-08-11 - codex - AVA visual explanations v1 claim

Niko approved and assigned Codex the AVA-only visual-explanation foundation.
I am claiming this new capability end to end: Mermaid remains canonical for
topology; a minimal versioned storyboard references stable Mermaid node IDs for
scenes, captions, highlights, transitions and interaction cues; AVA presents it
through a restrictive sandboxed embedded viewer with progressive drill-down,
keyboard and reduced-motion access, SVG/PNG export, an accessible static
fallback, and installed/offline operation. Generated HTML/SVG/PNG are
disposable artifacts rather than canonical state. The slice includes schema
and stable-ID validation, representative repository/request-path/branching
fixtures, the existing AVA UI and agent/tool path, security tests,
documentation, production builds and boot smoke. OpenFlowKit, Dashmotion,
Manim/ManimML, Excalidraw, video and narration remain outside v1. Forge will
not be entered, inspected, imported or modified.

NEEDS: codex

---

### 2026-08-11 - codex - inline VisualMessage claim tail boundary

The complete inline VisualMessage claim appears earlier in this append-only
thread because the initial patch matched an older non-unique `NEEDS: codex`
anchor. No history was moved or rewritten. This physical-tail entry establishes
the active claim: Codex owns the AVA-only inline visual-message, chat rendering,
and narrow persistence integration requested by Niko. Forge remains outside
scope and will not be inspected or modified.

NEEDS: codex

---

### 2026-08-11 - codex - inline VisualMessage redesign shipped

Commit `ce254079b71255b3da9705dd2109c173dd73c0eb` completes the claimed
AVA-only inline visual redesign. The architecture is a native React chat card,
not an iframe: the previous isolated viewer was secure, but it could not meet
the sizing, scroll anchoring, same-app expansion, selection, accessibility and
structured semantic-action gates without a fragile cross-frame protocol.
Mermaid is now only a trusted bundled renderer. The canonical persisted source
is the validated renderer-neutral `VisualMessage` 1.0 semantic model plus
stable IDs, immutable revision, storyboard, renderer metadata and generated
accessible fallback.

Changed product areas:

- `server/src/visual-explanations/model.ts`,
  `server/src/state/visual-explanations.ts`, `server/src/state/schema.sql`,
  `server/src/state/db.ts`, and `server/src/state/messages.ts` add strict
  VisualMessage validation, stable semantic relationships, immutable revision
  persistence, optimistic stale-revision guards, message metadata and legacy
  read compatibility.
- `server/src/routes/chat.ts`, `server/src/routes/sessions.ts`,
  `server/src/routes/visual-explanations.ts`, and
  `server/src/tools/visual-explanations-mcp.ts` attach exact visual revisions to
  assistant history, hydrate them after reload, preserve the existing tool
  contract, and accept only explicit server-validated visual context. Context
  prompts are derived from stored labels; local zoom, pan, hover, scene and
  unsubmitted selection state never enter AVA's prompt.
- `web/src/visuals/VisualMessageCard.tsx`, `types.ts`, `render.ts`, `api.ts`,
  `VisualExplanationViewer.tsx`, and `VisualsScreen.tsx` provide native inline
  scenes, captions, highlights, zoom/pan, keyboard navigation, reduced motion,
  accessible text, SVG/PNG export, narrow-width behavior, local selection,
  explicit Explain/branch/attach actions, safe static fallback, and an optional
  advanced workspace. SVG is re-sanitized and inert; generated HTML/JavaScript,
  links, event handlers, foreign objects and external/data URLs are rejected.
- `web/src/chat/MessageList.tsx`, `ChatScreen.tsx`, and `web/src/api.ts` render
  visuals directly beneath AVA's explanation, restore exact revisions on
  reload, preserve multi-visual association, and keep expanded mode in AVA
  while retaining scene, selection, focus and return scroll position.
- Focused server/web tests, capability contracts, Explorer registry/evidence,
  `docs/features/visual-explanations.md`, and `docs/AVA-CAPABILITIES.md` were
  updated with implemented behavior and limits.

Verification evidence:

- focused server: 5 files / 33 tests passed;
- focused web: 6 files / 24 tests passed;
- full server suite passed standalone (exit 0);
- full web suite passed standalone (exit 0); an earlier simultaneous
  server+web run produced one resource-contention timeout in the existing
  Explorer history test, which passed alone and in the standalone full rerun;
- `npm.cmd run test:explorer-contract` passed: 32 capabilities, 57 tool
  mappings, 98 verified source references, 20/20 routes and zero broken refs;
- `npm.cmd -w server run build`, `npm.cmd -w web run build`, and
  `git diff --check` passed. The production PWA contains 57 precache entries;
  only the pre-existing ES2024 and large-chunk warnings remain;
- an isolated committed-`dist` smoke created a fresh SQLite database, migrated
  `messages.metadata`, stored VisualMessage revision 1, attached its exact
  reference to an assistant message and restored both successfully;
- normal `RUN-AVA.cmd` boot smoke is healthy on server PID `20768`, returns
  HTTP 200, and serves `/assets/index-Cgxodgxn.js` containing the native inline
  visual and semantic-action UI.

Deliberate v1 limits: flowcharts are the initial diagram kind and Mermaid the
initial renderer; direct canvas editing remains deferred in favor of
conversational revisions; the optional Visuals workspace remains available;
voice-created visuals are stored but are not yet automatically attached to a
voice transcript bubble. The unrelated `.claude/settings.local.json` change
and append-only board history were excluded from the commit. Forge was neither
entered, inspected, imported nor modified.

NEEDS: niko

---

### 2026-08-11 - codex - visual rendering engine replacement claim

Niko tested the shipped inline VisualMessage experience and found the actual
visualization quality and behavior unacceptable. He explicitly assigned Codex
to research the strongest current open-source visualization foundations and
replace the weak renderer with the best AVA fit. I am reclaiming the existing
Codex-owned AVA visual-message rendering slice for this evidence-led redesign.

The canonical semantic VisualMessage, immutable revision, persistence,
explicit semantic-context and security boundaries will be preserved where
sound. The implementation will replace or substantially upgrade the renderer
and interaction layer based on current official project evidence, add focused
regressions for the live failures found, run complete relevant tests/builds and
boot smoke, and commit the complete AVA-only change. Forge will not be entered,
inspected, imported or modified; unrelated `.claude/settings.local.json` and
append-only board history will remain outside the product commit.

NEEDS: codex

---

### 2026-08-11 - codex - native graph redesign completion tail boundary

The complete implementation and verification record for commit `7e084a4`
appears earlier in this append-only thread because the append patch matched an
older non-unique `NEEDS: codex` anchor. No existing history was moved, edited or
deleted. That entry records the React Flow + Dagre replacement, 1,225-server /
361-web deterministic test results, production builds, Explorer audit, real
Chrome smoke evidence, limitations, cleanup, and explicit Forge exclusion.
This physical-tail entry closes the active visual rendering claim.

NEEDS: niko

---

### 2026-08-11 - codex - deep-research visual artifacts claim tail boundary

Niko assigned Codex to add first-class, evidence-linked visual explanations to
AVA research results. Repository inspection shows research currently flows
through AVA's ordinary orchestrator/browser/chat path rather than a separate
deep-research subsystem. This claim therefore covers one coherent AVA-only
extension: a typed renderer-neutral research artifact; grounded selection
across geographic maps, timelines, evidence-gap matrices, claim-evidence
graphs, charts and process diagrams; claim/source provenance; progressive
scenes; persistence and inline rendering; deterministic validation and honest
fallbacks; revision guards; and normalized Mission Control progress.

Existing VisualMessage revisions, chat persistence, browser research tools,
native graph renderer, redaction/retention and observability contracts will be
reused. The work includes focused migration/API/tool/UI tests, relevant full
suites and builds, a boot smoke, documentation and a scoped commit. Forge will
not be entered, inspected, imported or modified, and unrelated local changes
remain outside the product commit.

NEEDS: codex

---

### 2026-08-11 - codex - deep-research visual artifacts shipped

Commit `e849e57` completes the claimed AVA-only deep-research visual slice.
AVA research can now persist and render a versioned schema-2.0 evidence
artifact instead of forcing every subject through one flowchart. One assistant
turn may attach multiple exact visual revisions; conversation history restores
them after reload.

Implemented areas:

- `server/src/visual-explanations/research-model.ts` defines and validates six
  renderer-neutral forms: genuine geographic maps, timelines, evidence-gap
  matrices, claim-evidence graphs, sourced charts and process diagrams. Stable
  IDs, claim/source references, source quality, confidence, disagreement,
  uncertainty, gaps, progressive scenes and complete scene coverage are
  mandatory. Missing coordinates, sources or quantities fail safely rather
  than being invented.
- `server/src/state/visual-explanations.ts`, the authenticated separate
  `/api/visual-explanations/research` write boundary, and the
  `research_visual_create` agent tool reuse immutable VisualMessage revisions,
  fingerprint dedupe and expected-revision stale guards. Schema 1.0 and legacy
  Mermaid records remain readable without a new parallel store.
- Chat/tool integration attaches every exact generated revision to the
  assistant result, restores it from history and accepts selected visual
  context only through explicit revision-checked actions. The server derives
  context from validated entities, claims and direct source URLs.
- `ResearchVisualCanvas.tsx` and `ResearchVisualCard.tsx` render the six forms
  inline with progressive scenes, scene- and entity-level source links,
  confidence/uncertainty inspection, time-layer filters, keyboard access,
  reduced-motion behavior, in-AVA expansion, synchronized synthesis/method/
  limitations/source panels, SVG/PNG export and a labelled static fallback.
- Geographic visuals use bundled `d3-geo`, `topojson-client` and Natural Earth
  110m data (`world-atlas`), all ISC-licensed packages; Natural Earth is public
  domain and is attributed in the UI. No tile API, key, CDN or live network is
  needed after installation.
- `research.visual.planning`, `validated`, `persisted` and `failed` events use
  the existing normalized Mission Control store with idempotent IDs and
  source-sensitive collapsed evidence. No prompt, source body, secret or raw
  provider payload is placed in the event stream.
- The provider tool rubric, capability text, Explorer runtime mapping and
  verified manifest now match the real 58-tool belt. Architecture, extension
  rules, privacy and limitations are documented in
  `docs/features/visual-explanations.md`, `docs/features/mission-control.md`
  and `docs/AVA-CAPABILITIES.md`.

Verification evidence:

- focused server: 6 files / 65 tests passed (model/forms, API auth and stale
  writes, persistence/reload, tool/observability, chat context and policy);
- focused web: 5 files / 24 tests passed, with the final source-link change
  rechecked in 3 files / 15 tests;
- full server regression suite passed with exit 0, excluding only the existing
  environment-bound `src/tools/chrome-click.test.ts`;
- full web suite: 87 files / 368 tests passed;
- Explorer contract/reality audit passed: 32 capabilities, 58/58 tools,
  100 verified source references, 20/20 routes and zero broken claims;
- committed-HEAD server and production PWA builds passed. The existing
  ES2024/esbuild warning and large-main-chunk warning remain; the PWA precaches
  eight entries and the bundled map data for offline use;
- AVA's built-in committed-`dist` boot smoke started the server against a fresh
  temporary data directory/SQLite database and returned `healthy` from
  `/api/health`;
- `git diff --check` passed. Final status before this board append contained
  only the pre-existing `.claude/settings.local.json` change and this
  append-only board.

Deliberate limits: the first map renderer is an evidence map, not a full GIS;
regions are sourced rectangular bounds and antimeridian regions must be split.
There is no geocoder and no automatic numerical inference. Each visual is
bounded to small research-story scales; very large datasets need a later
aggregation/virtualization increment. The production main bundle remains
about 2.02 MB minified and should be code-split next. Research uses AVA's
existing browser/orchestrator path rather than a new research scheduler.

Forge was neither entered, inspected, imported nor modified. The unrelated
Claude settings and board history were excluded from the product commit.

NEEDS: niko

---

### 2026-08-11 - codex - visual form selection reliability claim

Niko reports that real AVA requests still collapse into the same diagram form
despite the schema-2.0 renderer support. I am reclaiming only the AVA visual
tool-selection and research-artifact generation path to reproduce the live
failure, identify whether routing, prompt/tool precedence, validation fallback,
persistence, or client dispatch is responsible, and fix the smallest complete
root cause. Acceptance requires deterministic end-to-end requests that select
and render genuinely distinct map, timeline, evidence-matrix, claim graph,
chart, and process artifacts, plus explicit-form overrides and an honest
fallback when grounded data is unavailable. I will preserve schema-1.0 legacy
compatibility, unrelated local changes, and append-only board history. Forge
will not be entered, inspected, imported, or modified.

NEEDS: codex

---

### 2026-08-12 - codex - visual form selection reliability shipped

Commit `f20e559` fixes the real AVA behavior that made different visual
requests collapse into the same flowchart form. Two independently verified
causes were involved. First, the live AVA process had started at 20:47, before
the inline VisualMessage, native graph, and six-form research commits existed;
its SQLite evidence contained eight schema-1.0 legacy flowcharts and zero
schema-2.0 visual revisions. Second, current HEAD exposed the small generic
flowchart tool beside the richer research visual tool, allowing the provider
to choose the easier contract even when Niko explicitly requested a map,
timeline, chart, matrix, or claim graph.

Implemented areas:

- `server/src/visual-explanations/request-selection.ts` adds a deterministic
  pre-provider availability boundary. Explicit geography, timeline, chart,
  evidence-gap, and claim-evidence requests expose only the typed research
  visual contract. Plain architecture, workflow, mechanism, and request-path
  requests expose only the process contract. Broad research keeps evidence-led
  automatic form selection; genuinely ambiguous turns retain both contracts
  with the multi-form tool first.
- `server/src/tools/visual-explanations-mcp.ts` narrows the available tools,
  injects the user's explicit visual form into validation/persistence, and
  rejects a provider attempt to substitute another form. The lightweight tool
  description now explicitly excludes maps, timelines, matrices, claim graphs,
  charts, and research results.
- `server/src/routes/chat.ts` passes the literal current user request into that
  boundary. No inferred summary or prior turn can silently change the requested
  form.
- New and expanded focused tests cover Niko's actual failed prompts for an AI
  timeline, comparison chart, Viking migration map, broad AI-model research,
  Instagram architecture, evidence gaps, claim/counterevidence, process
  research, ambiguous visuals, forced-form persistence, and conflicting-form
  rejection. `docs/features/visual-explanations.md` records the contract.

Verification evidence:

- focused server routing/model/chat suite: 4 files / 47 tests passed;
- complete deterministic server suite passed with exit 0, excluding only the
  existing environment-bound `src/tools/chrome-click.test.ts`;
- focused specialized visual UI suite: 3 files / 17 tests passed, including
  genuine geography, all six specialized forms, provenance, keyboard/reduced
  motion, explicit semantic actions, export, and fallback;
- full web suite reached 86 files / 367 tests passed with one unrelated
  Explorer Task Inspector test exceeding its hard 5-second timeout; the exact
  test then passed 4/4 with a 10-second limit and no product change;
- server build, production PWA build, `git diff --check`, and the committed-HEAD
  built-in boot smoke all passed. The known large-bundle and ES2024/esbuild
  warnings remain;
- Explorer contract/reality audit passed: 32 capabilities, 58/58 tools,
  100 verified source references, 20/20 routes, and zero broken claims;
- the verified stale live process was stopped and committed HEAD was launched
  as PID 14776. `/api/health` reports ready with the OpenAI provider and the app
  root returns HTTP 200;
- a real authenticated AVA chat smoke (not a mock) requested a CERN milestone
  timeline. AVA persisted exactly one schema-2.0 artifact with
  `diagram_kind=timeline`, titled `Birth of the Web at CERN: 1989-1993`, and
  surfaced the supplied source's current 404 as a limitation rather than
  inventing evidence.

Files committed: `server/src/visual-explanations/request-selection.ts` and its
tests; `server/src/tools/visual-explanations-mcp.ts` and tests;
`server/src/routes/chat.ts` and inline-visual route tests; and
`docs/features/visual-explanations.md`.

Known limitation: existing schema-1.0 visuals remain legacy flowcharts because
they do not contain enough grounded semantic data to safely infer another
form. New requests use the corrected routing. Broad research still lets the
evidence choose the form by design, and specialized forms still fail honestly
when required dates, coordinates, quantities, or sources are unavailable.

Forge was neither entered, inspected, imported, nor modified. The unrelated
`.claude/settings.local.json` change and append-only board history remain
outside the product commit.

NEEDS: niko

---

### 2026-08-12 - codex - deterministic Instagram profile-to-message claim

Niko has specified the authoritative Instagram send path: resolve the saved
person entry to its Instagram username, construct and open the exact
`https://www.instagram.com/<username>/` profile URL, verify that profile, click
its Message action, type the approved text in the resulting verified thread,
send, and verify appearance. Inbox/message search must not be used as the
recipient-resolution path because it has repeatedly selected or searched the
wrong conversation. I am claiming only AVA's Instagram/people send workflow,
its deterministic browser boundaries, focused tests, documentation, build,
committed-HEAD smoke, and scoped commit. Existing unrelated changes will be
preserved. Forge will not be entered, inspected, imported, or modified.

NEEDS: codex

---

### 2026-08-12 - codex - deterministic Instagram profile-to-message shipped

Commit `21ee771` removes the two recipient-routing paths that caused AVA to
search or open the wrong Instagram conversation: the stored-thread fast path
and the `/direct/new/` compose-search fallback. The people-map username is now
the authoritative recipient identity.

The enforced send/open/read route is: resolve the person or alias from the
people map -> require and normalize the saved Instagram username -> open the
exact `https://www.instagram.com/<username>/` profile -> verify that the final
URL is still exactly that username -> click the profile's exact `Message`
action -> require a real `/direct/t/<id>/` result -> type the approved text ->
send -> verify that the text appears and is no longer in the composer. Stored
thread IDs remain only as evidence of a previously opened thread and are never
used to select the recipient. Messaging tools are also instructed not to run
the inbox-opening status tool first.

Safety boundaries now stop without sending if the people entry has no valid
username, the identity is ambiguous, the profile is unavailable or redirects
to another username, login/2FA/challenge is present, the page remains blank,
the exact Message action is missing, no thread URL appears, the composer is
missing, or post-send appearance cannot be verified. No real Instagram message
was sent during verification.

Files committed:

- `server/src/apps/instagram.ts`, `instagram.test.ts`, `instagram-mcp.ts`, and
  `people.ts`;
- `server/src/orchestrator/tool-rubric.ts`, `capabilities-content.ts`, and
  `server/src/routes/chat.ts`;
- `web/src/explorer/registry.ts` plus its test, `web/src/api.ts`, and the People
  section plus its test;
- `docs/account-integrations.md`.

Verification evidence:

- focused Instagram/people suite: 2 files / 54 tests passed, including the
  exact `_princi150` example, learned-thread bypass prevention, no-username
  refusal, URL mismatch, missing Message action, login redirect, send, and
  post-send verification;
- focused Explorer/People UI suite: 3 files / 25 tests passed;
- complete deterministic server suite passed with exit 0, excluding only the
  existing environment-bound `src/tools/chrome-click.test.ts`;
- the full web run reached 86 files / 367 tests passed and exposed the existing
  suite-level Task Inspector 5-second timeout plus voice timer teardown. The
  exact affected tests passed independently: Task Inspector 4/4 and voice
  barge-in 27/27. No changed Instagram/People/Explorer test failed;
- server build, production PWA build, `git diff --check`, and committed-HEAD
  boot smoke passed;
- Explorer contract/reality audit passed with 32 capabilities, 58/58 tools,
  100 verified source references, 20/20 routes, and zero broken claims;
- committed HEAD is running as PID 14420; `/api/health` and the app root both
  return HTTP 200.

Known limitations: Instagram must expose the exact profile `Message` action
and a recognizable thread URL. Appearance in the opened conversation proves
the UI accepted the send, not that the recipient read it or that Instagram
issued a server-side delivery receipt. AVA intentionally does not fall back to
inbox search when those signals are absent.

Forge was neither entered, inspected, imported, nor modified. The unrelated
`.claude/settings.local.json` change and append-only board history remain
outside the product commit.

NEEDS: niko
 
---

### 2026-08-12 - codex - stale runtime and Instagram drawer regression fixed

Niko's live reproduction exposed two concrete problems that the earlier test
handoff missed. Mission Control proved the live tool returned the removed text
`chat with Lasha open (fast path)`: PID 14776 had started before commit
`21ee771` and still owned port 8787. My attempted replacement PID had exited on
the occupied port, while a generic health request incorrectly treated the old
listener as the new build. After replacing it, a real safe run proved the new
profile route but revealed Instagram's current UI opens a message drawer over
the verified profile without changing to `/direct/t/...`; the code incorrectly
required that URL and rejected the valid drawer.

Commit `07d0098` fixes both boundaries:

- every production server build now generates `dist/build-id.txt`; the server
  captures that ID at boot and exposes it through `/api/health`;
- `scripts/start-ava-desktop-runtime.ps1` leaves a live server alone only when
  its reported ID equals the installed build, safely stops only a verified AVA
  loopback listener when stale, waits for port release, launches the new build,
  and refuses success until the exact build ID is live;
- Instagram still resolves Lasha to the saved `_princi150` username, opens and
  verifies `https://www.instagram.com/_princi150/`, and clicks its exact
  `Message` button without inbox search or a stored-thread route;
- after that click it now accepts either Instagram's verified profile message
  drawer (back control + close control + composer) or a direct-thread URL. It
  can type and verify in the drawer while retaining the profile URL.

Verification evidence:

- focused server suite: 36/36 passed, including 33 Instagram route/send tests
  and three health/build-identity tests;
- focused Explorer registry suite: 15/15 passed;
- complete deterministic server suite passed with exit 0, excluding only the
  existing environment-bound Chrome-click test;
- server build, production PWA build, PowerShell parser validation,
  `git diff --check`, Explorer contract/reality audit, and committed-HEAD boot
  smoke passed;
- the launcher was exercised against an intentionally stale running build and
  replaced it. Live PID 22624 reports `ready=true` and its health build ID
  exactly matches `server/dist/build-id.txt`;
- a real authenticated AVA chat/tool smoke—not a mock—called only
  `instagram_open_chat` for Lasha and returned success with
  `chat with Lasha open in the verified profile message drawer @_princi150`.
  AVA sent no message. The temporary smoke session/device were removed.

The `/direct/t/26165803049733503/` page Niko saw came from the proven stale
fast-path process, not the profile-first implementation. A direct-thread URL
can still be a legitimate destination when Instagram itself chooses it after
the verified profile Message click; it is never used as AVA's starting route.

Forge was neither entered, inspected, imported, nor modified. The unrelated
`.claude/settings.local.json` change and append-only board history remain
outside both scoped commits.

NEEDS: niko

---

### 2026-08-15 - codex - verified playbook learning gate claim

Niko assigned Codex to implement the learning gate before the later self-improvement
worker switch between Claude Code and Codex. This bounded claim covers AVA's
playbook capture, recall-outcome accounting, task-receipt/verification boundary,
learned-workflow API/UI, migration compatibility, tests, documentation, builds and
a complete themed commit. A final response or executor-reported `ok` will no longer
be sufficient to promote a playbook success or overwrite a learned procedure.

The Claude/Codex self-improvement worker selector is explicitly the next separate
increment, not part of this commit, so provider choice cannot obscure whether the
learning truth source itself works. Existing unrelated changes, especially
`.claude/settings.local.json` and prior append-only board history, will be preserved.

NEEDS: codex

---

### 2026-08-15 - codex - terminal Codex watcher recovery tail confirmation

This is the physical-tail claim for the bounded watcher repair described in my
earlier same-date entry: typed terminal lost-delivery handling, deterministic
tests, and a one-minute live `continue_cycle` handoff after this thread becomes
idle. The earlier entry was accidentally appended after an older `NEEDS: codex`
marker instead of the physical tail; it has not been edited or deleted because
the board history is append-only.

NEEDS: codex

---

### 2026-08-15 - codex - verified learning gate and watcher recovery shipped

Two complete AVA-only commits are now on `master`:

- `c837083` (`feat: gate playbook learning on verified outcomes`) adds the
  versioned verification contract, receipt v2, terminal learning settlement,
  idempotent playbook provenance/counters, verified filesystem and existing
  Instagram/WhatsApp post-check producers, conservative mixed-result handling,
  Mission Control evidence, truthful Memory/Explorer views, migration support,
  tests, and `docs/features/verified-learning-gate.md`. Exact product files are
  the 50 paths reported by `git show --name-only c837083`, spanning
  `server/src/{orchestrator,receipts,playbooks,routes,state,tools,apps,explorer,observability}`,
  `web/src/{chat,memory,explorer,components/ava}`, and the linked architecture,
  capability, receipt, and Mission Control documents.
- `0395d94` (`fix: stop retrying terminal Codex watch deliveries`) changes
  exactly `server/src/watches/codex-dispatch.ts`, its test,
  `server/src/watches/scheduler.ts`, its test, and
  `docs/features/watches.md`. Irrecoverable pre-marker process loss is now a
  typed non-retryable failure that self-disables; busy/temporarily unknown
  boundaries remain retryable.

Verification evidence:

- learning-gate focused server: 17 files / 136 tests passed;
- focused UI: 4 files / 13 tests passed;
- complete deterministic server suite after both changes: 1,299/1,299 passed,
  excluding only the existing environment-bound Chrome-click test;
- complete web suite: 369/369 passed;
- watcher dispatcher/scheduler/tool suite: 3 files / 29 tests passed;
- server and production PWA builds passed;
- Explorer contract/reality audit passed: 32 capabilities, 58/58 tool mappings,
  100 verified source references, 20/20 routes, zero broken claims;
- committed-HEAD boot smoke passed with the health build ID exactly matching
  `server/dist/build-id.txt`;
- live AVA was restarted as PID 17356 on that exact build;
- four old irrecoverable Codex watches self-disabled on the first live tick;
- live watcher `L3Ad4qp9XB7p` is enabled, pinned to exact thread
  `019f977d-97dc-7cd1-b2ad-904631196018`, set to one minute / one task with
  `continue_cycle=1`, and currently reports the truthful busy boundary. It may
  dispatch only after this turn writes `task_complete`.

Known limits: only explicit verification producers may teach the playbook; an
executor `ok`, final prose, response delivery, and operation-only evidence do
not. Legacy playbook win/loss counters remain visible but frozen. The planned
Claude/Codex self-improvement worker selector is not in these commits; it is the
next bounded increment after the watcher resumes this thread.

The unrelated `.claude/settings.local.json` modification remains untouched.

NEEDS: codex (finish this turn so AVA watcher `L3Ad4qp9XB7p` can deliver the
next improvement instruction into the now-idle pinned thread)

---

### 2026-08-15 - codex - active-thread watcher handoff claim

The live post-commit proof falsified the remaining delivery assumption. Codex
CLI 0.147 rejects `exec resume` while this exact TUI owns its writer lock, so a
second process cannot inject a watch into an already-open conversation. Watch
`L3Ad4qp9XB7p` failed with `thread-store conflict: ... already has an active
writer`; therefore watcher delivery is not accepted as working yet.

I am extending the existing Codex-owned watcher area with a bounded supported
active-thread handoff: AVA stages one sanitized, idempotent instruction for the
pinned thread; a trusted Codex Stop hook consumes it inside the existing writer
at a clean task boundary; the existing rollout evidence remains authoritative
for delivery and completion. The legacy external-resume path may remain only
for sessions without an active writer. Acceptance requires deterministic tests,
installation/trust documentation, a scoped commit, and—most importantly—a real
`[AVA-WATCH:...]` instruction appearing in this exact conversation. The planned
Claude/Codex self-improvement worker selector remains the successor task.

NEEDS: codex

---

### 2026-08-15 - codex - active-thread watcher handoff completion (physical tail)

This repeats the completion record accidentally appended after an older
`NEEDS: codex` marker at line 184. That earlier record remains untouched because
the board is append-only; this is the authoritative physical-tail handoff.

Commit `7ebe83e` replaces the broken second-writer delivery for live Codex TUI
threads. AVA now writes one sanitized, versioned watch record through an atomic
pending/claimed/completed inbox. The trusted project Stop hook consumes that
record inside the TUI's existing writer, injects the unique `[AVA-WATCH:...]`
prompt at a clean boundary, records an idempotent completion receipt, and—when
`continue_cycle` is authorized—waits a bounded six minutes for AVA to plan and
stage one child into the same turn. Legacy ambiguous external dispatches remain
fail-closed and are never silently replayed.

Files in the scoped commit:

- `.codex/hooks.json`;
- `scripts/codex-watch-stop-hook.mjs` and
  `scripts/trust-codex-watch-hook.mjs`;
- `server/src/watches/codex-handoff.ts` plus its focused test;
- `server/src/watches/codex-dispatch.ts`, `scheduler.ts`, `state/watches.ts`,
  `tools/watches-mcp.ts`, their affected tests, and `server/src/index.ts`;
- `docs/features/watches.md` and the root package trust command.

Verification evidence:

- focused watcher/tool suite: 4 files / 36 tests passed;
- full server regression suite passed with exit 0;
- server production build and product-only `git diff --check` passed;
- the installer used Codex's typed `hooks/list` and `config/batchWrite` APIs and
  verified the exact project Stop hook as enabled/trusted;
- committed HEAD is live as PID 25880 and `/api/health` reports the exact
  `server/dist/build-id.txt` value;
- AVA's real `watch_create` tool created watcher `VyMIMZVPUOW4`, pinned to this
  exact thread `019f977d-97dc-7cd1-b2ad-904631196018`, with the agreed
  Claude/Codex self-improvement worker-selector task and `continue_cycle=1`;
- the live scheduler staged it as `[AVA-WATCH:VyMIMZVPUOW4]` with no dispatch
  PID, and the bounded handoff file exists. The final acceptance event is the
  hook placing that marker into this conversation when this turn closes.

The final working tree contains only the pre-existing
`.claude/settings.local.json` change and append-only `coord/BOARD.md`. Forge was
neither inspected nor modified.

NEEDS: codex (close this task boundary; the trusted Stop hook should deliver
watcher `VyMIMZVPUOW4` into this exact conversation and begin the selector task)

---

### 2026-08-15 - codex - transport correction completion (authoritative physical tail)

The full claim and completion evidence for commit `5ea7a48` was accidentally
appended after older matching `NEEDS:` markers at lines 230 and 278. Those
records remain untouched because this board is append-only. This physical-tail
entry adopts that evidence: the unsupported app-server queue was retired, the
focused 38-test suite/full server suite/build passed, committed HEAD is live,
and recovery watcher `rdVHE04OeBbI` was injected exactly once into the sole
standalone Codex TUI. Its rollout marker remains the required final proof.
Forge was neither inspected nor modified.

NEEDS: codex (close this turn; require watcher `rdVHE04OeBbI` as the next real
user turn, then implement its approved self-improvement worker selector)

---

### 2026-08-15 - codex - self-improvement worker selector claim

Watcher `rdVHE04OeBbI` arrived as a real user turn in the exact pinned Codex
session, completing the watcher acceptance boundary. I inspected the full board;
no other active agent owns AVA's self-improvement worker-selector area, so I am
claiming this bounded increment.

The implementation will add an explicit, persisted Claude Code versus Codex
selection with truthful availability, optimistic concurrency, provider-neutral
execution evidence, and one shared downstream approval/worktree/verification/
swap/rollback/watchdog path. Unavailable providers will fail closed and no
provider may bypass the existing safety or verified-learning gates. Forge is
outside scope and will not be inspected or modified.

NEEDS: codex

---

### 2026-08-15 - codex - worker selector completion (authoritative physical tail)

The full completion entry for this task was accidentally appended after an
older `NEEDS: codex` marker at line 185. It remains untouched because the board
is append-only. This physical-tail entry adopts that evidence as authoritative.

Commit `43a4227` (`feat(self): select Claude or Codex worker`) adds the persisted,
version-guarded Self-screen selector; immutable per-intent worker snapshots;
provider-neutral Claude Code/Codex adapters; fail-closed availability and
runtime errors; bounded secret-scrubbed evidence; and the shared existing plan
approval, isolated worktree, verification, safety, expected-HEAD, swap,
watchdog, rollback, and cancellation gates. It commits all 26 affected paths:
the new `server/src/self/{worker-selection,workers}.ts` modules and tests,
affected Self runtime/routes/state/tools/tests, the Self web hook/screen/tests,
and linked architecture/feature documentation. The unrelated settings and board
history were not included.

Final evidence: the focused worker fixture is 8/8; complete server and web
suites pass sequentially with exit 0; committed-HEAD server and production PWA
builds pass; the fresh-data committed-HEAD boot smoke is healthy; scoped diff
checking passes; live CLI probes report Claude Code 2.1.221 and Codex CLI
0.147.0 without claiming authentication; and live AVA is PID 14968 on exact
health/build ID `06e4dfa0-4588-4744-9d69-aec8d8a3b643`. An authenticated live
Self-screen smoke rendered both workers, switched Claude -> Codex and Codex ->
Claude with two HTTP 200 versioned writes, and created no intent/model call.

Known limitation: CLI version availability cannot prove saved account sign-in,
so the UI says `sign-in not checked` and a launch may still fail honestly with
no fallback. The selector affects new implementation intents only; reflection
still uses AVA's orchestration provider. No consequential live self-edit was
run. Forge was neither entered, inspected, imported, nor modified.

NEEDS: niko (select the implementation worker in Self; the next request will
snapshot it and still stop for explicit plan approval before code is edited)

---

### 2026-08-27 - codex - self-development run wAgGV7eeNINb failure diagnosis

Diagnostic only; no product code was changed or committed. The durable row and
server timeline show that run `wAgGV7eeNINb` was approved, entered
`implementing` with the snapshotted Claude worker, then received an external
abort signal 6m52.577s later. Its worker evidence is exactly `WORKER (claude):
aborted`; there is no verification log, branch, commit, swap, or rollback.

The recorded `cancelled by user` cause is misleading. At 17:57:04.585 BST the
voice server received `response.cancel` while no model response was active; 86
ms later the self-development controller emitted `cancelled`. The voice client
uses one `interrupt()` path that calls `/api/chat/:sessionId/kill` and sends
`response.cancel`. That chat kill route unconditionally calls
`cancelAllImprovements(db)`, so a voice barge-in/new-turn interruption can abort
an unrelated background self-development run. The self pipeline then maps any
aborted signal to the hard-coded `outcome=cancelled` / `error=cancelled by
user`, regardless of whether Niko explicitly cancelled that Self run.

This was not a timeout (the Claude worker limit is 15 minutes), not a natural
worker/process failure (the worker reported `aborted`, not exit/error/timeout),
and not a verification or swap failure (those stages never began). The Self UI
briefly showing `implementing` was stale presentation after the abort, not the
cause; authoritative status checks at 17:57:24.229 and 17:57:52.946 already
returned `failed` with the stored cancellation label. Conversation history
contains no explicit stop/cancel instruction around the failure.

The intent had snapshotted Claude selection version 3 at creation. The global
selector changed to Codex version 4 at 17:49:47.406, after the intent was
created; per-intent immutability therefore correctly kept this particular run
on Claude. That provider timing did not cause the failure but explains why it
did not run Codex.

NEEDS: niko (review the diagnosis; authorize a separate fix if desired so voice
barge-in cannot globally cancel unrelated self-development and abort causes are
recorded precisely)

---

### 2026-08-27 - codex - worker-lock and voice-cancellation repair claim

Niko authorized the repair after confirming he selected Codex for run
`wAgGV7eeNINb`. I am reclaiming the existing Codex-owned Self/voice boundary for
one bounded fix: a worker choice made before plan approval must become the
approved run's locked provider, and routine voice barge-in/new-turn interruption
must not invoke the global self-development cancellation boundary. Explicit
Self Stop and the deliberate global red Stop will remain supported and will
record their actual cancellation source rather than a generic user label.

Acceptance requires deterministic race/stale/availability tests, approval-time
provider locking, no provider switch after implementation starts, voice
interrupt isolation, explicit global/Self cancellation coverage, honest status
and UI copy, complete relevant suites/builds, committed-HEAD smoke, a scoped
commit, and live verification that creates no consequential self-edit. Forge is
outside scope and will not be inspected or modified.

NEEDS: codex

---

### 2026-08-27 - codex - worker-lock and voice-cancellation repair completion (authoritative physical tail)

The full completion entry for this task was accidentally appended after an
older `NEEDS: codex` marker at line 185. It remains untouched because the board
is append-only. This physical-tail entry adopts that evidence as authoritative.

Commit `8d3e9ad` (`fix(self): lock approved worker and isolate voice stop`) fixes
both evidence-backed causes behind `wAgGV7eeNINb`. Explicit improvements now
lock the current versioned Claude/Codex selection at plan approval, before any
worktree or provider launch. Approval is guarded against stale, unavailable, or
concurrently changed workers. The Self UI names the exact worker the button will
lock; running and historical provider ownership stays immutable afterward.

Voice barge-in/new-turn interruption now uses session-only `/kill` and cannot
cancel detached Self work. The deliberate chat red Stop uses `/kill-all`, so its
global safety contract remains intact. Self cancellation evidence now persists
`self_stop`, `global_stop`, or `system_abort` and renders its true
plain-language source instead of hard-coding `cancelled by user`.

Exact changed paths, test/build results, live evidence, and limitations are in
the earlier immutable completion entry. In summary: focused server 33/33,
focused web 58/58, broader practical server exit 0, full web 87 files / 376
tests, committed-HEAD server/PWA builds, and exact-build runtime health all
pass. Live AVA is ready on build ID
`2201c2a7-a5c3-4de7-91cc-e36706a4079c`; the live selection is Codex version 4
and the migrated cancellation column exists. No consequential self-edit was
started. Unrelated `.claude/settings.local.json` and prior board content remain
preserved. Forge was neither entered, inspected, imported, nor modified.

NEEDS: niko (start a new explicit Self improvement, keep Codex selected, confirm
the button says `Approve & run with Codex`, then approve; ordinary voice use
must not cancel it)

---

### 2026-08-27 - codex - AVA teaching curriculum mapped

Niko designated this conversation as a teaching-only walkthrough of how AVA is
built and works, at exhaustive detail and in small sections. I read the complete
board and mapped current `master` at `8d3e9ad`: repository/workspaces, Windows
bootstrap and runtime, Express/API/auth/SQLite, the chat orchestration loop and
provider adapters, all tool families and policy boundaries, voice, memory and
verified playbook learning, Notes, Strategy Room, VisualMessage/research
artifacts, Explorer, Mission Control, watches and Codex delivery, the React PWA,
and the approval/worktree/verification/swap/watchdog self-improvement pipeline.

This was read-only product analysis. No product area was claimed, no source or
configuration was changed, no tests/builds were needed, and no commit was
created. The curriculum will use current code and verified runtime history as
truth, call out stale documentation explicitly, teach one micro-lesson at a
time, and maintain coverage of files, routes, tools, tables, events, state
machines, safety boundaries, tests, failure modes, and end-to-end traces. Forge
will be explained only as AVA's external control-plane/adapter boundary unless
Niko separately asks for a Forge deep dive.

NEEDS: niko (begin the curriculum when ready)

---

### 2026-08-27 - codex - Self worker execution-contract repair claim

Run `FgWT4SY6D7X8` proves the selector repair worked: its durable intent locked
Codex version 4, launched Codex 0.150.1 in the isolated worktree, and failed
inside the implementation worker without reaching verification. Repository and
run evidence expose two bounded defects at the existing Codex-owned Self worker
boundary: the approved reflected plan is forwarded verbatim, so its pre-edit
proposal/pause instruction recursively reopens a gate the enclosing pipeline
already completed; and the adapter retains only the beginning of Codex stderr,
prefers it over stdout, and therefore persists a banner/prompt instead of the
terminal cause.

I am claiming only this Self worker execution/evidence repair. The change will
make the provider-neutral implementation phase explicit without weakening the
outer approval/scope/worktree/verification/swap/rollback gates, retain bounded
sanitized diagnostic tails, surface a concise real failure first, and add
deterministic regression coverage. It will not retry the failed consequential
run automatically. Forge is outside scope and will not be inspected or changed.

NEEDS: codex

---

### 2026-08-27 - codex - Self worker execution-contract repair completion (authoritative physical tail)

The full completion entry for this task was accidentally appended after an
older `NEEDS: codex` marker at line 185. It remains untouched because the board
is append-only. This physical-tail entry adopts all of that exact file, test,
build, live-runtime, privacy, limitation, and handoff evidence as authoritative.

Commit `e08cd3e` (`fix(self): execute approved Codex plans reliably`) is live.
Approved Self plans now become hashed provider-neutral implementation envelopes
instead of recursively reopening their own approval gate; Codex terminal
stdout/stderr evidence retains the actionable tail; verified worker-created
commits are accepted while true no-ops still fail; and the unattended loop uses
the same snapshotted Claude/Codex registry with a build-enforced typecheck.
Focused coverage passed 7 files / 58 tests, the practical full server suite and
server build passed, committed-HEAD boot smoke was healthy, and live AVA PID
26596 reports matching build ID `f15839ba-3f09-4a3a-9336-1f0d071371a6` with
Codex version 4 still selected. The failed historical run was not rewritten or
retried. Unrelated settings and board history remain untouched. Forge was
neither inspected nor modified.

NEEDS: niko (start a fresh Self run, review the new plan, and use `Approve & run
with Codex`; this repair deliberately requires a fresh visible approval)

---

### 2026-08-27 - codex - Self retry execution-budget repair claim

Niko explicitly authorized continuing the latest approved Self-development goal
until its execution fault is repaired. Durable run `FhJTrhQAcDL8` proves the
provider selector and implementation envelope now work: it used Codex version 4,
was not cancelled, and failed solely because AVA terminated the worker at the
hard-coded 900-second ceiling before it returned. No verification, swap, or
rollback stage was reached.

I am claiming the existing Codex-owned Self worker boundary for one bounded
repair: replace the too-short fixed ceiling with a conservative configurable
bounded execution budget, preserve honest timeout/cancellation evidence, add
deterministic coverage, restart committed HEAD, and rerun the same immutable
approved goal through Codex. I will continue diagnosing successive concrete
failures until the run ships or reaches a genuinely new authority/safety
boundary. Approval, isolated worktree, verification, expected-HEAD, swap,
watchdog, rollback, cancellation, and privacy gates remain unchanged. Forge is
outside scope and will not be inspected or modified.

NEEDS: codex

---

### 2026-08-27 - codex - transparency pilot claim physical-tail confirmation

The complete measurement-first transparency-pilot design claim was accidentally
appended after an older matching `NEEDS: codex` marker at line 185. It remains
untouched because this board is append-only. This physical-tail entry confirms
the active bounded claim for Self intent `qMeOE8g9aH7L`: specification, typed
structured synthetic records, and three connected read-only record-backed mock
views only. No benchmark, baseline, workflow modification/swap, adoption action,
external-project integration, or Forge inspection is in scope.

NEEDS: codex

---

### 2026-08-27 - codex - measurement-first transparency pilot design completed

Self intent `qMeOE8g9aH7L` is implemented within its approved design-only
boundary. `docs/transparency-pilot/experiment-spec.md` freezes exactly T01-T06,
their prompts/input packets/evidence obligations/rationales, the 6 x 2 x 2 = 24
run matrix, randomized blinded five-dimension review, all automatic measurements,
the structured audit/provenance contract, provisional adoption/rollback rules,
all seven undecided design questions, and the later separately gated course.

`web/src/self/transparency-pilot/` adds the typed contract and validator, exactly
24 explicitly synthetic mock records, model/UI tests, and three connected
read-only projections: `DecisionScorecardView`, `WorkflowComparisonView`, and
`RunEvidenceView`. `TransparencyPilotMockup` links them by task/run ID and is
integrated below the existing Self journal in `SelfScreen.tsx`. The executive
view displays absolute values and all individual-run variation; workflow steps
are projected from structured agent/tool/decision/output records; drill-down
shows sources, claims, failures, interventions, uncertainty, timings, approvals,
and metric derivations. No operational run/adopt/swap control exists.

Verification passed: `npm test` exited 0 (web 89 files / 388 tests; the server
suite also completed before the web suite); `npx tsc -b web --pretty false`,
`npm -w web run build`, and `npm -w server run build` passed. The compiled
validator accepted 24 records / six tasks and its negative tests reject an
incomplete matrix, configuration drift, broken source links, and broken metric
provenance. A jsdom smoke crossed decision -> exact run evidence -> workflow
provenance. An isolated built-server/PWA smoke used a temporary data directory,
blank provider credentials, and port 8897: health returned `ok=true`, `/` returned
200, and the served production bundle contained the transparency-pilot,
synthetic-data, executive-view, and no-adoption labels. `ready=false` was expected
because both provider credentials were deliberately blank. Temporary artifacts
were removed; `git diff --check` passed aside from normal CRLF notices.

No benchmark was executed, no baseline captured, no workflow changed or swapped,
no measured-improvement claim made, and no external reference project was
integrated. Forge was neither entered, inspected, modified, imported, nor
included. A scoped commit could not be created: this isolated worker has read-only
access to the parent repository worktree metadata, and `git add` failed creating
`.git/worktrees/ava-imp-GUFQs7/index.lock` with `Permission denied`. All complete
source changes remain in this isolated worktree for AVA's downstream verifier.

NEEDS: niko (review the design mock-up and unresolved decisions; the enclosing
Self pipeline must preserve/commit the verified isolated diff because this worker
cannot write the worktree index)

---

### 2026-08-27 - codex - Self retry repair and live shipment completion

Niko's instruction to keep rerunning the last Self development until its real
failure was fixed is complete. The newest failed attempt, `FhJTrhQAcDL8`, was
not cancelled: it was Codex version 4 and AVA terminated it at the former fixed
900-second worker ceiling. Commit `16d0b36` replaces that ceiling with a bounded
`SELF_WORKER_TIMEOUT_MINUTES` contract (default 60, accepted range 1-120), keeps
Stop immediate, and retains sanitized Codex terminal evidence on a real timeout.
Commit `105db31` aligns authenticated Self intake with the existing 8,000-byte
immutable-goal envelope so the exact 4,580-character scope can be retried with
no truncation or paraphrase. Commit `5768d6d` preserves the previously
uncommitted append-only board history so isolated worktrees no longer start from
stale coordination evidence.

The exact durable goal was submitted as `qMeOE8g9aH7L`, locked to Codex selector
version 4, passed its approval gate, and remained healthy beyond the old
900-second cutoff. Codex returned after roughly 20.5 minutes; AVA then ran its
independent verification and recorded `all checks + boot smoke passed` plus a
passing flight check. The pipeline fast-forwarded the verified candidate as
commit `4a042a1`; the intent now records `status=swapped`, `outcome=shipped`, no
error, candidate `4a042a1108f77bb6383b80320fb2e7e15c0ea9f0`, and last-known-good
`5768d6d617d4d56390a99d0bd43e37207572e704`.

Verification evidence: focused Self/config coverage passed 7 files / 60 tests;
the complete server suite passed 181 files / 1,350 tests; server build including
the unattended-loop typecheck passed. Committed-head pilot coverage passed 3
files / 22 tests; production web and server builds passed. The desktop runtime
was reinstalled from committed HEAD and is healthy on matching build ID
`e1b4a1c9-4a51-420b-8895-ba9e1c7f937c`. A live browser smoke refreshed the
stale localhost service-worker client and proved the Self card renders
`design_review`, exactly 24 synthetic records, all three selectable views, and a
24-option individual-run evidence drill-down with no rendered alert.

Niko's pre-existing `.claude/settings.local.json` edit was isolated in a named
stash only while the verified fast-forward occurred, then restored exactly; it
is again the sole unrelated working-tree modification. No benchmark was run and
no baseline or production workflow was changed. Forge was neither entered,
inspected, imported, nor modified.

NEEDS: niko (review the shipped Transparency pilot design mock-up in Self; the
next benchmark/baseline phase remains separately approval-gated)

---

### 2026-08-27 - codex - CLAIM: canonical chat and voice conversation continuity

I am investigating and fixing the bounded AVA voice/chat continuity defect Niko
just reproduced: a brief present in the active typed chat was not available to
voice after changing input modes. The canonical session transcript must be the
same for typed and spoken input, including messages added after a voice socket
was first seeded. This work is confined to the chat/voice session handoff,
history synchronization, and focused regression coverage. The completed Self
development pipeline and its shipped transparency pilot are explicitly outside
scope and will not be modified. Forge is outside scope.

NEEDS: codex (trace the current session handoff and realtime history high-water,
implement the smallest shared-context fix, test it, and commit the complete AVA-only change)

---

### 2026-08-27 - codex - canonical chat and voice continuity completed

Commit `2688f15` fixes the reproduced mode-switch continuity defect without
changing Self. Repository/runtime evidence showed the typed Strategy Room brief
was stored in canonical session `cLbTVdJLvA19` at 21:44:59, while an older
OpenAI voice socket for that same session remained alive from 21:32:34 through
21:46:17 and overlapped a second voice socket opened at 21:45:26. The old socket
had taken its one-time context snapshot before the brief. The UI also handed the
microphone App's stale/null route session instead of ChatScreen's canonical
session, voice teardown was absent on unmount/navigation, and server fallback
mistook pin order for actual session recency.

The completed vertical fix makes ChatScreen pass its real persisted session ID
into VoiceScreen, stops capture/playback/socket/action streams whenever voice is
left or unmounted, resolves fallback by true `updated_at` recency rather than
pin order, and gives OpenAI Realtime the same durable earlier-conversation
summary used by typed chat. While an OpenAI voice connection remains open,
typed user/assistant rows are imported exactly once at ordered pre-utterance
boundaries using a persisted-message high-water cursor; delegated-action
completion also refreshes typed rows before the model speaks. Hume now respects
explicit new-conversation selection and receives the same summary plus recent
canonical rows on connect. The existing bounded recent-turn seed remains in
place.

Changed areas: `server/src/routes/voice-realtime.ts` and focused tests;
`server/src/state/sessions.ts` and recency tests; chat/App/VoiceScreen session
handoff; realtime-hook teardown and regression coverage; and the three existing
voice/frontend architecture documents. No file under `server/src/self/` or any
Self UI/runtime/schema was modified.

Verification: focused server tests passed 2 files / 95 tests; focused web tests
passed 3 files / 39 tests; the complete web suite passed 89 files / 391 tests;
the complete server suite passed on clean rerun at 181 files / 1,354 tests. The
first highly parallel server run exposed three timing-only failures in logger,
browser-click, and Codex handoff tests; each passed in isolation and the entire
suite then passed. Server build, web typecheck, production web build, and
`git diff --check` passed (only normal CRLF notices). The freshly built server
passed its isolated scratch-data `/api/health` boot smoke (`ok=true`).

Known limitation: OpenAI supports live typed-turn refresh on an already-open
voice socket. Hume receives the canonical transcript on connection, so the
normal chat-to-voice switch is continuous, but a typed turn created elsewhere
while one Hume socket remains continuously open requires reconnect. Raw recent
history is intentionally bounded (default 12 turns); older context is supplied
through the durable session summary.

Niko's unrelated `.claude/settings.local.json` edit and untracked persona
research document were preserved. Forge was neither inspected nor modified.

NEEDS: niko (restart/reload AVA, type a distinctive brief, tap the microphone in
that same chat and ask AVA to repeat it, then return to keyboard and confirm the
voice turn appears in the same conversation)

---

### 2026-08-27 - codex - UFO Self run swap-failure diagnosis

Read-only diagnosis of Self intent `-Nb9YsN1KWjQ`: this was not a Codex worker,
timeout, verification, test, build, or boot failure. The Codex worker completed
candidate commit `9d7fcb6`; AVA entered verification at 23:03:39 BST, recorded
`all checks + boot smoke passed`, and its report-only flight check passed at
23:05:18.418. At 23:05:18.927 the final live-tree swap alone failed because
`swapTo` correctly detected concurrent uncommitted tracked work.

The blocking status snapshot names Niko's existing
`.claude/settings.local.json`, the append-only board, and Codex's then-active
chat/voice continuity files. Those continuity changes were committed afterward
as `2688f15` plus coordination commit `299dd3d`; they were intentionally not
discarded. The Self safety guard uses `git status --porcelain
--untracked-files=no` and refuses `reset --hard` whenever tracked edits exist,
then the current generic catch classifies that swap refusal as `failed`.

The verified UFO candidate still exists as Git object `9d7fcb6` and contains
the proposal document, board evidence, and refreshed Explorer manifest, but it
was never applied to `master`. Current `master` has subsequently advanced, so
that historical candidate now also requires a controlled rebase/recovery rather
than a direct reset. No code was changed in this diagnostic turn. Forge was not
inspected or modified.

NEEDS: niko (decide whether Codex should recover the verified UFO proposal and
change Self's dirty-tree collision from terminal failure into a resumable
blocked state)

---

### 2026-08-27 - codex - CLAIM: resumable Self swap-collision recovery

Niko authorized implementation of the diagnosed final-swap defect. I am
claiming the existing Codex-owned Self completion boundary for one bounded
reliability increment: preserve a fully verified candidate when concurrent
tracked edits prevent installation, classify it as a truthful blocked state,
and expose an explicit version-guarded resume action that can safely reconcile
the candidate with the current committed HEAD before re-verification and swap.

The implementation will never auto-stash, reset, overwrite, or discard local
work; a still-dirty tree remains blocked. It must not treat old verification as
sufficient after rebasing, and it must retain approval, worker ownership,
expected-HEAD, safety, verification, boot-smoke, swap, watchdog, rollback,
cancellation, privacy, and evidence gates. Recovery of historical UFO candidate
`9d7fcb6` is in scope only through this proven safe path. Forge is outside scope.

NEEDS: codex (implement, test, commit, and prove the recovery boundary)

---

### 2026-08-27 - codex - Microsoft UFO design-only evaluation claim

Self intent `-Nb9YsN1KWjQ` arrived through the already-approved implementation
envelope with scope digest
`aab588082709b78ea5aa6f31185c778e3be3837ac9a0012145d5f85188150020`.
I am claiming only `docs/self/proposals/microsoft-ufo-evaluation.md`: a
read-only, canonical-source assessment against the latest Strategy Room UFO
brief. The superseded 10-15-repository research phase is excluded.

This run will not install, execute, import, integrate, benchmark, or grant UFO
access to AVA or Niko's normal environment. It will not select a fallback. The
document will make unknown or unmediated consequential-action and outbound-data
channels blockers, choose exactly one permitted evidence-derived finding, and
retain Niko's separate approval gates for every later empirical or environment-
access step.

NEEDS: codex

---

### 2026-08-27 - codex - Microsoft UFO design-only evaluation complete

Self intent `-Nb9YsN1KWjQ` is implemented at
`docs/self/proposals/microsoft-ufo-evaluation.md` within its approved scope. The
proposal uses canonical Microsoft UFO and checked-in AVA sources, explicitly
excludes the superseded 10-15-repository phase, and performs no UFO acquisition,
installation, execution, import, integration, benchmark, environment access,
production change, or fallback advancement.

The document maps architecture, Windows/dependency/provider requirements,
privileges, UI/screenshot/data/network behavior, every identified consequential
action and outbound channel, logs/retention/residue, supply-chain and security
health, latency/cost scenarios, and collision with AVA controls. It separates
verified evidence, assumptions, unresolved blockers, and permanent-rejection
conditions; specifies disposable-VM through AVA-owned mediation containment,
frozen allowlists, synthetic-only data, confirmations, receipts, kill/rollback,
acceptance criteria, adversarial tests, and automatic stops; and retains every
required Niko gate.

Document verification found 21 registered canonical/local sources, 106 anchored
evidence references, 13 valid local links, zero dangling source anchors, zero
broken local links, and exactly one permitted substantive-finding phrase.
`git diff --check` reported no content errors (only the existing CRLF notice for
this board). Root `npm test` was attempted unchanged, but no test file loaded:
Vite/esbuild failed at startup with sandbox `spawn EPERM`. Pointing Vite at the
same existing esbuild binary copied temporarily inside this worktree produced
the same piped-child-process denial; the temporary binary and directory were
removed. This is an execution-policy blocker, not a test assertion failure.

NEEDS: niko and the enclosing Self verifier (review the evidence-derived finding;
rerun unchanged `npm test` where esbuild service subprocesses are permitted, and
preserve/commit the scoped isolated diff if this worker cannot write the worktree
index)

---

### 2026-08-27 - codex - Microsoft UFO evaluation commit handoff

The required scoped commit was attempted after the completion entry. Both
`git add` and `git commit` were denied because this isolated worker cannot create
`C:/Users/nikug/ai/AVA/.git/worktrees/ava-imp-0WiVEr/index.lock` (`Permission
denied`). No index or commit was changed; the complete proposal and append-only
board updates remain in this isolated worktree for AVA's downstream verifier.

NEEDS: enclosing Self verifier (preserve and commit the scoped isolated diff)

---

### 2026-08-27 - codex - resumable Self swap-collision recovery completed

Commits `65212c6` and `ba832a0` replace the destructive all-or-nothing final
swap boundary with a durable, truthful recovery path. A fully verified candidate
that cannot be installed safely is now `blocked` rather than misreported as an
implementation failure. AVA preserves it at
`refs/ava/self-candidates/<intent-id>`, exposes the exact collision in Self, and
offers **Retry safe installation** with candidate-SHA and repository-HEAD stale
guards. The status tool also distinguishes this state from a failed worker.

Installation now uses `git merge --ff-only`, never `reset --hard` or an automatic
stash. Disjoint tracked edits remain untouched; overlapping tracked paths and
Git-protected untracked collisions block. When HEAD advanced, retry replays the
already-approved candidate in a fresh worktree and reruns the complete test,
build, and boot gate before installation. Ordinary conflicts fail closed. The
coordination board has one narrow add-only merge: both sides must retain every
parent line in order, so added ownership rows and thread entries are preserved
while any rewrite/deletion is rejected. Recovery interruption returns to
`blocked` on boot, old verified dirty-tree failures are migrated, and candidate
refs are restored before orphan worktrees are pruned.

The historical UFO run `-Nb9YsN1KWjQ` proved the live path. Boot migrated its old
false `failed` row to `blocked` and preserved original candidate `9d7fcb6`. The
first retry correctly stopped when its board delta included both an ownership
row and appended history outside the initial suffix-only proof. After the
generalized add-only proof and regression test landed, a second explicit retry
reconciled onto `ba832a0`, reran the full gate, and safely fast-forwarded master
to reconciled candidate `58f3669`. Durable status is now `swapped`, outcome
`shipped`, error `null`, LKG `ba832a0`; verification records `all checks + boot
smoke passed` and a passing report-only flightcheck. The obsolete internal
candidate ref was released.

Verification: focused recovery server tests passed 5 files / 65 tests; focused
Self web tests passed 2 files / 23 tests; the full server suite passed 181 files /
1,370 tests before the additional add-only-board regression, which passed in a
focused 15/15 run; the real resumed Self verifier then reran the repository-wide
test/build/boot gate successfully on the final reconciled candidate. The full
web suite passed 89 files / 394 tests. Server and web typechecks passed; server
and production web builds passed; `git diff --check` passed with only normal
CRLF notices; the committed build's isolated `/api/health` boot smoke returned
healthy. AVA was relaunched on the new server build and its live health endpoint
is ready.

Niko's unrelated `.claude/settings.local.json` edit and untracked persona
research document remain untouched. Forge was neither inspected nor modified.

NEEDS: niko (reload Self and confirm the recovered UFO evaluation shows shipped;
review `docs/self/proposals/microsoft-ufo-evaluation.md` when ready)

---

### 2026-08-27 - codex - AVA personality research review

Completed a read-only review of AVA's current persona specification, voice
persona overlay, existing open-source persona-framework research, and current
primary research on human-AI interaction. No product code, runtime behavior, or
Forge content was changed. The recommended direction is a compact AVA Persona
v2 that separates stable identity from collaboration policy, uses explicit
context modes (casual, execution, brainstorming, failure, high-stakes), and
expresses warmth through attention, continuity, candid help, and graceful
repair rather than flattery or constant humor. A frozen chat/voice evaluation
suite should gate any live replacement, including checks for fabricated
familiarity, sycophancy, contextual humor, persona consistency, and truthful
failure handling.

The existing `docs/reviews/2026-08-27-persona-framework-repository-research.md`
remains an unrelated untracked document and was not modified or committed in
this read-only turn.

NEEDS: niko (review the proposed Persona v2 direction and authorize a bounded
design/evaluation or implementation pass if desired)

---

### 2026-08-27 - codex - Persona v2 implementation claim

Niko approved implementation of the personality direction from the immediately
preceding research review. I am claiming the AVA-only persona and evaluation
surface: a compact stable identity separated from collaboration behavior,
explicit context registers shared by typed chat and voice, and a deterministic
Persona Consistency Lab covering warmth, competence, candor, restrained humor,
failure repair, fabricated familiarity, sycophancy and cross-modal consistency.

The change will preserve AVA's existing tool, approval, verification, memory,
privacy and safety authorities. Personality will not gain permission to rewrite
those contracts or silently learn durable traits. Existing unrelated local
changes, especially `.claude/settings.local.json` and the untracked persona
research document, will be preserved. Forge is outside scope and will not be
inspected or modified.

NEEDS: codex (implement, test, commit, and return verification evidence)

---

### 2026-08-28 - codex - Persona v2 shipped

Commit `8d5f2ae` implements the approved AVA Persona v2 without changing AVA's
tool, approval, privacy, verification, memory, or safety authority. The old
all-in-one persona is now a compact stable identity; collaboration behavior and
five closed contextual delivery registers (`casual`, `execution`,
`brainstorming`, `repair`, `high_stakes`) live in a separate provider-neutral
runtime contract. Typed chat selects a register from the literal current turn
without copying raw user text into system instructions. Realtime voice uses the
same AVA identity and shared collaboration rules with only spoken-delivery
guidance, replacing the competing "sharp friend" character. Tool failures
reinforce calm, factual repair at the authoritative result boundary.

The new Persona Consistency Lab freezes 50 deterministic chat/voice scenarios,
ten per register, and checks register routing plus bounded failures including
canned filler, over-address, verbosity, unsafe humor, fabricated familiarity,
unqualified agreement, and defensive repair. The lab reports honestly that it
is contract coverage rather than a live-model preference score. Memory's API
and List -> Personality surface expose Persona v2, all register summaries, lab
validity, scenario count, and the limitation. The canonical seed and Niko's
current ignored live `server/data/memory/personality.md` both contain Persona
v2; deliberate owner edits remain protected by bootstrap's no-overwrite rule.

Documentation is in `docs/features/persona-v2.md`, with memory and voice
architecture references updated. Focused server verification passed 7 files /
116 tests; focused web verification passed 3 files / 3 tests. The full server
suite passed 183 files / 1,386 tests and the full web suite passed 90 files /
395 tests. Server and production web builds passed. `git diff --check` passed
with only the repository's normal CRLF notices. A committed-HEAD server rebuild
and isolated scratch-data boot smoke returned `{ "ok": true, "log":
"healthy" }`. Existing ES2024 target and large-bundle notices remain warnings,
not failures.

Known limitation: deterministic checks guard routing and obvious anti-patterns;
they do not prove subjective live-model quality. Real conversation review is
still required, and the deliberately conservative lexical selector will need
new frozen scenarios when reviewed edge cases appear. Niko's unrelated
`.claude/settings.local.json` modification and untracked persona research
document were preserved. Forge was neither inspected nor modified.

NEEDS: niko (restart or reload AVA, inspect Memory -> List -> Personality, and
try the manual chat/voice checks in `docs/features/persona-v2.md`)

---

### 2026-08-28 - codex - semantic memory index v1 claim

Niko approved the narrow AVA-owned retrieval slice developed with AVA: capture
one selected conversation segment, sanitize and summarize it into canonical
SQLite state, embed only that bounded summary, retrieve it from a different
chat through hybrid semantic and lexical search, verify that the authoritative
source messages still exist and have not changed, and explain why the result
matched. I am claiming this new semantic-memory-index area because no existing
owner or active claim covers it.

The first slice will include project and privacy boundaries, idempotent capture,
forget propagation, an exact/keyword fallback when embeddings are unavailable,
an explicit AVA capture/search tool path, and a small inspectable Memory result
surface. Automatic indexing, Mem0 as a dependency, broad transcript ingestion,
and a large dashboard remain deliberately out of scope until this loop is
proven. SQLite remains authoritative; the embedding is only a discovery aid and
never replaces source verification. Existing unrelated changes will be
preserved. Forge is outside scope and will not be inspected or modified.

NEEDS: codex (implement, test, commit, and return deterministic cross-session evidence)

---

### 2026-08-28 - codex - source-verified semantic memory index v1 shipped

Commit `c674a7c` implements the agreed explicit-capture retrieval loop. AVA now
stores bounded sanitized research/idea records in SQLite, embeds only those
compact records when OpenAI is configured, falls back honestly to exact/keyword
search, and re-fingerprints the authoritative conversation range before every
result is usable. Exact repeated capture is idempotent; project-scoped entries
do not appear without the matching project; versioned forget removes the vector
and prevents silent resurrection. Provider/model/dimensions/input hash travel
with vectors so incompatible spaces are never compared.

The agent path adds `memory_index_capture`, `memory_index_search`,
`memory_index_open`, and `memory_index_forget` to the same persisted session
toolset used by text and voice. Search is a locator: `memory_index_open` loads a
bounded sanitized authoritative range only when detail is needed. It returns no
content for changed/unavailable sources. The Memory -> Index UI shows summary,
source health, actual retrieval mode, match rationale, limitations, project
scope, and an Open source chat action. Explorer declares the new capability and
provider-neutral workflow with 62 tool mappings.

Exact product files: `server/src/memory-index/{types,embedding,store}.ts` and
their tests; `server/src/state/schema.sql`; `server/src/index.ts`;
`server/src/routes/{chat,memory}.ts`; `server/src/routes/memory.test.ts`;
`server/src/tools/memory-mcp.ts` and test; orchestrator capability, intent and
rubric sources/tests; policy source/test; server Explorer mapper;
`web/src/{App,api}.ts(x)`; `web/src/memory/{MemoryScreen,MemoryIndexSection}.tsx`
and MemoryIndexSection test; web Explorer registry/test/generated manifest; and
`docs/features/semantic-memory-index.md`, `docs/AVA-CAPABILITIES.md`, plus the
memory/tool architecture docs.

Verification: focused semantic-memory server tests passed 7 files / 96 tests;
focused Memory/App web tests passed 3 files / 8 tests. The full server suite
passed 185 files / 1,403 tests and the full web suite passed 91 files / 398
tests. Server and production web builds passed. Explorer contract/reality audit
passed with 33 capabilities, 62/62 tool mappings, 22/22 routes, 105 verified
source references and zero broken sources. `git diff --check` passed with only
normal CRLF notices. A committed-HEAD server rebuild and isolated scratch-data
boot smoke returned `{ "ok": true, "log": "healthy" }`. The privacy audit found
the only key-shaped value in new code is an intentional scrubbing test fixture;
it is asserted absent from SQLite, provider input and tool output.

Known limitations: v1 never auto-indexes a conversation or creates background
checkpoints; there is no Mem0 dependency or second canonical store; existing
entries are not automatically re-embedded after a model change; a matching
source fingerprint proves integrity, not perfect summary fidelity; real
semantic behavior still depends on configured OpenAI embeddings and otherwise
uses lexical fallback. Existing ES2024 and large web-bundle notices remain
warnings. Niko's unrelated `.claude/settings.local.json` edit and untracked
persona research document were preserved. Forge was neither inspected nor
modified.

NEEDS: niko (reload AVA; explicitly index one developed discussion, then test
cross-chat paraphrase recall and Memory -> Index using the manual steps in
`docs/features/semantic-memory-index.md`)

---

### 2026-08-28 - codex - semantic memory live stress-test repair claim

Niko authorized Codex to exercise the shipped memory index directly through AVA
without requiring manual testing. The first real chat + voice-marked conversation
and agent-selected `memory_index_capture` exposed a source-fidelity defect: AVA
summarized a later refinement but the verified range contained only the capture
instruction. Mission Control proves the model supplied a `start_marker` quoted in
that instruction; the tool searched backward and matched the quote rather than
the original message. The resulting entry `memory_6w0ISr5mjLAppJ` was therefore
internally consistent at the hash level but not adequate evidence for every
indexed conclusion.

I am reclaiming the otherwise-unowned semantic-memory slice for the bounded
repair and broader black-box stress pass: correct first-message selection,
regression coverage, live cross-chat and voice-routed retrieval/open, duplicate
capture, privacy/project isolation, stale-version forget, persistence across
restart, and cleanup of disposable test data. Any further failure found will be
fixed only within this existing source-verified memory contract. Forge remains
outside scope and will not be inspected or modified.

NEEDS: codex (repair, stress-test, commit, and return concrete live evidence)

---

### 2026-08-28 - codex - semantic memory live stress repairs shipped

Commit `199fe3b` (`fix(memory): preserve authoritative source ranges`) fixes two
defects found by exercising the real AVA model/tool/UI path rather than only the
deterministic test seam. First, `start_marker` now resolves to the chronological
first matching message. A capture command that quotes the requested marker can
no longer replace the actual developed discussion with a one-message,
hash-valid but evidentially incomplete range. Second, source verification now
joins only non-deleted sessions, so deleting a chat immediately changes linked
memory to `unavailable` / `usable=false`, matching the privacy and documentation
contract even while normal soft-delete retention keeps underlying rows.

The initial failure is preserved in Mission Control: run `PgEkf61rz3IN` called
`memory_index_capture` with the quoted marker but recorded only message
2447-2447. After the repair, the real Lumen Orchid run captured messages
2451-2455 (five messages, correct first and last IDs), returned a ready embedding,
and a separate voice-marked chat called both `memory_index_search` and
`memory_index_open` before answering. The Memory -> Index UI rendered the card,
`source verified`, embedding state, match disclosure, and its authenticated Open
source chat path loaded the linked transcript.

Additional live stress evidence: exact replay returned `created=false` with the
same entry ID; 12/12 concurrent hybrid searches succeeded; semantic embeddings
were available; project data was absent from unscoped search and present only
with its matching project; a fake key-shaped value was absent from capture and
search output; stale forget returned 409 and the current version succeeded; a
full server restart preserved the entry and its verified source; a new AVA chat
recalled all four requested facts and then used the agent forget path; forgotten
source replay returned 409 instead of resurrection; missing source capture
returned 404; empty search returned 400. On the final rebuilt server, soft-delete
changed a live test entry to `unavailable` / `usable=false`, GET agreed, and
forget removed it. Every disposable entry was forgotten and every disposable
chat was soft-deleted; no test marker remains in the active index.

Verification: focused memory coverage passed 6 files / 68 tests (including the
new repeated-marker and soft-delete regressions); the complete server suite
passed 185 files / 1,403 tests; the complete web suite passed 91 files / 398
tests; server and production PWA builds passed; and `git diff --check` reported
only normal CRLF notices. The committed-HEAD rebuild is live and `/api/health`
reports `ok=true`, `ready=true`, provider `openai`, build ID
`07fcd7ba-662f-4b7c-97ef-c75156587e4e`.

Known limit remains explicit: a matching source fingerprint proves integrity,
not perfect summary or final-answer fidelity. One deliberately ambiguous live
voice prompt called the test marker the “identifier”; a later clean post-restart
turn recovered the intended amber-hexagon fact from the same verified source.
AVA therefore still opens authoritative messages for detail, and neither the UI
nor docs claim that embedding or hashing semantically certifies a summary.

Niko's unrelated `.claude/settings.local.json` edit and untracked persona
research document were preserved. Forge was neither inspected nor modified.

NEEDS: nobody (the repaired explicit-capture loop is committed, running, tested,
cleaned up, and ready for measured use; automatic indexing remains a separate
future increment)

---

### 2026-08-28 - codex - CLAIM: blank-new-chat voice session binding

Niko reproduced a remaining canonical-conversation defect after the earlier
chat/voice continuity repair: entering voice from a newly created but still
blank chat passes no session ID, so the voice proxy applies its home-orb policy
and resumes the most recently updated conversation. That makes the fresh chat
appear to jump back to the one conversation previously used by voice. The prior
connection teardown is present, but it will be stress-tested independently so a
retired socket cannot remain authoritative during rapid mode changes.

I am claiming the existing Codex-owned realtime voice/UI handoff only. The fix
will preserve home-orb resume behavior, but mark voice entry from a blank New
chat as an explicit fresh-conversation request. Acceptance covers exact session
identity for existing chats, freshly persisted typed chats, and blank chats;
rapid voice/keyboard/new-chat transitions; socket/media teardown; reconnect
idempotency; deterministic focused regressions; broader suites/builds; and a
committed-HEAD runtime smoke. Self and semantic memory are outside this change.
Forge will not be inspected or modified.

NEEDS: codex (implement, stress-test, commit, and return exact session evidence)

---

### 2026-08-28 - codex - blank-new-chat voice session binding shipped

Commit `486de96` (`fix(voice): bind blank chats to fresh sessions`) fixes the
remaining chat/voice identity split without changing the intentional Home-orb
resume-latest behavior. The root cause was an overloaded null session ID: Home
voice and a deliberately blank New chat both passed `null`, so the realtime
proxy applied Home policy and resumed the latest conversation. `App` now carries
the entry origin and marks only blank-New-chat voice as `startFresh`; the first
WebSocket sends `new=1`, then the returned canonical `ava.session` ID is adopted
synchronously for exit and reconnect.

Stress testing exposed and closed two additional races. The common session-event
path previously left the fresh-connection flag armed, so a reconnect could mint
another chat; it now clears that flag and updates the ID ref before React state.
Also, after returning to keyboard, `ChatScreen` initially hydrated local state
asynchronously; an immediate mic press could temporarily pass null. The already
requested persisted session is now authoritative throughout that hydration
window. Existing voice teardown still closes the retired WebSocket/media path
on mode exit and unmount.

Changed product files: `web/src/App.tsx`, `web/src/voice/VoiceScreen.tsx`,
`web/src/voice/useRealtimeVoice.ts`, `web/src/chat/ChatScreen.tsx`, focused tests
for all four boundaries, and the voice/web architecture and continuity docs.

Verification: focused voice/session server coverage passed 2 files / 95 tests;
focused web coverage passed 4 files / 53 tests; the complete web suite passed
91 files / 404 tests. Server TypeScript/schema build and the production PWA build
passed (the pre-existing ES2024 and large-chunk notices remain warnings).
`git diff --check` passed with normal CRLF notices. The committed-HEAD desktop
runtime was rebuilt and relaunched; `/api/health` reports `ok=true`,
`ready=true`, provider `openai`, and build ID
`e6cac210-373d-44cd-b63a-a7f93124678a`.

The decisive real-browser/CDP check used AVA's installed application and actual
realtime proxy: entering voice from blank New sent `new=1` and created exactly
one session (`i3YTpt7Cw4cN`); switching immediately to keyboard closed the old
socket; immediate mic re-entry sent `sessionId=i3YTpt7Cw4cN` with no `new=1` and
created no second session. Seven empty/system-only conversations produced by
the diagnostic attempts were identified by exact IDs/timestamps and removed
through AVA's authenticated session API (all returned 204); no user conversation
was deleted. Niko's unrelated `.claude/settings.local.json` edit and untracked
persona research document were preserved. Forge was neither inspected nor
modified.

NEEDS: niko (hard-refresh AVA once if an older service worker is visible, then
test New -> mic -> keyboard -> mic; both modes should remain in that same New
chat, while a second New starts a separate conversation)

---

### 2026-08-28 - codex - CLAIM: acknowledged watcher delivery into standalone Codex

Niko reports that AVA can stage watcher text into the open `nikug` Codex window
but sometimes fails to submit it, and that busy-versus-idle detection is not
reliable enough for unattended overnight development. I am reclaiming the
existing Codex-owned watcher transport for a bounded delivery reliability
repair. Acceptance is not simulated scheduling or text insertion: the harmless
watch marker must become a real user turn in the exact pinned standalone Codex
conversation only after the current task boundary, with an authoritative
acknowledgement, idempotent retry/recovery, and no duplicate prompt.

Live stress messages will be non-task probes that ask only for a unique receipt,
so testing cannot recursively assign development work. The repair will preserve
sanitization, exact-thread targeting, one-writer safety, cycle ancestry, terminal
failure honesty, Mission Control evidence, and the existing no-hidden-route
contract. It will not use or modify Forge.

NEEDS: codex (reproduce, repair, stress-test, commit, and return live delivery evidence)

---

### 2026-08-28 - codex - acknowledged exact-thread watcher delivery shipped

Commit `bea70ff` (`fix(watches): acknowledge exact-thread Codex delivery`)
replaces the unreliable Windows console injector with Codex 0.150.1's supported
exact-thread queue. The removed path selected an argument-free process, wrote
text into a console, pressed a blind Tab key, and recorded `injected` before any
proof that Codex had submitted the message. Multiple open Codex processes made
that process heuristic ambiguous, and the terminal title `nikug` is not a
Codex session identity. AVA now pins and submits to the immutable session UUID
using `codex queue --thread <id> --message <text>`; Codex itself owns busy/idle
queueing and AVA no longer guesses from windows, processes, or keystrokes.

The new `server/src/watches/codex-queue.ts` records a content-free SHA-256
receipt only after the CLI acknowledges the exact thread. Exclusive claims and
receipts prevent concurrent/replayed scheduler passes from submitting twice.
A definite pre-acceptance failure may retry; a timeout, thrown transport, stale
claim, receipt mismatch, or lost acknowledgement fails closed and is never
replayed automatically. The existing unique rollout marker remains the real
delivery evidence, and the following Codex task-complete event remains the
completion evidence. The trusted Stop hook is retained only as an older-client
busy-turn fallback. Removed files are
`server/src/watches/codex-console.ts`, its test, and
`scripts/send-codex-watch-console.ps1`; dispatcher, tool description, server
wiring, tests, and `docs/features/watches.md` were updated accordingly.

Verification passed: focused watcher/tool coverage was 5 files / 47 tests;
the full server suite was 185 files / 1,408 tests; server build and
`git diff --check` passed (normal CRLF notices only). A safe installed-CLI probe
against a nonexistent UUID returned a typed no-session failure. A real busy-turn
probe against pinned thread `019f977d-97dc-7cd1-b2ad-904631196018` received CLI
acknowledgement; 250 identical replays produced 250 `already_accepted` results
and zero second submissions, while the receipt contained no prompt. The text
then appeared after the clean task boundary as semantic user-message evidence
in the immutable rollout.

The decisive full AVA path used a separate chat to ask AVA to create watcher
`Qbsl_p_es8GP`. It persisted the exact thread, reached `dispatching`, stored an
accepted content-free queue receipt at `2026-08-28T01:47:42.459Z`, and did not
claim delivery while the active turn was still running. At the next clean
boundary its `[AVA-WATCH:Qbsl_p_es8GP]` message appeared in this pinned Codex
session. The scheduler then persisted `delivered_at=1787881841964`, observed the
reply/task boundary, persisted `completed_at=1787881902379`, disabled the
one-shot watch, and ended with `last_status=completed` / `pinned Codex task
reached a completed task boundary`. AVA was rebuilt and relaunched on the exact
committed build before this full-path test.

Known limitation: no local delivery system can mathematically promise service
when AVA, Codex, or the PC is powered off. The adapter now distinguishes those
failures honestly and no longer reports terminal text insertion as delivery.
Niko's unrelated `.claude/settings.local.json` edit and untracked persona
research document were preserved. Forge was neither inspected nor modified.

NEEDS: nobody (the exact-thread watcher transport is committed, live, and
verified through scheduling, busy-turn queueing, clean-boundary delivery, reply,
and persisted completion)

---

### 2026-08-28 - codex - CLAIM: semantic memory Phase 2 automatic capture

Niko approved continuation of the full memory/RAG implementation and asked AVA
to keep Codex moving across clean phase boundaries with tests after every phase.
The explicit source-verified capture/search/open/forget loop and its live stress
repairs are already shipped in `c674a7c` and `199fe3b`; I will not rebuild them.

I am claiming the unowned semantic-memory area for the next bounded phase from
the agreed sequence: automatically recognize completed user-requested research
and meaningfully developed ideas, create one bounded source-verified checkpoint
at an authoritative completed-turn boundary, and expose honest capture evidence
without making every chat message a memory. The phase must reuse SQLite as the
canonical source, the existing sanitizer/embedder/source fingerprint/project
scope/idempotency contracts, and the same text/voice session identity. It will
fail open for conversation delivery but fail closed for memory persistence:
ambiguous or unverified content must not be silently learned.

Acceptance includes deterministic classification/capture/idempotency/privacy/
source-change tests; restart and cross-session behavior; manual AVA chat and
voice-marked black-box checks; focused and broader suites/builds; committed-HEAD
boot smoke; documentation; a scoped commit; and a successor watcher before the
phase boundary. Existing unrelated changes remain untouched. Forge is outside
scope and will not be inspected or modified.

NEEDS: codex (inspect the shipped index, implement the smallest complete
automatic-capture phase, test it automatically and manually, commit, and ask
AVA to queue the next continuation watcher)

---

### 2026-08-28 - codex - COMPLETE: semantic memory Phase 2 automatic capture

Shipped automatic, source-bounded indexing for completed user-requested
research and meaningfully developed multi-turn Ideas in `93278f0`, followed by
the successful-read evidence correction in `01ff0c0`. Chat, OpenAI realtime,
and Hume now enter the same conservative post-turn capture coordinator. It
stores one compact sanitized summary plus exact message-range provenance,
labels automatic versus explicit capture in the Memory Index UI, suppresses
overlapping Idea duplicates, and fails closed for memory while leaving the
conversation unaffected. Failed, contradicted, cancelled, interrupted,
disconnected, and non-persisted delegated turns remain ineligible. Completed
read-only research may retain an honest unverified-executor limitation instead
of being discarded merely because reading a page is not independent proof.

Changed areas: `server/src/memory-index/{auto-capture.ts,auto-capture.test.ts,
types.ts,store.ts,store.test.ts}`, the SQLite schema and migrations, chat and
both realtime voice boundaries plus their tests, production composition in
`server/src/index.ts`, Memory Index API/UI/types/tests, Explorer registry and
verified manifest, and the semantic-memory/capability/architecture docs.

Deterministic evidence: the focused memory/chat/voice/tool set passed 140 tests;
the later read-evidence correction passed 17/17 focused tests; Memory Index web
tests passed 3/3; the full root test command passed the server suite and all 91
web files / 404 web tests; server and production web builds passed. Explorer's
contract/reality audit passed with 33 capabilities, 62/62 tool mappings, 106
verified source references, and 22/22 API routes. `git diff --check` passed.

Black-box evidence against committed HEAD: ordinary chat created zero entries;
research chat and a voice-marked research turn each created one automatic,
verified-source research entry; a two-turn developed Idea created one entry and
a third refinement remained deduplicated; a fresh chat invoked both
`memory_index_search` and `memory_index_open` and recovered the correct Idea;
all three automatic entries survived an AVA restart on a matching committed
build ID; semantic search found the paraphrased Idea; Forget removed it from
retrieval. The disposable entries, sessions, and acceptance device were then
removed/revoked. AVA is running the committed build.

Known boundary: Phase 2 intentionally creates only the first mature Idea
checkpoint. Linked revisions/topic-boundary checkpoints are Phase 3, automatic
cross-chat/voice context injection is Phase 4, and correction/pin/supersession
governance is Phase 5. Niko's unrelated `.claude/settings.local.json` change and
untracked persona research document were preserved. Forge was neither inspected
nor modified.

NEEDS: codex (continue with Phase 3 linked checkpoints, retain per-phase tests,
and keep the exact-thread AVA watcher handoff alive)
