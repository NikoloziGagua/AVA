# 07 — The Self-Improvement System

> Ava editing its own code. This is the subsystem that lets the agent take a
> goal ("make voice less laggy", "fix the thing I got wrong"), have a coding
> worker write the change in an isolated copy of the repo, prove it with
> tests/build/boot, and only then move the live code onto it — with several
> guardrails and a watchdog that can roll the change back if the new build never
> comes up healthy.

All code lives in `server/src/self/` (plus one detached entry script
`server/src/self/watchdog-main.ts`, the overnight driver
`server/scripts/auto-improve-loop.ts`, the worker wrapper
`server/src/tools/claude-code.ts`, the HTTP route `server/src/routes/self.ts`,
and the PWA screen `web/src/self/`).

---

## 0. Two actors, and why the distinction matters

This document is precise about **who is doing what**, because the system is
literally one program editing the code of another:

- **Ava** — the running server (the orchestrator + tool host). Ava is the
  *runtime*. It decides to start an improvement, holds the state machine, runs
  the verify gate, performs the git swap, and spawns the watchdog.
- **Claude (the worker)** — a separate, headless `claude` process Ava spawns to
  actually write the code. This is **Claude Code running on the owner's `claude`
  subscription login**, not the Anthropic API (`server/src/tools/claude-code.ts`
  deliberately strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the worker
  env at `claude-code.ts:59-64` so it authenticates as the subscription, exactly
  like an interactive user — otherwise it would silently bill a pay-as-you-go
  account and fail "credit balance too low").
- **The LLM provider** — a *third* thing. The `reflect` step (turning a goal into
  a change brief) does NOT use the Claude worker; it uses Ava's configured
  `LLMProvider` (OpenAI or Anthropic-via-API, whatever `cfg.llmProvider` is)
  through `provider.stream(...)` (`reflect.ts:16`). So a single improvement can
  touch two different model backends: the **provider** writes the brief, the
  **subscription Claude worker** writes the code.

Keeping these straight is the difference between an honest status report and a
misleading one.

---

## 1. The pipeline at a glance

```mermaid
stateDiagram-v2
    [*] --> queued : createIntent (explicit | schedule)

    queued --> reflecting : runImprovement acquires the in-flight slot
    queued --> queued : another improvement in flight → wait (FIFO)

    reflecting --> awaiting_approval : "requireApproval(intent) true (explicit trigger): park plan, push you"
    reflecting --> implementing : "schedule trigger: no gate, straight through"
    note right of awaiting_approval
      User-triggered improvements PAUSE here
      and wait for Approve & run / Reject.
      The single-flight slot is HELD meanwhile.
    end note

    awaiting_approval --> implementing : "approveImprovement(id)"
    awaiting_approval --> failed : "rejectImprovement(id) outcome=rejected, OR Stop/abort outcome=cancelled"

    reflecting --> implementing : provider.stream() returns a CHANGE/ACCEPTANCE brief
    note right of reflecting
      LLM PROVIDER (OpenAI/Anthropic API),
      NOT the Claude worker
    end note

    implementing --> verifying : Claude worker edited files in the worktree
    note right of implementing
      git worktree under OS tmpdir,
      node_modules junctioned in,
      Claude Code on the SUBSCRIPTION
    end note

    verifying --> swap_guard : npm test + web build + server build + boot-smoke all pass
    note right of verifying
      flightcheck also runs here but is
      REPORT-ONLY — never gates the swap
    end note

    state swap_guard <<choice>>
    verifying --> swap_guard : commit candidate, capture lastKnownGood
    swap_guard --> swapped : assertSwapSafe OK + non-destructive fast-forward
    swap_guard --> blocked : verified candidate preserved; install is unsafe now
    blocked --> recovering : explicit version-guarded retry
    recovering --> verifying : HEAD advanced; reconcile in fresh worktree
    recovering --> swapped : same HEAD; safe fast-forward succeeds
    recovering --> blocked : overlap, conflict, stale boundary, or restart

    swapped --> watchdog : detached watchdog spawned; server restarts onto new code

    state watchdog <<choice>>
    watchdog --> committed : /api/health responds in time → change stays live
    watchdog --> rolled_back_auto : never healthy → revertTo(lastKnownGood)

    reflecting --> failed : any throw
    implementing --> failed : worker no-op / error / non-zero
    verifying --> failed : any check fails

    reflecting --> failed : "Stop / cancel -> outcome=cancelled (reflect LLM call aborted)"
    implementing --> failed : "Stop / cancel -> outcome=cancelled (worker tree-killed)"
    verifying --> failed : "Stop / cancel -> outcome=cancelled (verify subprocess tree-killed)"

    swapped --> rolled_back_manual : owner taps "Revert last" / POST /:id/revert

    committed --> [*]
    failed --> [*]
    rolled_back_auto --> [*]
    rolled_back_manual --> [*]
```

> **Note on status vocabulary.** The DB/state machine persists ten statuses:
> `queued`, `reflecting`, `awaiting_approval`, `implementing`, `verifying`,
> `recovering`, `blocked`, `swapped`, `failed`, and `rolled_back`. `blocked`
> means implementation and verification produced a candidate but live installation
> is unsafe right now; it is deliberately not a terminal implementation failure.
> The boxes above
> named `swap_guard`, `watchdog`, `committed`, and `rolled_back_auto` are *moments
> in the runtime*, not stored statuses — a successful run simply stays at `swapped`,
> and an automatic watchdog rollback rewrites git but does **not** currently write
> a `rolled_back` row (see §9, "Honest caveats"). Only the manual revert route
> sets `status = "rolled_back"`. A **stopped** run and a **rejected** plan both end
> at `status="failed"`, distinguished by the `outcome` column
> (`"cancelled"` vs `"rejected"`); see §13.1.

---

## 2. The orchestrator: `runImprovement` (`improver.ts`)

`runImprovement(db, id, deps)` is the heart. It is intentionally a thin
*coordinator*: it owns the state transitions and the single-flight lock, and
delegates every real action to an injected `ImproverDeps` object. That injection
is what lets the same orchestration run two ways — the **live interactive path**
(wired in `server/src/index.ts:150` `buildImproverDeps`) and the **overnight
loop** (wired in `server/scripts/auto-improve-loop.ts:67`) — with different
implementations of `implement`, `restart`, `watch`, etc.

### `ImproverDeps` (the seams), `improver.ts:4-30`

| Dep | What it does | Live impl | Overnight impl |
| --- | --- | --- | --- |
| `requireApproval(intent)?` | **gate**: when true, park the drafted plan and wait for approval before writing code | `intent.trigger === "explicit"` | **omitted** (no gate) |
| `onAwaitingApproval(id, plan)?` | fired when an improvement parks at `awaiting_approval` — push the user | `notifyDone(…)` | omitted |
| `reflect(goal, failureLog, signal?)` | goal → change brief via the **LLM provider** | `reflect({provider,…,abort:signal})` | same |
| `addWorktree(id)` / `removeWorktree(wt)` | git worktree create/destroy | `worktree.ts` | same |
| `implement(brief, cwd, signal?)` | **Claude worker** edits files in the worktree | `selfClaudeCode.run` (passes `signal`) | `selfClaudeCode.run` (passes `signal`) |
| `verify(cwd, signal?)` | tests + build + boot-smoke (+ report-only flightcheck) | `verify` (+ `flightcheck`) | `verify` (no flightcheck) |
| `headSha()` | current live HEAD | `swap.headSha` | same |
| `commitWorktree(cwd,msg)` | `git add -A` + commit; throws if no changes | inline | inline |
| `swapTo(sha, lastKnownGood)` | **safety-guard** then non-destructive `git merge --ff-only` | `assertSwapSafe`+`swapTo` | same |
| `preserveCandidate(id, sha)` / `releaseCandidate(id)` | keep or remove `refs/ava/self-candidates/<id>` | `worktree.ts` | same |
| `reconcileCandidate(cwd, base, sha)` | replay an approved candidate onto newer HEAD before full re-verification | `worktree.ts` | same |
| `revertTo(sha)` | hard reset back | `swap.revertTo` | `swap.revertTo` |
| `restart()` | restart the live server | no-op (tsx watch reloads) | no-op |
| `watch(knownGood, swapped)` | spawn detached watchdog | spawns `watchdog-main.ts` | same |
| `emit(e)` | progress event for logs/journal | `log.*` | append to overnight log |
| `onSwapped(intent, sha)?` | **new**: fired after a successful swap — append the self-changelog | `appendChangelog(memoryDir, …)` | same |
| `onFailed(intent, error)?` | **new**: fired on a real failure (not a cancel) — record a friction-ledger entry | `recordMistake(memoryDir, …)` | same |

### The single-flight lock + FIFO queue + cancel/decision registries, `improver.ts:32-41`

```ts
let inFlight = false;            // one improvement mutates the tree at a time
const pending: string[] = [];   // intents waiting their turn (FIFO)
const controllers = new Map<string, AbortController>();   // per RUNNING improvement → its abort signal
const planDecisions = new Map<string, (approved: boolean) => void>(); // per improvement parked at awaiting_approval
```

Only one improvement may be in flight, because they all mutate the **same live
git working tree**. A second concurrent request is **not failed** — it is pushed
onto `pending`, keeps its `queued` status (so it stays visible to
`self_improve_status`), and is drained in the `finally` block when the slot frees
(`improver.ts:180-181`). This was a deliberate fix: an older version marked the
second intent "failed: another improvement is in progress"; the queue test
(`improver.queue.test.ts`) locks in the new wait-your-turn behaviour.

Two more module-level maps make a running improvement **controllable** (this is
the fix for the old "Stop can't reach self-improvement" gap, §13.1):

- **`controllers`** — one `AbortController` per *running* improvement, keyed by
  intent id (`:38, 103-105`). The signal threads into `reflect`, `implement`, and
  `verify` and is checked between stages via `throwIfAborted()`. A *queued* (not
  yet running) improvement has no controller — it's cancelled by removing it from
  `pending`.
- **`planDecisions`** — one resolver per improvement currently *parked* at
  `awaiting_approval` (`:41, 123`); `approveImprovement`/`rejectImprovement` (or an
  abort) settle the promise the run is blocked on.

Exported controls built on these:

| Export | Effect |
| --- | --- |
| `cancelImprovement(db, id)` (`:68-78`) | Abort the running one, **or** drop a queued one from `pending` and mark it `failed`/`outcome="cancelled"`. Returns whether anything was cancelled. |
| `cancelAllImprovements(db)` (`:82-91`) | Abort **every** controller + clear the whole `pending` queue. Returns the count. **This is what the red Stop button calls.** |
| `approveImprovement(id)` (`:50-55`) | Settle a parked plan `true` → proceeds to implement. |
| `rejectImprovement(id)` (`:58-63`) | Settle a parked plan `false` → stops with `outcome="rejected"`. |
| `hasActiveImprovement()` (`:44-46`) | `inFlight || pending.length > 0`. |

> **Caveat:** `inFlight`, `pending`, `controllers`, and `planDecisions` are all
> **module-level in-memory state**. They do not survive a restart, and they are
> *not* shared between the live server and the overnight loop — those are two
> separate processes. So the live server's `cancelAllImprovements` cannot reach an
> improvement running inside the overnight-loop process, and a parked plan's
> resolver is lost on restart (the intent is reconciled to `failed` by
> `failStaleIntents`, §8a). The overnight loop is meant to run while the
> interactive path is idle.

### The happy path, step by step (`improver.ts:93-183`)

1. `inFlight = true`; construct a fresh `AbortController`, register it in
   `controllers[id]`, and define `throwIfAborted()` (`:100-106`); load the intent.
2. `status = reflecting`; `brief = await deps.reflect(goal, null, signal)`. (Note
   the `failureLog` argument is always `null` here — there is no automatic
   reflect-on-failure retry loop in the current code, despite the parameter
   existing.)
3. **Approval gate (`:118-138`).** If `deps.requireApproval?.(intent)` is true:
   `status = awaiting_approval`; store the plan in `diff_summary` prefixed `PLAN:`
   (capped 4 KB); call `deps.onAwaitingApproval?.(id, brief)` to push the user; then
   `await` a `Promise<boolean>` whose resolver lives in `planDecisions[id]` (an
   abort resolves it `false`). On resolve: if **not** approved, write `failed` with
   `outcome = signal.aborted ? "cancelled" : "rejected"` and **return before any
   worktree exists**. (The overnight loop omits `requireApproval`, so it skips this
   entirely.)
4. `status = implementing`; `wt = deps.addWorktree(id)`; `impl =
   deps.implement(brief, wt.path, signal)`. The brief **and** the worker's output
   are recorded into `diff_summary` (capped 4 KB) *before* the ok-check, so even a
   no-op or a bad edit is diagnosable from the intent. If `!impl.ok` → throw;
   `throwIfAborted()` after.
5. `status = verifying`; `v = deps.verify(wt.path, signal)`; store `verify_log`. If
   `!v.ok` → throw; `throwIfAborted()` after.
6. `knownGood = deps.headSha()` (captured **now**, just before swapping, so it is
   the true pre-swap HEAD), then `sha = deps.commitWorktree(wt.path, "self: <goal>")`.
   Persist `last_known_good`, `commit_sha`, `branch`.
7. `deps.swapTo(sha, knownGood)` — the guarded swap (see §7).
8. `status = swapped`, `outcome = "shipped"`; **fire-and-forget**
   `deps.watch(knownGood, sha)` (the watchdog); `await deps.restart()`.
9. `finally` (`:175-182`): `controllers.delete(id)`; `deps.removeWorktree(wt)` (if
   one was created); `inFlight = false`; drain the next `pending` id.

Any throw anywhere lands in the single `catch` (`improver.ts:164-174`), which
**distinguishes a cancel from a failure**: if `signal.aborted`, it writes
`status = failed`, `outcome = "cancelled"` and emits `cancelled`; otherwise
`status = failed`, `error = <message>`, emit `failed`. (A worker or verify
subprocess killed by the signal surfaces here too.) The worktree is still cleaned
up in `finally`.

---

## 3. What triggers an improvement (and what does NOT)

There are four *declared* trigger types (`intents.ts:4`): `explicit`, `failure`,
`friction`, `schedule`. **Three are now wired to create intents** (the `friction`
trigger went live tonight, commit c3bd23b):

| Trigger | Wired? | Entry point |
| --- | --- | --- |
| `explicit` | **Yes** | The `self_improve` tool (`tools/self-improve-mcp.ts`) → `queueSelfImprove` (`index.ts`), the HTTP route `POST /api/self/improve` (`routes/self.ts`), and the Self screen's new initiator box (§11). Used when the owner asks Ava to change its own behaviour. |
| `schedule` | **Yes** | The overnight loop `auto-improve-loop.ts`. Ava picks its *own* goal each iteration via `suggestImprovement` (see §8) — but **only after** the friction ledger is drained (below). |
| `friction` | **Yes (new)** | The overnight loop mines the mistakes ledger (`listOpenMistakes` → `mistakeToGoal`) and creates a `trigger:"friction"` intent *before* asking Claude to invent ideas (`auto-improve-loop.ts`). |
| `failure` | **No (unwired)** | The type constant exists; nothing constructs an intent with it. (Self-improvement failures are recorded as *friction* entries, surface `"tool"`, not as `failure`-trigger intents.) |

### `friction.ts` — the mistakes ledger, now connected

`friction.ts` is the **mistakes ledger**: Ava's record of real friction (Ava was
corrected, a tool failed, the owner flagged something). It is a full module —
`recordMistake` (dedups recurrences and *reopens* a resolved mistake that recurs,
`friction.ts:41-64`), `listOpenMistakes` (worst-first by severity/count/recency),
`mistakeToGoal` (formats a mistake into a goal+evidence string for the worker,
flagging recurrences), and `resolveMistake`. The design intent, from the header:
*"This is what Ava brings to Claude on self-improve: grounded evidence, not
invented ideas."*

**Tonight this got wired into the pipeline** (it was previously referenced only by
its own test):

- **Writer.** `runImprovement`'s new `onFailed` hook records a mistake on a real
  failure (not a cancel). Both the live deps (`index.ts` `buildImproverDeps`) and
  the overnight loop supply it — so a self-improvement that fails leaves a ledger
  entry.
- **Reader.** Each overnight iteration calls `listOpenMistakes` and, if any exist,
  builds the goal from `mistakeToGoal` (`trigger:"friction"`) **before** falling
  back to `suggestImprovement`. A **shipped** friction fix calls `resolveMistake`
  (with the commit); a later recurrence reopens the entry so Claude digs deeper.

**Honest nuance (important).** The ledger's *only* writer today is
self-improvement's own failures, and the overnight loop explicitly **filters those
out** of its goal selection (`!m.summary.startsWith("self-improvement failed:")`)
so it doesn't spin re-fixing a failed fix. So the friction-first machinery is fully
live, but there is still **no wiring from Sir's actual friction** ("Ava was
corrected in a chat/voice turn" → `recordMistake`) into the ledger — that external
source is the missing piece. Net: the trigger, the drain, the resolve/reopen loop,
and the `npm run self:loop` launcher all exist and work; what they currently have
to chew on is limited to self-improvement's own history, minus itself. Don't yet
claim Ava "automatically learns from every mistake it makes with Sir."

---

## 4. The reflect step — goal → change brief (`reflect.ts`)

`reflect({ provider, goal, knowledge, failureLog, abort? })` asks the **LLM
provider** (via `provider.stream`, `reflect.ts:18-22`, `reasoningEffort: "medium"`) to turn
a one-line goal into a concise, minimal *change brief* — lines starting
`CHANGE:` (what to edit, which files) and `ACCEPTANCE:` (how a test/build proves
it). The system prompt is explicit: *"Do not write the code; describe the change
for a coding worker."* The repo root, test command, and the full body of
`SELF.md` are injected as context (`reflect.ts:11`), so the brief is grounded in
Ava's self-knowledge.

The `failureLog` parameter would let a retry feed the previous failure back in,
but as noted in §2 the orchestrator always passes `null` — there is no automatic
retry built on top of it yet.

`reflect` now accepts an optional `abort` signal and passes it straight to
`provider.stream({ …, abort: o.abort ?? new AbortController().signal })`
(`reflect.ts:7,21`). The orchestrator threads its per-improvement signal in here
(`improver.ts:112`), so a Stop/cancel aborts the LLM reflect call mid-stream — the
fallback throwaway controller is only used when no signal is supplied. (This was
previously a never-aborted throwaway, and was the first sign of the old
Stop-button gap; that gap is now closed — see §13.1.)

---

## 5. Isolation: the git worktree (`worktree.ts`)

The worker must never edit the live tree directly. `addWorktree(repoRoot, id)`
(`worktree.ts:28-42`):

1. `mkdtempSync` a fresh dir under the OS temp dir (`ava-imp-XXXX`).
2. `git worktree add -B self/<id> <path>` — a real, isolated checkout on its own
   branch.
3. **Junctions `node_modules` in.** A fresh worktree checks out source but not
   `node_modules` (gitignored), so `npm test` couldn't resolve vitest. Rather
   than reinstall, it `symlinkSync(..., "junction")`s the repo's existing root +
   each workspace `node_modules` into the worktree (`worktree.ts:32-40`) — instant
   and reuses already-built native modules.

`removeWorktree` (`worktree.ts:98-114`) is written carefully to avoid catastrophe:
it removes the `node_modules` **junctions first, non-recursively** —
`rmSync(recursive:false)` on a junction is a plain `rmdir` of the reparse point,
so it can *never* delete the real `node_modules` it points at — then
`git worktree remove --force` and deletes the `self/<id>` branch.

`pruneOrphanWorktrees(repoRoot)` (`worktree.ts:65-96`) is **boot cleanup** for
worktree state leaked by a crash mid-improvement: it `git worktree prune`s dead
admin entries and deletes any `self/*` branch **not** currently backing a live
worktree. Every step is best-effort/try-wrapped so a boot can never crash on it,
and it refuses to delete branches if it can't first enumerate the live worktrees
(so it never nukes a branch that is genuinely in use). It is called once at boot
from `index.ts:73`.

---

## 6. The verify gate (`verify.ts` + `verify-runner.ts` + `boot-smoke.ts` + `flightcheck.ts`)

This is the proof that the candidate is safe to ship. `verify({ cwd, run,
bootSmoke, signal? })` (`verify.ts`) runs, **in order** (cheapest signal first):

1. `npm test`
2. `npm -w web run build`
3. `npm -w server run build`
4. `bootSmoke(cwd)` — boot the freshly-built candidate and hit `/api/health`.

The first failing check short-circuits and returns `{ ok:false, log:"FAILED:
<cmd>\n<output>" }`. It also checks `signal?.aborted` before each command and
before the boot-smoke, returning `{ ok:false, log:"cancelled" }` early if a Stop
landed between checks (`verify.ts:13,17`).

### `verify-runner.ts` — the 10-minute wall + tree-kill + abort

`buildRunner(timeoutMs = 10*60_000)` returns the production `RunFn`, now
`(cmd, cwd, signal?)`. Each check is `spawn(cmd, { shell:true })`; output is
tail-capped at 16 KB. A `RUN_TIMEOUT_MS` of **10 minutes** caps each check so a
slipped `--watch` flag or a test awaiting input can't hang the whole pipeline and
pin its worktree forever. **On either a timeout or an external abort** it
**tree-kills** (`killTree(child.pid, "SIGTERM")`, `verify-runner.ts:23-26`) so the
`npm.cmd → node` subtree dies instead of orphaning node, then resolves a **failed**
RunResult (it never rejects — a timeout or a Stop is just a failed check). If the
signal is already aborted before the spawn, it resolves failed without starting
(`verify-runner.ts:19`). The abort listener is registered with `{ once:true }` and
removed on settle (`:31, 44`).

### `boot-smoke.ts` — does the built server actually start?

`bootSmoke(cwd)` boots `node dist/index.js` from the candidate's `server/` on a
**random scratch port** and a **temp `DATA_DIR`**, with `OPENAI_API_KEY: ""`, and
polls `/api/health` for up to 15 s (`boot-smoke.ts:10-27`). It proves the build
boots; the candidate's own `npm test` already covers auth + secret-scrubbing. It
always `child.kill()`s in `finally`.

### `flightcheck.ts` — a deterministic canary, REPORT-ONLY

`flightcheck({ cwd })` is a **deterministic, report-only** post-verify guard
(`flightcheck.ts:10-57`). It makes **no model or network calls** — just
file-existence/content checks against the built worktree:

- `web/dist/index.html` exists,
- `web/dist/sw.js` contains `skipWaiting` **and** `clients` (guards the
  stale-service-worker regression that made fixes look "still broken" on the
  phone),
- at least one hashed `index-*.js` in `web/dist/assets/`,
- `server/dist/index.js` exists.

**Crucially, flightcheck never gates the swap.** It is wired only into the live
`buildImproverDeps.verify` (`index.ts:167-176`), where its result is appended to
the log as `[flightcheck PASSED/FAILED report-only]` but `v.ok` is returned
**unchanged**. The overnight loop doesn't call it at all. Its origin and the
deliberate "Increment 1 = report-only" scoping are documented in
`docs/superpowers/plans/2026-06-06-ava-flightcheck.md`. The intent is to grow it
into a real gate later; today it only informs.

---

## 7. The swap and its guardrails (`swap.ts` + `safety-guard.ts`)

Shipping = moving the **live** branch onto the verified commit. The installation
path never resets or stashes concurrent work.

### Guard 1 — the safety-guard (`safety-guard.ts`)

`assertSwapSafe(repoRoot, lkg, sha)` (`safety-guard.ts:23-31`) diffs the candidate
against last-known-good and **throws** if any changed file matches `SAFETY_RE`
(`safety-guard.ts:9-10`). `SAFETY_RE` is the **single source of truth** (imported
by both the live path and the overnight loop) and refuses changes that touch:

- `…/security/…`, `…/policy/…`, `…/auth/…`
- the self-improvement machinery itself: `self/verify`, `self/swap`,
  `self/watchdog`, `self/boot-smoke`, `self/improver`, `self/suggest`,
  `self/claude-session`, `self/auto-improve`, `self/model-policy`, `self/intents`,
  `self/safety-guard`
- `approval`, `settings.local`, `.claude/`, `path-allowlist`, `workerEnv`, `scrub`

The principle (header comment, `safety-guard.ts:4-8`): **Ava must not hot-swap a
change that weakens its own guardrails.** A blocked change throws → the intent is
marked `failed` rather than the weakened guardrail going live.

> A second, *advisory* application of `SAFETY_RE` exists in the overnight loop: it
> also pattern-checks the *goal text itself* before even starting
> (`auto-improve-loop.ts:127`), skipping goals that name a safety-critical area.
> That's a cheap early filter; `assertSwapSafe` on the actual diff is the real
> enforcement.

### Guard 2 — non-destructive fast-forward and resumable recovery (`swap.ts`, `worktree.ts`)

`swapTo(repoRoot, sha)` installs only a pure fast-forward using
`git merge --ff-only`. Disjoint tracked edits remain untouched; overlapping
tracked paths block before Git is called, and Git safely refuses untracked-file
collisions. The code never uses `reset --hard` or an automatic stash to install.

After verification, a durable internal ref keeps the candidate reachable. A
blocked installation therefore records `status="blocked"` and remains resumable
after the temporary worktree is removed or AVA restarts. `POST
/api/self/:id/resume-swap` is guarded by the exact candidate SHA and repository
HEAD displayed by Self. If HEAD advanced, AVA creates a fresh recovery worktree,
replays the approved candidate, reruns the complete verification gate, and only
then attempts installation. Ordinary content conflicts remain blocked. The sole
automatic conflict rule is an append-only union for `coord/BOARD.md`, and it is
accepted only when both histories are literal extensions of the same parent.

### Reverting (`swap.ts:32-53`)

`revertTo(repoRoot, sha, expectedHead?)` is the **backward** reset (it undoes a
bad swap), so it deliberately does **not** enforce fast-forward. It *is* guarded
against clobbering newer work: if you pass `expectedHead` and HEAD has moved past
it (someone committed after the swap), the revert is **skipped** (returns
`false`, logs a warning) rather than resetting over the new commits. The watchdog
passes `expectedHead`; the manual revert route does **not** (see §9).

---

## 8. The two driving paths

### 8a. Live / interactive (`server/src/index.ts`)

- Boot reconciliation: `failStaleIntents(db)` marks ordinary work left
  non-terminal by a previous restart as `failed` — and that set includes
  `awaiting_approval` (`intents.ts:42`), so a plan left waiting for approval when
  the process died is reconciled rather than left forever-pending; the in-flight
  lock and the parked-plan resolver are in-memory, so at boot nothing is genuinely
  running. A `recovering` row with a candidate returns to `blocked` instead, and
  legacy verified dirty-tree swap failures are migrated to that resumable state.
  Candidate refs are restored before orphan branches are pruned.
  `pruneOrphanWorktrees` cleans the leaked git state; `failStaleDiscussions`
  does the same for background consults.
- `buildImproverDeps()` (`index.ts:150-227`) wires the live deps. Notable: it sets
  `requireApproval = (intent) => intent.trigger === "explicit"` and an
  `onAwaitingApproval` that pushes the user via `notifyDone` (`index.ts:154-158`),
  so **user-triggered improvements gate behind plan approval**; `implement` passes
  the abort `signal` and runs the worker in the throwaway worktree and **does not**
  use the persistent Claude session (sessions are directory-scoped; resuming from a
  fresh worktree fails — `index.ts:165-173`); `verify` appends the report-only
  flightcheck; `restart` is a no-op because `tsx watch` reloads when `swapTo`
  rewrites the working tree (pm2/prod restart is noted as a follow-up).
- Self-route control wiring includes `cancel → cancelImprovement`,
  `approve → approveImprovement`, `reject → rejectImprovement` are passed into
  `selfRoutes` alongside `startImprovement`, `revert`, repository-HEAD reporting,
  and the version-guarded `resumeSwap` boundary.
- Entry points: `queueSelfImprove(goal)` (`index.ts:226`) used by the
  `self_improve` tool, and `startImprovement(id)` (`index.ts:221`) used by the
  HTTP route. Both call `runImprovement` fire-and-forget, wrapped so a thrown
  watchdog/await never becomes an unhandled rejection.

### 8b. Overnight autonomous loop (`server/scripts/auto-improve-loop.ts`)

A detached driver that lets Ava improve itself unattended, launched with
**`npm -w server run self:loop`** (the script added tonight; previously the loop
had no entry point). Each iteration (`auto-improve-loop.ts`):

1. **Friction first.** Drain the mistakes ledger: `listOpenMistakes(memoryDir)`,
   filtered to exclude entries whose summary starts `"self-improvement failed:"`
   (so a failed fix isn't re-attempted on repeat). If any remain, the **worst one**
   becomes the goal via `mistakeToGoal` and the intent is created
   `trigger:"friction"`. Grounded evidence beats invented ideas.
2. **Else, invent.** With an empty ledger, fall back to `suggestImprovement(advisor,
   …)` — Ava asks its **persistent Claude session** (run in the *stable repo dir*,
   not a worktree, so the session resumes and Claude remembers prior suggestions to
   avoid repeats) for ONE concrete, low-risk improvement, returning a `GOAL:` line
   or `none` (`suggest.ts`). The prompt hard-bans changes to
   safety/verification/approval/sandbox/scrub/self-loop code. Intent is
   `trigger:"schedule"`.
3. If the goal matches `SAFETY_RE`, skip it. Otherwise `createIntent(…)` →
   `runImprovement(db, id, deps)`.
4. **On ship, close the loop.** A `swapped` outcome bumps the shipped count, and if
   the goal came from the ledger, `resolveMistake(memoryDir, frictionId, commit)`
   marks that entry fixed (a recurrence later reopens it). A shipped change also
   appends the changelog via `onSwapped`; a failure records a fresh friction entry
   via `onFailed`.
5. Stop conditions: Claude credits exhausted (`/credit balance.*too low/`),
   `MAX_CONSEC_FAILS` (default 6) consecutive non-ships, `MAX_ITERS` (default 60),
   or Ava proposing `none` with an empty ledger.

Note the loop uses **two** Claude workers with different allowlists
(`auto-improve-loop.ts:55-64`): the *edit* worker (`selfClaudeCode`) is restricted
to cwds under the OS temp dir (i.e. worktrees only); the *advisor* worker is
restricted to the repo root (so the session resumes correctly). The advisor
chooses ideas (in the repo), the editor implements them (in a worktree).

---

## 9. The watchdog — auto-rollback of a bad swap (`watchdog-main.ts` + `watchdog.ts`)

After a successful swap, `deps.watch(knownGood, swapped)` spawns
`watchdog-main.ts` **detached** (`spawn(... { detached:true, stdio:"ignore" })`,
`index.ts:205-217` / `auto-improve-loop.ts:95-104`):

```
tsx watchdog-main.ts <repoRoot> <knownGood> <healthUrl> <timeoutMs=45000> <swappedSha>
```

It must be detached precisely because the **server it is watching is about to
reload onto the new code** — the watchdog has to outlive that reload.
`decideRollback` (`watchdog.ts`) polls `checkHealth` (`GET /api/health`) every
second until `timeoutMs` (45 s). If health ever returns OK → it returns and does
nothing (the change stays live). If the deadline passes without health → it calls
`rollback`, which is `revertTo(repoRoot, knownGood, swappedSha)`
(`watchdog-main.ts:17`). In dev, that `git reset --hard` back to last-known-good
re-triggers the tsx watcher, which reloads the server back to safety.

The `swappedSha` is passed as `expectedHead` so that if **newer work was
committed on top** in the 45 s window, the rollback is **skipped** rather than
destroying it (§7, Guard 2).

---

## 10. State + records (`intents.ts`, schema, `dev-log.ts`)

### `self_improvements` table (`state/schema.sql:124-137`, typed in `intents.ts:9-14`)

`id, created_at, trigger, goal, status, branch, commit_sha, last_known_good,
diff_summary, verify_log, outcome, error, worker_provider,
worker_selection_version`. `self_worker_settings` separately stores the
versioned default for future intents. Helpers: `createIntent` (inserts
`status='queued'`), `getIntent`, `listIntents` (newest first), `updateIntent`
(dynamic patch), and `failStaleIntents` (boot reconciliation, `intents.ts:38-46`).

### `dev-log.ts` — the Claude→Ava changelog (a *separate* thing)

Do not confuse this with the self-improvement intents. `dev-log.ts` is the
append-only **JSON-lines log Claude (the human's coding agent, i.e. the assistant
writing this doc) writes by hand** to narrate changes it makes to Ava, via
`scripts/claude-note.ts`. Ava reads it back with a `read_claude_updates` tool and
relays it honestly ("Claude shipped X"). `appendDevLog` stamps a `ts` and appends;
`readDevLog` tolerates malformed lines; `currentInProgress` finds the latest
`started` with no later `shipped`. It is plumbing for honest attribution between
the two actors, not part of the autonomous pipeline.

### `changelog.ts` — Ava's self-evolution record (yet another *separate* thing)

New tonight, and distinct from both the intents table and `dev-log.ts`.
`changelog.ts` maintains `memory/changelog.md`: on **every successful swap**,
`runImprovement`'s `onSwapped` hook calls `appendChangelog(memoryDir, { summary:
intent.goal, commit: sha })`, adding one dated line. Two purposes (header comment):
Ava stays aware of how it has changed **without re-reading its own code**, and
`readChangelog` can hand recent history to the Claude worker so it doesn't undo
past fixes. It is best-effort — wrapped in a `try/catch` so a changelog write can
never fail a shipped improvement. (Contrast: `dev-log.ts` is what *Claude the human's
coding agent* writes by hand; `changelog.md` is what *Ava's autonomous pipeline*
writes on every ship. Different authors, different files.)

### `identity.ts` + `SELF.md`

`loadSelfKnowledge({ repoRoot })` (`identity.ts:8-17`) returns the repo root, the
test/build/dev commands, and the full body of `SELF.md` (Ava's hand-written
self-description: module map, conventions, commands). This is the context block
injected into every `reflect` brief, so the change brief is grounded in how the
repo is actually laid out.

---

## 11. The UI (`web/src/self/` + `routes/self.ts`)

- **`routes/self.ts`** exposes the token-authenticated intent endpoints plus a
  version-guarded worker selector:
  `POST /api/self/improve` (create + start, `trigger:"explicit"`; now returns
  **409 `paused`** if self-improvement is paused),
  `GET /api/self` (list all intents plus `paused`, the selected worker version,
  honest Claude/Codex CLI availability, and the current repository HEAD),
  `POST /api/self/worker` (select the worker for future intents using
  `expectedVersion`; stale or unavailable selections return 409),
  `POST /api/self/pause` (**new**: set the server-side pause gate via
  `setImprovementsPaused`, `self.ts`),
  `POST /api/self/:id/cancel` (cancel a running/queued improvement →
  `cancelImprovement`, `self.ts:29-34`),
  `POST /api/self/:id/approve` and `POST /api/self/:id/reject` (settle a plan
  parked at `awaiting_approval` → `approveImprovement`/`rejectImprovement`,
  `self.ts:35-46`),
  `POST /api/self/:id/resume-swap` (retry installation of a preserved verified
  candidate with required candidate-SHA and repository-HEAD stale guards),
  `POST /api/self/:id/revert` (revert one intent to its `last_known_good`, set
  `status="rolled_back"`).
- **`useSelfJournal.ts`** polls `GET /api/self` every 4 s and exposes
  `revertLast()` (reverts the most recent `swapped` intent), `cancel` / `approve` /
  `reject` (a generic `act(id, action)` that POSTs the matching route then
  refreshes), and — new tonight — **`improve(goal)`** (POSTs the initiator goal,
  surfacing a 409 as *"self-improvement is paused"*) and **`setPaused(next)`**
  (optimistically flips the UI, POSTs `/api/self/pause`, reconciles from the
  response and the next poll). `resumeSwap(intent)` submits the displayed
  candidate and repository revisions, surfaces stale/busy failures, and refreshes
  the journal boundary. It also reads the server's `paused` flag back and
  tolerates three response shapes (`improvements`/`intents`/bare array) so the UI
  never breaks mid-deploy. Two helpers: `isRunningStatus(status)` gates the Stop
  button; `planText(diffSummary)` strips the `PLAN:` prefix. The polled `Intent`
  type carries `diff_summary` so the parked plan is available client-side.
- **`SelfScreen.tsx`** (reachable from the app) shows the journal — each intent's
  goal + status + outcome — plus:
  - **an initiator box** (new): *"Tell Ava what to improve about herself…"* → a
    text field + **Improve** button that calls `improve(goal)`; a failure (e.g.
    paused) renders inline.
  - a **Pause/Resume** toggle (now **real** — it drives the server gate) with an
    `ACTIVE`/`PAUSED` chip in the header and a second `PAUSED` chip over the journal.
  - a **Revert last** button, a red **Stop** button on any running intent, and for
    an `awaiting_approval` intent a *"Plan — review before it runs"* panel rendering
    the parked plan with **Approve & run** / **Reject** buttons.
  - a prominent **verified update not yet installed** card for `blocked` intents,
    with the recorded failure boundary and **Retry safe installation**.

> **UI honesty caveats:**
> - **"Pause" is now real (fixed tonight).** Tapping Pause POSTs `/api/self/pause`,
>   which flips a **server-side gate** (`setImprovementsPaused` in `improver.ts`).
>   While paused, both intake points refuse new work — `POST /api/self/improve`
>   returns 409 and the `self_improve` chat tool throws — so Ava genuinely won't
>   *start* a new improvement. **Three honest limits remain:** (1) the pause flag is
>   **in-memory**, so a server restart resets it to *active*; (2) it gates *intake*
>   only — an already-running improvement finishes (use **Stop** to cancel that);
>   (3) it lives in the live process, so it does **not** reach the separate
>   overnight-loop process. (Distinct from the **Stop** button, which cancels a
>   running improvement via `/cancel`.)
> - **"Revert last" is real but unguarded.** The route-level revert
>   (`index.ts:325`) and the `selfRoutes` revert both call `revertTo(repoRoot,
>   last_known_good)` **without** `expectedHead`, so it is an unconditional
>   `git reset --hard` back to last-known-good — it will happily reset over any
>   newer commit. (Contrast the watchdog's guarded revert.) It also doesn't
>   restart explicitly; it relies on the dev watcher to reload.

---

## 12. Step-by-step: a self-improvement, end to end

The concrete sequence for an **explicit** improvement ("Ava, improve yourself by
doing X"):

1. **Trigger.** The agent calls the `self_improve` tool with `{ goal: "X" }`
   (`tools/self-improve-mcp.ts`). → `queueSelfImprove("X")` →
   `createIntent(trigger:"explicit")` inserts a `queued` row →
   `startImprovement(id)` → `runImprovement(db, id, liveDeps)` fire-and-forget.
2. **Slot.** If another improvement holds `inFlight`, this id parks on `pending`
   and stays `queued`; otherwise it takes the slot.
3. **Reflect.** `status=reflecting`. The **LLM provider** turns "X" + `SELF.md`
   context into a `CHANGE:/ACCEPTANCE:` brief.
3a. **Approval gate (explicit only).** Because `requireApproval(intent)` is true
   for an explicit trigger, `status=awaiting_approval`: the plan is parked in
   `diff_summary` (prefixed `PLAN:`), you get a push, and the run **waits**. The
   single-flight slot is held meanwhile. You **Approve & run** (→ continue) or
   **Reject** (→ `failed`, `outcome="rejected"`); a **Stop** here ends it with
   `outcome="cancelled"`. (The overnight/`schedule` path skips this step.)
4. **Worktree.** `status=implementing`. A temp worktree on branch `self/<id>` is
   created and `node_modules` junctioned in.
5. **Implement.** The intent's approval-locked **Claude Code or Codex worker** edits
   that worktree through the provider-neutral adapter boundary. Claude uses
   non-interactive print mode with `acceptEdits`; Codex uses non-interactive
   `codex exec` with `workspace-write` and receives the brief on stdin. Brief +
   sanitized bounded worker evidence are saved to `diff_summary`. A missing CLI,
   login/provider failure, no-op, or worker error fails the intent here without
   silently falling back.
   The worker has a configurable hard execution budget
   (`SELF_WORKER_TIMEOUT_MINUTES`, default 60, range 1-120). A timeout tree-kills
   the worker, records sanitized terminal evidence, and cannot advance to
   verification. Stop remains independently immediate.
6. **Verify.** `status=verifying`. `npm test` → `web build` → `server build` →
   boot-smoke, each capped at 10 min and tree-killed **on timeout or a Stop**.
   Output saved to `verify_log`. (flightcheck also runs, report-only, appended to
   the log.) Any failure fails the intent.
7. **Capture + commit.** `knownGood = HEAD` (now); commit the worktree as
   `self: X` → `sha`. Persist `last_known_good`, `commit_sha`, `branch`.
8. **Safety guard.** `assertSwapSafe(repoRoot, knownGood, sha)` — if the diff
   touches any safety-critical file, throw → intent `failed`.
9. **Safe install.** Preserve the verified candidate ref, then call `swapTo`.
   A clean path uses `git merge --ff-only`. An overlap, stale HEAD, or Git refusal
   leaves the intent `blocked` with the candidate intact. An explicit retry uses
   stale guards; if HEAD advanced, it replays the candidate in a fresh worktree
   and reruns the full verification gate before trying again.
10. **Ship + watch.** `status=swapped`, `outcome="shipped"`. Spawn the detached
    watchdog `(knownGood, sha, 45s)`. `restart()` (no-op; tsx watch reloads onto
    the new code).
11. **Watchdog verdict.** For 45 s the watchdog polls `/api/health`. Healthy →
    the change stays live (final state `swapped`). Never healthy → `revertTo
    knownGood` (skipped if newer work landed) — git is rolled back, but the DB row
    stays `swapped` (see caveat below).
12. **Cleanup.** `finally` deletes the run's `AbortController`, removes the
    worktree, and frees the slot to the next `pending` id.

> **Stopping at any point.** During reflect/awaiting_approval/implement/verify
> (steps 3–6), pressing **Stop** — the per-intent Stop button (`/cancel`) or the
> red global Stop button (`/kill-all` → `cancelAllImprovements`) — aborts the run: the
> reflect LLM call is cancelled, the Claude worker and the verify subprocess are
> tree-killed, and the intent ends `status="failed"`, `outcome="cancelled"`. A
> *queued* (not-yet-running) improvement is simply dropped from `pending` and
> marked cancelled. See §13.1.

---

## 13. HONEST CAVEATS (verified against code)

These are real, current limitations — documented because precise > flattering.

1. **~~The Stop / red button does NOT stop a self-improvement.~~ RESOLVED
   (commits 0bd8b93 + c539c75).** This was the headline gap; it is now fixed in
   both directions. See `docs/features/self-improve-stop-and-gate.md` for the full
   feature write-up. Specifically:
   - `runImprovement` now constructs a per-improvement `AbortController`, registers
     it in a module-level `controllers` map by intent id (`improver.ts:103-105`),
     and threads the signal into `reflect` (`:112`), `implement` (`:142`), and
     `verify` (`:150`), with `throwIfAborted()` checks between stages.
   - Its `implement` step passes the `signal` to `selfClaudeCode.run({ …, signal })`
     (`index.ts:171`, `auto-improve-loop.ts:75`), so the long pole — the Claude
     worker editing code — **can** be interrupted; the verify subprocess is
     tree-killed on abort (`verify-runner.ts:43`); and `reflect` forwards the signal
     to `provider.stream` instead of a throwaway (`reflect.ts:21`).
   - The red Stop button reaches it: `POST /api/chat/:sessionId/kill-all` calls
     `cancelAllImprovements(db)` (`routes/chat.ts:519`), aborting every running
     improvement and clearing the queue. There is also a per-intent cancel route
     `POST /api/self/:id/cancel` (`routes/self.ts:29-34`) wired to
     `cancelImprovement` (`index.ts:326`), surfaced as a **Stop** button on any
     running improvement in the Self screen (`SelfScreen.tsx:73-80`).
   - A cancel is recorded as `status="failed"`, `outcome="cancelled"`
     (`improver.ts:168-170, 74, 87`) — distinct from an ordinary failure.

   **Net:** an in-flight self-improvement can now be cancelled from the UI (the
   per-intent Stop or the red global Stop). *Caveat:* the live server's
   `cancelAllImprovements` only reaches improvements running **in its own process** —
   it cannot stop a job inside the separate overnight-loop process (which is meant
   to run while the interactive path is idle).

   **And a new front-door guard:** a *user-triggered* improvement now drafts its
   plan and **parks at `awaiting_approval`** until you approve it
   (`improver.ts:118-138`; `requireApproval = trigger==="explicit"`,
   `index.ts:154`), so a self-edit no longer even begins writing code unseen. The
   unattended overnight loop is intentionally **not** gated. See §13.7 below and the
   feature doc.

2. **Boot reconciliation fails ordinary stale work but preserves verified
   recovery candidates.** `failStaleIntents` marks
   intent left in `queued/reflecting/awaiting_approval/implementing/verifying` as
   `failed` on boot, on the assumption that the in-memory lock means nothing was
   truly running. That is correct for genuinely-orphaned intents (including a plan
   left parked at `awaiting_approval`, whose in-memory resolver is gone after a
   restart), but it is a blunt instrument: an intent that was mid-`verifying` when
   the process died is marked `failed` even if a partial effect occurred, and the
   error is a generic "interrupted by a server restart". A `recovering` row with
   a candidate instead returns to `blocked`, and candidate refs are recreated at
   boot. An intent already at `swapped` is left as-is. (Also note:
   if a restart happens *during* the watchdog window, reconciliation does not re-arm
   a watchdog — the detached watchdog process is the only thing tracking that swap.)

3. **An automatic watchdog rollback does not update the intent status.** When the
   watchdog reverts an unhealthy build, it rewrites git (`revertTo`) but nothing
   writes `status="rolled_back"` to the DB. The intent stays `swapped`
   (`outcome="shipped"`) even though the code was rolled back underneath it. Only
   the **manual** revert route sets `rolled_back`. So the journal can show
   "shipped (live)" for a change the watchdog has actually undone.

4. **The `friction` trigger is now wired; the ledger's only source is still
   self-improvement's own failures (fixed partially tonight).** `recordMistake` now
   has production callers (`onFailed` on both driving paths), the overnight loop
   drains the ledger into `trigger:"friction"` intents before inventing ideas, and
   a shipped friction fix resolves its entry (§3, §8b). **But** the sole writer is
   self-improvement failures — which the loop deliberately filters out — so there is
   still no path from *Sir's* real friction (a correction in chat/voice) into the
   ledger. The plumbing is live; an external writer is the missing piece. The
   `failure` *trigger* constant remains unused (such failures are recorded as
   `friction` entries instead).

5. **No reflect-on-failure retry.** `reflect`'s `failureLog` parameter and the
   reflect prompt both anticipate feeding a prior failure back for another
   attempt, but `runImprovement` always passes `null` — a failed verify ends the
   intent; it is not automatically retried with the failure as context.

6. **"Pause" is now a real server gate (fixed tonight), with three limits.** The
   SelfScreen Pause toggle POSTs `/api/self/pause` → `setImprovementsPaused`, which
   makes both intake points (`POST /api/self/improve` and the `self_improve` tool)
   refuse new work while paused (§11). The limits: the flag is **in-memory** (a
   restart resets it to active), it gates **intake only** (a running improvement
   finishes — use Stop), and it doesn't reach the **overnight-loop process**.

7. **The approval gate holds the single-flight slot while it waits.** While a
   user-triggered improvement is parked at `awaiting_approval`, the run is blocked
   on an `await` inside `runImprovement`, so `inFlight` stays `true` and **every
   other improvement queues behind it** (`improver.ts:100, 122-126`). A plan you
   leave un-actioned therefore **stalls the whole self-improvement queue** until you
   approve, reject, Stop it, or restart (only then does the `finally` free the slot,
   `:175-182`). This is deliberate — it keeps "one improvement touches the tree at a
   time" true across the human pause — but a forgotten plan is a soft wedge. Reject,
   cancel, and restart all release it promptly.

8. **Two records now written on every ship/fail (new tonight).** A successful swap
   appends `memory/changelog.md` (`onSwapped` → `appendChangelog`); a real failure
   records a `memory/friction.json` entry (`onFailed` → `recordMistake`). Both are
   best-effort (`try/catch`) so neither can break the pipeline (§10). Previously the
   changelog module existed but was never invoked.

---

## 14. Unresolved questions / things to confirm with the owner

- ~~**Should the Stop button reach self-improvements?**~~ **Answered: yes —
  implemented** (commits 0bd8b93 + c539c75; see §13.1 and
  `docs/features/self-improve-stop-and-gate.md`). The remaining open piece is
  whether the *overnight-loop process* should also be remotely stoppable from the
  live server (today `cancelAllImprovements` only reaches the live process's own
  improvements).
- **Should the watchdog rollback write `rolled_back`?** Today the journal can lie
  ("shipped") after an auto-revert. Likely a small, high-value fix.
- ~~**Is the friction ledger meant to be live?**~~ **Now live** (commit c3bd23b):
  the overnight loop drains it into `friction`-trigger intents and resolves them on
  ship (§3, §8b). The **open** question is what should *feed* it beyond
  self-improvement's own failures — should a chat/voice correction (Ava got
  something wrong, Sir fixed it) call `recordMistake`? That external writer is the
  remaining gap between "the ledger is wired" and "Ava learns from every mistake."
- **Live vs overnight flightcheck divergence:** flightcheck runs (report-only) on
  the live path but not in the overnight loop. Intentional, or an oversight?
- **`restart()` is a no-op everywhere**, relying on `tsx watch` (dev). The code
  comments call a real pm2/prod restart a "follow-up" — is production self-improve
  in scope, and if so how does the swap reload a non-watch process?
