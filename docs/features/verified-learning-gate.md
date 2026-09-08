# Verified learning gate

AVA's procedural memory may learn only from terminal task evidence. A model's
final reply and a tool executor returning `ok` are observations, not proof that
the requested result exists.

## Plan and delivered slice

1. Define one typed verification-evidence envelope at the shared tool-result
   boundary.
2. Carry that evidence through the agent event stream, task receipt, Mission
   Control, and terminal playbook-learning decision.
3. Allow playbook capture and procedure replacement only for a `verified`
   task-outcome receipt.
4. Store verified, partially verified, unverified, contradicted, failed, and
   not-applicable outcomes separately, with bounded task and method provenance.
5. Keep old playbook files readable. Their `succ`/`fail` values remain labelled
   legacy reports and are never converted into verification.
6. Make replay idempotent through a bounded set of recent task IDs.
7. Show the evidence state in Mind and Explorer rather than a misleading W/L
   score.
8. Verify the contract with deterministic boundary, receipt, persistence,
   capture, replay, Mission Control, and UI tests.

## Evidence contract

A tool may attach:

- `state`: `verified`, `contradicted`, `unavailable`, or `not_applicable`
- `scope`: `operation` or `task_outcome`
- `method`: a stable verifier name
- `summary`: a bounded operational description
- optional safe evidence reference and observation timestamp

The shared registry validates the envelope. Invalid metadata is dropped. Raw
tool arguments, raw provider payloads, credentials, hidden reasoning, and file
contents are not copied into learning provenance.

`ok: true` without evidence remains unverified. Operation-scoped evidence can
produce a partial receipt, but cannot teach a whole workflow. Contradiction is
shown explicitly and demotes the affected playbook. Mixed runs with unresolved
failed or uncertain tool results remain partial even if another operation was
verified.

## Initial verification producers

- `fs_write`: exact read-after-write content comparison.
- Instagram profile/thread/message workflows: their existing exact URL,
  recipient identity, and visible-message DOM checks.
- WhatsApp thread/message workflows: their existing header identity and
  visible-message DOM checks.

Other tools remain honestly unverified until they have a deterministic,
non-consequential post-action verifier. AVA never repeats an external action
merely to generate proof.

## Learning lifecycle

The chat runtime waits for `done`, `error`, or `killed`, builds the terminal task
receipt, and then settles learning exactly once. Only `finished + verified +
task_outcome` can create or merge a playbook. Partial, unverified, contradicted,
failed, cancelled, and approval-blocked runs cannot replace procedure steps.

Each evidence record carries the task ID, verifier method, and observation time.
The most recent 32 task IDs are retained to prevent terminal replay or a
recall-plus-re-distillation path from counting one run twice. This is bounded
diagnostic provenance, not a second task log.

## Legacy behavior and limits

Old files parse with zero evidence-aware counters. Existing `succ` and `fail`
counters are preserved for auditability but shown only as legacy reports. They
remain a fallback demotion signal until a playbook receives its first gate
outcome; after that, evidence-aware contradiction/failure controls demotion.

This slice does not yet add the Claude/Codex self-improvement worker selector,
shadow replay, canary comparison, or automatic rollback. The next increment is
the explicit worker selector, built on this gate so neither worker can promote a
change from prose alone.
