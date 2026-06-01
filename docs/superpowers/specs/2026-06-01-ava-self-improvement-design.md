# Ava Self-Improvement — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with user

## 1. Summary

Give Ava the ability to improve its own code. Ava reflects on a goal or a failure,
uses its existing `claude_code` tool to edit its **own** source, verifies the change
in isolation, and ships it to the running process — autonomously — with a hard
guarantee that it can never brick itself.

This spec covers **Phase 1: the safety spine**, driven by the *explicit* trigger
("Ava, improve yourself so you can X"). Autonomous triggers and richer reflection
are Phases 2–3 (§12), built on the same machinery once it is proven.

## 2. User-chosen parameters (requirements)

These were decided during brainstorming and are binding requirements:

1. **Autonomy:** fully autonomous — no per-change human approval in the loop.
2. **Deploy model:** verify-then-swap + auto-rollback. The change is verified in
   isolation; the live process switches only if all checks pass; it auto-reverts
   if the new version fails to come up.
3. **Triggers (end state):** failed/clumsy task, explicit request, repeated
   friction, and proactive/scheduled. **Phase 1 implements only the explicit
   trigger**; the rest are Phase 2.
4. **Scope of self-edit:** nothing is permanently off-limits — Ava may edit any
   part of itself, including the improvement harness and auth.

## 3. Goals & non-goals

**Goals (Phase 1)**
- Ava edits its own repository to satisfy an explicit improvement goal.
- A change reaches the running process only after passing tests + build + a boot
  smoke-test, and is automatically rolled back if it fails to run live.
- Every attempt is journaled and visible; a kill switch and manual revert exist.

**Non-goals (Phase 1)**
- Autonomous triggers (Phase 2).
- Auto-generated self-knowledge / repo indexing (Phase 3; Phase 1 uses a curated
  `SELF.md`).
- Multi-change concurrency (one self-improvement at a time, globally).
- Multi-machine / cloud deploy (targets the local Windows process).

## 4. Why "nothing off-limits" is still safe

Safety comes from a **process invariant**, not from fencing files:

> The currently-running, known-good Ava is always the verifier. A candidate change
> — even one that rewrites the harness or auth — must pass the **old** harness's
> tests + build + boot smoke-test before it is swapped in, and the **old** code
> keeps running (via the transient watchdog) until the new version proves healthy.

Therefore nothing is permanently fenced, yet nothing un-bootable can ship. The
**boot smoke-test is the real safety surface** and must exercise the things whose
breakage would be catastrophic: process startup, an auth round-trip, and the
secret-scrubber (§9).

## 5. Architecture (Approach A: in-process loop + transient watchdog)

The loop runs as a module inside the Ava server, reusing existing infrastructure
(`claude_code`, build/test scripts, memory, SSE, pidfiles, process manager). The
only external piece is a **transient watchdog**: a short-lived detached process
spawned at swap time that guarantees rollback even if the new process is dead. It
is not a permanent sidecar — it exists only across a single swap and then exits.

Chosen over a permanent sidecar (more infra, IPC) and over "Claude Code drives the
whole loop" (too little control/observability over verification). See §13.

## 6. The loop

One self-improvement at a time (global single-flight lock). Steps:

1. **Reflect** — `self/reflect.ts`: turn the goal (+ relevant failure logs +
   `SELF.md`) into a concrete change brief with acceptance criteria. Output is the
   `claude_code` prompt.
2. **Isolate** — `self/worktree.ts`: `git worktree add` a throwaway worktree on
   branch `self/imp-<id>`. The live tree is untouched.
3. **Implement** — the existing `claude_code` tool runs with `cwd` = the worktree.
4. **Verify** — `self/verify.ts`: in the worktree, run `npm test` (server + web) +
   `tsc` typecheck + web/server build + the **boot smoke-test** (§9). Capture
   pass/fail + logs.
5. **Gate** — on any failure: destroy the worktree, journal the logs, mark
   `failed`. One reflect-and-retry with the failure log, then stop.
6. **Swap** — `self/swap.ts`: record current HEAD as `last_known_good`, then
   fast-forward the live working tree to the verified commit.
7. **Restart + watchdog** — spawn the transient detached **watchdog**
   (`self/watchdog.ts`) just before triggering the restart. It waits for the new
   process to report healthy within `T` seconds; if not, it
   `git checkout last_known_good` + restarts, then exits.
8. **Journal** — write outcome (diff summary, commit, verify log, result) to the
   `self_improvements` row + a memory note + SSE events to the Self screen.

## 7. Components / module map

All under `server/src/self/` with co-located tests (repo TDD convention):

- `identity.ts` — reads `self/SELF.md`, exposes Ava's architecture/build/test/run
  commands + repo path for the reflect step.
- `intents.ts` — CRUD over the `self_improvements` table (§8).
- `reflect.ts` — goal + context → change brief (LLM).
- `worktree.ts` — create/cleanup git worktrees.
- `verify.ts` — run tests/typecheck/build + boot smoke-test; returns a structured
  result + logs.
- `swap.ts` — record `last_known_good`, fast-forward the live tree, expose revert.
- `watchdog.ts` — the transient detached health-check-and-rollback supervisor.
- `improver.ts` — orchestrates the loop; owns the single-flight lock; emits events.
- Tool + route: a `self_improve` tool (so Ava can call it mid-conversation when you
  say "improve yourself…") and `POST /api/self/improve { goal }`.
- Web: `web/src/self/SelfScreen.tsx` — journal + Pause + Revert-last (§10).
- `self/SELF.md` — curated architecture map (static in Phase 1).

## 8. Data model

New SQLite table `self_improvements`:

| column          | type    | notes |
|-----------------|---------|-------|
| id              | text PK | nanoid |
| created_at      | integer | epoch ms |
| trigger         | text    | `explicit` (Phase 1); later `failure`/`friction`/`schedule` |
| goal            | text    | the improvement goal |
| status          | text    | `queued`→`reflecting`→`implementing`→`verifying`→`swapped` \| `failed` \| `rolled_back` |
| branch          | text    | `self/imp-<id>` |
| commit_sha      | text    | verified commit, if any |
| last_known_good | text    | HEAD before swap |
| diff_summary    | text    | short summary of the change |
| verify_log      | text    | tail of the verify output (scrubbed) |
| outcome         | text    | human-readable result |
| error           | text    | failure reason, if any |

## 9. Safety model

- **Boot smoke-test** (the safety surface): start the built candidate on a scratch
  port with a temp `DATA_DIR`; poll `/api/health`; perform a real pairing→token
  auth round-trip; assert the secret-scrubber unit passes; then shut down. Failure
  ⇒ change discarded before any swap.
- **Transient watchdog:** guarantees recovery from a live-only failure that slipped
  past verify (e.g., environment/data differences). Runs the *old* code path; on
  health-check failure it checks out `last_known_good` and restarts.
- **Single-flight lock:** only one self-improvement runs at a time.
- **Isolation:** all edits happen in a worktree; the boot smoke-test uses a scratch
  port + temp data dir and never touches live state.
- **Timeouts:** on `claude_code`, on verify, on the boot smoke-test, on the
  watchdog health wait.
- **Secrets:** `.env` remains hard-blocked from tool paths (existing
  `classifyRisk`); all journaled logs pass through `scrubSecrets` (existing).
- **Never crash the host:** every step is wrapped; failures journal + abort the
  attempt, never take down the running server.

## 10. Control surface

`SelfScreen` in the PWA:
- **Journal:** queued / in-progress (live steps via SSE) / history with diff
  summaries + outcomes.
- **Pause self-improvement:** kill switch (halts the loop; in Phase 2 also halts
  autonomous triggers).
- **Revert last self-change:** manual rollback to the previous `last_known_good`.

Visibility + kill switch only — no per-change approval, per the autonomy choice.

## 11. Error handling & edge cases

- Worktrees are always cleaned up (success or failure).
- A verify failure after `claude_code` triggers exactly one reflect-and-retry.
- If the swap itself fails (e.g., dirty live tree), abort without restarting.
- If the watchdog cannot reach health within `T`, it rolls back and journals.
- Concurrent explicit requests queue behind the single-flight lock.

## 12. Phasing

- **Phase 1 (this spec):** explicit-trigger safety spine + Self screen.
- **Phase 2:** autonomous triggers feeding the intent queue — a failed-task hook
  (run errors / stuck-loop halt / user correction), a repeated-friction detector
  (recurring failure patterns), and a scheduler. Reuses the entire Phase-1 loop.
- **Phase 3:** richer reflection + multi-attempt strategies; auto-generated
  self-knowledge (repo indexing) replacing the static `SELF.md`.

## 13. Decisions log

- **Autonomous, no approval gate** — user choice; the safety net is automated
  (verify + rollback), not human sign-off.
- **Verify-then-swap + transient watchdog over edit-live-and-restart** — the latter
  can brick the agent on one bad edit; the chosen model cannot.
- **Transient watchdog over a permanent sidecar** — same recovery guarantee with no
  always-on second process and far less infrastructure/IPC.
- **In-process loop (Approach A) over a full sidecar or "claude_code does it all"** —
  maximum reuse of existing tools + best observability, while the watchdog supplies
  the isolation that matters (recovery).
- **Nothing fenced, safety via process invariant** — honors the user's
  "nothing off-limits" while still preventing un-bootable ships, by making the
  incumbent verify the candidate.
- **Explicit trigger first, autonomy in Phase 2** — proves the dangerous machinery
  under direct control before it runs unattended.

## 14. Open questions / risks

- **Restart mechanism on Windows:** dev uses `tsx watch` (auto-reload on file
  swap); prod uses pm2. The watchdog must handle both restart paths. To pin during
  planning.
- **Boot smoke-test fidelity:** must be representative enough that "passes in
  isolation" reliably predicts "runs live." Auth + scrubber + health are the
  minimum; more may be added.
- **claude_code self-edit quality:** the worker editing Ava's own code is only as
  good as the brief + acceptance criteria from reflect; verify is the backstop.
