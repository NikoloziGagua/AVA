# Self-improvement worker selector

AVA can explicitly choose **Claude Code** or **Codex** as the implementation
worker for new self-improvement requests. The choice lives in the Self screen.
It does not change the approval, verification, or release policy.

## Contract

- `self_worker_settings` stores one versioned global selection. Writes to
  `POST /api/self/worker` include `expectedVersion`; a stale write returns
  `409 stale_version` with current state.
- Every new `self_improvements` row snapshots `worker_provider` and
  `worker_selection_version`. Switching the global choice never changes queued,
  awaiting-approval, running, or historical intents.
- `GET /api/self` returns the selection and both CLI availability records.
  `installed` means the executable answered `--version`. Configuration is
  reported as `not_checked` because an availability probe does not spend a model
  call or prove account authentication. Sign-in is tested only when an approved
  run starts.
- Selecting or starting with an unavailable worker fails closed. AVA never
  silently falls back to the other provider.

## Identical safety pipeline

The provider-neutral adapter boundary is the single `implement` stage in
`runImprovement`:

1. AVA drafts a plan.
2. Explicit requests wait at `awaiting_approval`.
3. The selected adapter edits only the isolated temporary git worktree.
4. The existing test/build/boot-smoke verification runs.
5. The same expected-HEAD, safety guard, scoped commit, swap, watchdog, and
   rollback behavior applies.

Claude Code uses non-interactive print mode with `acceptEdits`. Codex uses
`codex exec --ephemeral` with `workspace-write`, approval policy `never`, and the
brief on stdin so it is absent from the process command line. Both use the
owner's saved CLI login; repository API-key overrides are removed from the child
environment.

## Privacy and evidence

Provider output is secret-scrubbed and bounded before it enters intent evidence.
AVA stores a concise brief and worker summary, not raw tool payloads, hidden
reasoning, credentials, or environment contents. The intent journal names the
worker that actually owned the edit.

## Limitations

- An installed CLI can still fail at run time because its saved login expired,
  the account has no entitlement, or the provider is unavailable. The intent
  records that provider-specific failure and does not fall back.
- Availability is cached for 30 seconds to keep the four-second Self-screen poll
  inexpensive.
- The selector controls new implementation intents only. Reflection still uses
  AVA's configured orchestration model, and the approval/release gates remain
  provider-independent.
