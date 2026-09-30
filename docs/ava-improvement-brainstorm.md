# AVA Improvement Brainstorm

**Date:** 26 July 2026  
**Status:** Exploratory design discussion, not an implementation commitment  
**Scope:** The AVA project only. Forge and Forge-related implementation were deliberately not inspected or modified.  
**Change made for this review:** This document only. No AVA product or source-code changes were made.

## Executive view

AVA already has unusually broad capability: a tool-using chat agent, OpenAI Realtime voice, a persistent logged-in AVA Chrome profile, native Windows control, Instagram and WhatsApp workflows, memory, learned playbooks, watches, approvals, self-improvement, and an honest first version of Explorer.

The next major improvement should not be another large collection of tools. It should be making the existing capabilities:

1. **Provably successful** - a final answer must not be treated as proof that an external outcome happened.
2. **Durable and controllable** - tasks should stop cleanly, survive or recover honestly from restarts, and never duplicate side effects.
3. **Visible** - Sir should always be able to see the current stage, resources touched, verification, failures, and next action.
4. **Evidence-learning** - memory, playbooks, and self-improvement should learn from verified outcomes and real corrections, not merely from fluent final responses.
5. **Measured** - latency, reliability, token use, cost, retries, and voice failure modes need baselines and release gates.

The recommended north-star metric is:

> **Percentage of meaningful AVA tasks completed with operation-specific evidence, without an owner correction, retry, stale continuation, or duplicated side effect.**

If only three initiatives are funded next, they should be:

1. A shared execution, outcome, and evidence contract.
2. Durable task ownership, cancellation, resource locking, and recovery.
3. Golden end-to-end missions plus a repeatable voice/desktop reliability harness.

## Review basis and current baseline

This is a source-and-documentation review, not a claim that every external account and live workflow was exercised during this session. Runtime-dependent claims should continue to be labelled as such until a controlled live test provides evidence.

### Strong foundations already present

- Voice uses OpenAI Realtime with patient semantic endpointing, incomplete-turn accumulation, accepted-transcript interruption, one cancellable action owner, stale-result suppression, and one consistent final speaking voice.
- Voice computer work enters the same `/api/chat` action path as typed work instead of using a weaker, separate agent.
- The dedicated AVA Chrome launcher and CDP path are designed around a persistent logged-in browser profile.
- Instagram and WhatsApp have dedicated workflows with recipient/header checks and visible-send verification logic.
- The agent has timeouts, a stuck-loop detector, Stop/cancellation plumbing, approval policy, path restrictions, and secret redaction.
- Explorer has a data-driven capability/workflow model and honestly labels current execution records as not independently verified.
- Explorer persists append-only chat-agent and tool events instead of fabricating old traces from conversation prose.
- Memory is human-readable, supports confidence and supersession, and can capture procedural playbooks with outcome counters.
- Watches, reminders, notifications, self-improvement worktrees, verification, boot smoke, and rollback foundations already exist.
- The repository has broad unit/component test coverage: 144 server test files and 75 web test files were present during this review.

### Important limitations visible today

- Explorer records mainly the `/api/chat` seam. Direct Realtime voice lifecycle, memory changes, scheduler internals, self-improvement stages, and some desktop/browser state are not complete traces.
- Explorer does not yet persist real verification records, artifacts, parent event relationships, decision records, or workflow-node links. A task final response is still `not_recorded` verification.
- Playbooks can receive a successful outcome when a final response was produced, even if the external result was not independently verified.
- Restart recovery marks work interrupted rather than resuming from a durable operation journal; conversation state and in-flight execution state are not cleanly separated.
- Tool definitions do not declare side effects, idempotency, retryability, sensitive fields, resources, verification, or compensation.
- One shared browser and broad desktop control make concurrent work risky without resource ownership and target verification.
- Health primarily proves process liveness and provider configuration, not end-to-end dependency health.
- Memory and playbook recall are lexical. Paraphrases can miss, while auto-detected corrections can become noisy low-confidence durable observations.
- Real owner-facing mistakes do not reliably feed the friction ledger. The visible production writer primarily captures self-improvement failures.
- Security relies partly on allow-by-default execution with curated deny patterns. That is convenient, but novel destructive or exfiltration paths can fall outside regex knowledge.
- Token/cost accounting is not first-class, some history work is repeatedly scanned, command output buffers can grow before truncation, and the frontend currently has no meaningful route-level code splitting.

## Prioritization method

Impact:

- **Critical:** Prevents false success, secret exposure, unsafe execution, data loss, or systemic instability.
- **High:** Materially improves a frequent owner workflow, reliability, speed, or trust.
- **Medium:** Valuable, but should follow the execution and evidence foundation.

Effort is deliberately approximate:

- **S:** One to four focused development days.
- **M:** Roughly one to two weeks, including tests and migration work.
- **L:** Roughly three to six weeks or a multi-subsystem program.
- **XL:** A staged product initiative with external integrations or major operational change.

## Prioritized portfolio

| Priority | Improvement | Main areas | Impact | Effort | Why now |
|---|---|---|---|---|---|
| P0-1 | Correct approval policy, storage, and execution semantics | Reliability, security | Critical | S-M | Explicit `ask` rules are not consistently honoured, approval can conflict with executor hard blocks, and raw approval arguments can be persisted and returned |
| P0-2 | Fix small continuity/capability contract bugs | Agent, voice, UX | High | S | Conversation-mode tools passed by the route are currently dropped by the agent, and typed-to-voice navigation can lose the newly assigned session ID |
| P0-3 | Shared outcome and evidence contract | Reliability, observability, learning | Critical | M | AVA cannot consistently distinguish attempted, returned, succeeded, and independently verified |
| P0-4 | Durable execution ownership and recovery | Reliability, agent execution | Critical | L | Restart, cancellation, PID ownership, resource conflicts, and side-effect retries need one coherent model |
| P0-5 | Explorer instrumentation v2 | Observability, UX | Critical | M-L | Rich replay or health views will be fiction until all important subsystems emit causal, structured events |
| P0-6 | Voice and desktop reliability release gate | Voice, testing, UX | High | M | The architecture has improved, but real pauses, barge-in, cancellation, Windows desktops, and visibility require repeatable stress proof |
| P0-7 | External-content trust and data-egress policy | Security, browser, messaging | Critical | M | Web pages, messages, and documents must be treated as untrusted data, not as instructions to AVA |
| P1-1 | Deep health, error taxonomy, and independent budgets | Reliability, performance | High | M | Provider hangs, dependency failures, and non-progressing but non-repeating loops need bounded recovery |
| P1-2 | Memory provenance and correction review | Memory, UX, privacy | High | M | Sir needs to know what was learned, why, where it applies, and how to undo it |
| P1-3 | Truthful playbook lifecycle and canaries | Memory, tools, testing | High | M | Procedures should improve only after verified replay, not after any final response |
| P1-4 | Mission Control and compact task surfaces | UX, observability | High | M-L | Current capabilities and work state are distributed across screens and are difficult to understand at a glance |
| P1-5 | Usage, latency, cost, and resource budgets | Performance, observability | High | M | Optimization is guesswork without per-stage measurements |
| P1-6 | Canonical capability registry and documentation drift gate | UX, observability, testing | High | S-M | Server runtime declarations, the richer web Atlas, and some documentation can diverge |
| P2-1 | Hybrid semantic memory and playbook retrieval | Memory, performance | High | M-L | Lexical matching is fast and safe but misses useful paraphrases |
| P2-2 | Durable scheduler/job service with backfill and budgets | Reliability, watches | High | L | In-process watches cannot run while AVA is down and have limited recovery/cost controls |
| P2-3 | Deterministic direct integrations | Tools, UX | High | L-XL | Calendar, email, and other high-frequency services deserve API-first paths where available |
| P2-4 | Bounded parallel sub-runs | Performance, agent | Medium-High | L | Valuable for research, but unsafe before browser/resource isolation and idempotency |
| P2-5 | Evidence-earned autonomy ladder | Self-improvement | Medium-High | L | Autonomy should be granted only after durable coordination and verified outcome history exist |

## Quick wins: first five to ten working days

These are intentionally smaller than the architecture program. They remove current correctness problems and create truthful foundations.

### 1. Correct the approval contract

- Honour an explicit user rule whose action is `ask`; it should not be bypassed merely because the generic classifier considers a tool low-risk.
- Separate immutable hard blocks from actions that can be authorized through a scoped approval.
- Pass the resolved approval decision to the executor so a correctly approved action is not rejected again by a contradictory lower-level list.
- Redact approval arguments **before persistence** and never return raw arguments to the UI. Persist a safe summary plus typed redacted fields.
- Add a policy-matrix test covering allow, ask, deny, expiry, cancellation, and approval of an otherwise gated action.

**Impact:** Critical  
**Effort:** S-M

### 2. Restore promised conversation-mode tools

The chat route builds a limited conversation tool list, but the agent currently replaces the tool registry with an empty list in conversation mode. Keep conversation mode constrained, but expose exactly the safe tool profile selected by the route. Add a provider-request contract test so this cannot silently regress.

**Impact:** High  
**Effort:** S

### 3. Fix typed-to-voice session continuity

When the first typed message creates a server session, the chat screen learns the real session ID, but navigation into Voice can still use the stale route value. Pass the live session ID through the transition so voice continues the exact conversation instead of forking context.

**Impact:** High  
**Effort:** S

### 4. Make voice approvals and runtime labels truthful

- Until the active Realtime action path forwards approval events, remove the suggestion that spoken “yes/no” is a reliable approval method.
- Bridge `approval_required` and `approval_resolved` through the active voice connection before restoring spoken approval.
- Render the actual provider, model, and voice reported by the server rather than a hard-coded model badge.
- If voice repeatedly reconnects or fails endpointing, offer a one-tap switch to hold-to-talk.

**Impact:** High  
**Effort:** S for truthful UI; M for the complete approval bridge

### 5. Use one honest outcome vocabulary everywhere

Adopt the same statuses in Chat, Voice, Explorer, notifications, playbooks, and self-improvement:

- Running
- Waiting for approval
- Blocked by setup
- Cancelled
- Failed safely
- Result returned but unverified
- Partially verified
- Verified

Never render “Done” simply because a tool returned or a final response was produced.

**Impact:** Critical  
**Effort:** S

### 6. Correct misleading playbook labels

Until the schema is upgraded:

- Label current `uses` as stored/recorded uses and explain whether creation is included.
- Label current `succ` as runs that reached a final response, not verified successes.
- Persist the recalled playbook ID and originating task ID wherever possible.

**Impact:** High  
**Effort:** S

### 7. Show setup and trace coverage explicitly

- When a tool is unavailable, report the missing dependency or authentication state instead of silently making the model discover a brittle browser fallback.
- On every Explorer task, show an instrumentation coverage badge: complete, partial, or chat-seam only.
- Add direct actions such as “Open AVA Chrome,” “Log in,” “Pair this device,” or “Open exact trace.”

**Impact:** High  
**Effort:** S-M

### 8. Capture real friction

Write a structured friction record when Sir explicitly says the result is wrong, a verified operation fails repeatedly, voice creates a rejected split/continuation pattern, or a task requires an avoidable retry. Link it to the task/event evidence. Do not treat every casual correction as a permanent preference.

**Impact:** High  
**Effort:** S-M

### 9. Establish performance and release budgets

Start recording, even before optimization:

- Time to first visible status
- Time to first text/audio
- Provider wait time
- Tool duration
- Verification duration
- Total duration
- Tool calls and retries
- Input/output/cached tokens
- Estimated cost by lane
- Frontend bundle size and startup time

Add a bundle-size budget and route-level lazy-loading target to CI.

**Impact:** High  
**Effort:** S-M

### 10. Create a backup, retention, and restore drill

AVA has durable SQLite and Markdown state but needs a documented, automated, tested backup/restore path. The first version should make timestamped, encrypted or OS-protected backups; verify integrity; define retention; and prove restoration in a temporary data directory.

**Impact:** High  
**Effort:** S-M

## Medium-term work

### A. Build a shared execution envelope

Every tool and operational subsystem should run through one envelope that records and enforces:

```text
Task
  -> operation ID + parent/causal ID
  -> selected capability and tool
  -> declared resources
  -> sanitized input + privacy class
  -> risk/policy/approval decision
  -> timeout, retry and cancellation policy
  -> execution result
  -> postcondition/verification request
  -> evidence and verification verdict
  -> artifact/resource references
  -> durable terminal state
```

Extend tool metadata beyond `schema` and `run()` with:

- Side-effect class: read, local write, external write, destructive
- Idempotency and retry safety
- Required resources: browser profile, tab, app window, account, file, device
- Sensitive input/output fields
- Default and maximum time budgets
- Preconditions and setup requirements
- Verification adapter and success criteria
- Compensation or safe-recovery behavior

This creates the basis for safe retries, parallel read operations, honest Explorer traces, and deterministic routing.

### B. Make tasks durable, cancellable, and resource-aware

- Separate persistent conversations from actual in-flight task/run records. Do not mark every open conversation interrupted after restart.
- Journal stages and side-effect boundaries so recovery can offer: resume safely, re-verify, retry from checkpoint, or stop because replay may duplicate an effect.
- Propagate cancellation through provider streams, tools, child process trees, browser work, approvals, voice action ownership, and detached workers.
- Add resource leases for the AVA Chrome profile, individual tabs, desktop targets, account conversations, and mutable files.
- Use idempotency keys for external sends/writes where supported. For non-idempotent operations, persist an “effect may have occurred” state and re-verify before retrying.
- Store process identity as more than a PID. Validate executable and creation time, or use a Windows Job Object, before terminating a recovered process.
- On an uncaught process exception, stop new intake, cancel/kill owned work, flush state/logs, and exit for supervised restart instead of continuing in a possibly corrupted state.

### C. Add typed health and failure recovery

Health should distinguish:

- Process live
- Server ready
- LLM provider reachable
- Realtime provider reachable
- AVA Chrome attached and visible
- Required account authenticated
- Database writable
- Push configured
- Scheduler running
- Self-improvement coordinator healthy

Normalize errors as transient, permanent, setup-required, authentication-required, policy-blocked, user-cancelled, timeout, verification-failed, or uncertain-side-effect.

Add independent provider connect, idle, response, task, tool-call, token, cost, and retry budgets. A thought message should not reset a semantic no-progress clock. Do not retry side effects unless idempotency or a safe re-verification path exists.

### D. Upgrade Explorer into a real flight recorder

Instrumentation v2 should precede elaborate animation.

Add:

- Stable task, event, tool-call, parent, workflow-node, resource, artifact, evidence, and decision IDs
- Explicit verification events with claim, target, method, evidence, and verdict
- Voice events: pending fragment, accepted turn, rejected transcript reason, interruption, action start/stop, stale result suppressed, playback completed
- Memory events: read, proposed write, confirmed write, supersede, forget, consolidation
- Playbook events: matched, injected, captured, replayed, verified, demoted, promoted
- Browser/desktop events: target window/tab, visibility/focus proof, URL/title, before/after state
- Watch, notification, approval, self-improvement, swap, watchdog, and rollback events
- Durable sanitized artifacts with retention, hashes, and privacy classification
- Event-stream updates by task ID instead of broad polling

Then add:

- Actual task overlays on the declared workflow graph
- Technical and narrative replay
- Errors/retries-only and external-actions-only views
- Immutable review observations and approved lessons
- Before/after workflow and release comparison
- Links in both directions between task, capability, workflow, playbook, review, and release

Explorer should also display a **trace coverage percentage** so missing instrumentation is visible rather than implied complete.

### E. Establish evidence-based verification

Verification must be operation-specific:

| Operation | Possible evidence |
|---|---|
| Open AVA Chrome | Correct profile/process, visible target window, expected title/URL |
| Browser navigation | Final URL/title plus DOM or visual postcondition |
| Send Instagram/WhatsApp message | Verified recipient/thread header and sent text visibly present |
| Write a file | Expected path, existence, size/hash, and optionally a text diff |
| Run shell command | Exit code, bounded stdout/stderr, expected artifact/postcondition |
| Change an app | Target window identity plus accessibility/visual postcondition |
| Memory write | Stable memory ID and read-after-write result |
| Self-improvement | Tests/build/boot smoke, deployed commit, post-swap health, watchdog verdict |

Verification should not always mean “take a screenshot.” Prefer cheap structured evidence first, then selective screenshots when visual state matters.

### F. Make memory auditable and safe to improve

Give memories stable IDs and structured metadata while retaining readable Markdown/export:

- Source: explicit, inferred, correction, tool result, import
- Originating session/task/event
- Scope: global, person, project, capability
- Confidence and rationale
- Sensitivity/privacy class
- Created, last confirmed, expires
- Supersedes/conflicts with
- Review status and owner approval

Auto-detected corrections should enter a review/quarantine queue rather than immediately becoming broad durable preferences. The UI should show:

> Learned: “Use the dedicated AVA Chrome profile for Instagram.”  
> Source: correction in task X. Scope: browser workflows.  
> Actions: Confirm, narrow scope, edit, forget.

Add conflict and staleness views, memory budget visibility, category/date/length validation, People edit/delete, and a unified export/delete workflow across memory, people, playbooks, Explorer, and self-improvement history.

### G. Strengthen playbooks before expanding autonomy

Replace ambiguous counters with:

- Created runs
- Recalled runs
- Verified successes
- Partial outcomes
- Verification failures
- Execution failures
- Cancellations
- Median/p95 duration
- Cost and retry rate

Link every playbook to its origin task, capabilities, tools, verification, and version. New or materially changed playbooks should be quarantined until a verified replay succeeds. Use shadow scoring/canaries before replacing a proven version.

Only after that should AVA promote a stable, low-risk procedure into a deterministic parameterized tool through the guarded development pipeline.

### H. Make self-improvement a durable single coordinator

The live server and unattended improvement process need one durable lease/OS mutex and state machine:

- Persist pause state, queue, current stage, heartbeat, approvals, expected repository HEAD, and deadlines.
- Add `post_swap_verifying`; do not mark a change shipped until the detached watchdog reports health.
- Let the watchdog record rollback/success into durable state.
- Guard manual revert with the same expected-HEAD protection as automatic rollback.
- Let the global Stop path reach unattended work.
- Feed real task/voice/tool friction into improvement candidates, while filtering self-improvement failures from becoming recursive goals.

## Detailed recommendations by area

### Reliability

1. **Outcome contracts:** Each capability defines preconditions, expected effect, success evidence, uncertainty behavior, and stop conditions.
2. **Durable task state:** Checkpoints, operation journal, restart classification, and safe resume/re-verify.
3. **Dependency health:** Cached live probes and circuit breakers for providers, browser, accounts, database, push, and scheduler.
4. **Process ownership:** Job Objects or validated PID metadata; bounded, awaited shutdown.
5. **Data recovery:** Automated SQLite plus memory backups, integrity check, retention, and restore testing.
6. **Uncertain side effects:** A first-class state for “the request may have reached the external service; verify before retry.”

### Agent and tool execution

1. **Capability router:** Prefer deterministic adapter/API, then dedicated browser workflow, then generic DOM automation, then vision/native fallback. Record why a fallback was selected.
2. **Readiness preflight:** Check authentication, configuration, target identity, permissions, and resource availability before expensive model work.
3. **Operational tool metadata:** Side effects, sensitive fields, idempotency, verification, resources, budgets, and retry policy.
4. **Resource coordinator:** Serialize conflicting browser/account/app operations while allowing independent read-only work in parallel.
5. **Browser precision:** Add explicit tab selection/close/new, scoped keypress, insert-vs-replace text, bounded query/find, and postconditions for every mutation.
6. **Desktop precision:** One Default-desktop adapter for list/focus/restore/verify/capture, shared by Chrome, app control, and screenshots. Fail closed if the target cannot be proven.
7. **Bounded output:** Cap or spool shell/app output while it is produced; apply retention and private ACLs to generated scripts/artifacts.

### UX

1. **Mission Control home:** Active tasks, approvals, watches, failures, recent verified results, artifacts, setup needs, and notifications in one place.
2. **Attention/results inbox:** Separate “needs me,” “completed and verified,” “completed but unverified,” and “failed with suggested recovery.”
3. **Capability setup center:** “Works now,” “login required,” “missing configuration,” “degraded,” “last verified,” with one-click setup actions.
4. **Compact voice task card:** Current stage, elapsed time, last three steps, Stop label, outcome/verification, and Open Trace. Avoid a center-screen transcript wheel.
5. **Voice recent context drawer:** Last two or three committed turns, hidden by default, so context is available without clutter.
6. **Command/search palette:** Search capabilities, tasks, people, memory, watches, artifacts, and settings from one entry point.
7. **Progressive technical depth:** Plain-language status first; trace, payload, evidence, and timing only when expanded.
8. **Clear uncertainty:** Always explain whether AVA knows, inferred, attempted, observed, or independently verified.

### Memory

1. **Provenance and scope:** Stable IDs, source task, person/project scope, sensitivity, confirmation, expiry, and conflict links.
2. **Correction review:** Quarantine inferred corrections; confirm/reclassify/undo from the UI.
3. **Hybrid retrieval:** Lexical precision plus conservative local semantic retrieval, with scope filters and a no-match bias.
4. **Retrieval explanation:** Show “why this memory/playbook was recalled” and allow feedback.
5. **Consolidation proposals:** Suggest merge/supersede/expire diffs; never silently erase medium/high-confidence memories.
6. **Unified forgetting:** Define cascading delete/anonymize rules across people, memory, playbooks, sessions, Explorer traces, artifacts, and reviews.

### Voice

1. **100-run reliability harness:** Pauses, incomplete fragments, noise, accents, corrections, barge-in, Stop, reconnect, approval, long actions, provider failure, and late result races.
2. **Voice telemetry:** VAD stop, transcript completion, gate result, accumulation, first audio, playback duration, interruption reason, action stages, cancellation, and overlap count.
3. **Continuity:** Fix typed-to-voice session handoff and verify voice-to-chat return keeps the same session.
4. **Truthful approvals:** Tap/device approval first; spoken approval only after explicit event bridging and read-back confirmation.
5. **Repair UX:** Pending-fragment indicator, “I heard…” correction, Retry, and one-tap hold-to-talk fallback.
6. **Device diagnostics:** Microphone permission, input level, clipping/noise/echo check, output device, network quality, and a short calibration flow.
7. **Provider parity:** Keep alternative providers experimental until they pass the same interruption, accumulation, cancellation, and one-voice invariants.

### Security and privacy

1. **Untrusted-content boundary:** Browser pages, emails, DMs, files, and tool output are data. Instructions found inside them cannot authorize tool actions or override AVA policy.
2. **Destination-aware egress:** Every upload/send/API write declares destination, data class, recipient/account, and approval requirement.
3. **Capability-scoped grants:** Root/app/domain/action/expiry scopes preserve low-friction access without making every token/device universally powerful.
4. **Unified sanitizer:** Reuse the strongest bounded, structured redaction before all persistence paths, including approvals, memory, people, playbooks, friction, changelog, logs, Explorer, and exports.
5. **Short-lived voice authentication:** Replace long-lived bearer tokens in WebSocket URLs with a one-use, short-lived WS ticket.
6. **Pairing/auth hardening:** Cryptographic pairing codes, rate limits, token rotation/expiry, and faster indexed token lookup.
7. **Retention controls:** User-selectable retention and deletion/anonymization for traces, screenshots, generated scripts, messages, and task artifacts.
8. **Adversarial tests:** Prompt injection, malicious pages, secret-shaped output, symlink/junction paths, encoded commands, cross-account recipient confusion, and export re-redaction.

### Observability

1. **Causal trace IDs:** Voice -> chat -> model -> tool -> subprocess/browser -> verification -> final response.
2. **Evidence objects:** Durable, redacted references to DOM checks, exit codes, hashes, API responses, screenshots, and health probes.
3. **Decision records:** Concise operational reasons for tool/fallback/verification/stop choices, not hidden reasoning.
4. **SLO dashboard:** Success, verified success, false-success corrections, p50/p95 latency, retry, cancellation, cost, and regression by capability.
5. **Trace coverage:** Show which subsystems emitted complete events and which remain invisible.
6. **Canonical registry:** Generate server and web projections from one source; validate tool bindings, workflow nodes, source references, and documentation in CI.
7. **Health history:** Separate configured, ready, healthy, authenticated, tested, and recently successful.

### Testing

1. **Golden missions through the real execution wrapper:**
   - Open and visibly focus the dedicated AVA Chrome.
   - Navigate and verify a known page.
   - Open the correct Instagram/WhatsApp conversation without sending.
   - Send to a controlled test recipient and verify appearance.
   - Write/read/verify a file.
   - Run/cancel/restart a shell task.
   - Ask/approve/deny/expire a policy-gated action.
   - Correct/confirm/forget a memory.
   - Fire a reminder/watch with AVA offline and back online.
   - Ship/fail/rollback a sandboxed self-improvement fixture.
2. **Deterministic provider fixtures:** Record sanitized protocol shapes for model streams and Realtime events; test the real agent logic without live-provider nondeterminism.
3. **Voice scenario corpus:** Synthetic and owner-approved sanitized audio fixtures plus a small nightly live-provider canary.
4. **Fault injection:** Provider disconnect, partial stream, network loss, browser close, wrong tab, app minimized, server restart, DB busy, expired approval, and cancellation at every stage.
5. **Contract tests:** Tool metadata, policy matrix, redaction, event completeness, capability registry, evidence semantics, and migration/backward compatibility.
6. **CI gates:** Typecheck, build, server/web tests, Explorer contract, security corpus, deterministic E2E, bundle budget, and migration/restore smoke.
7. **Flake visibility:** Track and quarantine explicitly; never silently skip unreliable tests and call the release green.

### Performance

1. **Measure first:** Per-stage latency, tokens, cached tokens, cost, tool duration, output bytes, retries, and UI startup.
2. **Context budgets:** Inject only relevant capabilities, memories, and playbooks; show prompt composition and cache effectiveness.
3. **Model routing:** Use deterministic code for routing/readiness, a lighter lane for small conversation/classification, and the full agent only for actual execution.
4. **History efficiency:** Query incremental history, single-flight summaries per session, and compare-and-set summary updates.
5. **Provider budgets:** Connect, idle, total response, token, and cost ceilings with explicit continuation for intentionally long jobs.
6. **Output and CPU bounds:** Stream-capped subprocess output and replace large synchronous edit-distance checks with hashes/fingerprints or bounded shingles.
7. **Frontend loading:** Route-level lazy loading, especially heavy visualization code; protect bundle and time-to-interactive budgets.
8. **Event-store hygiene:** Batching, useful indexes, bounded artifacts, retention tiers, and pagination/streaming for long traces.
9. **Watch/self-improvement budgets:** Daily cost caps, maximum concurrent background work, and pause-on-repeated-failure circuit breakers.

## Recommended sequence

### Phase 0 - Immediate correctness and truth (days 1-5)

Deliver:

- Approval `ask`/allow/deny correctness and pre-persistence redaction
- Conversation-mode tool exposure
- Typed-to-voice session continuity
- Truthful voice approval/model UI
- Shared outcome vocabulary
- Truthful playbook labels

Exit criteria:

- Policy matrix tests pass.
- No approval API returns raw arguments.
- Conversation mode exposes exactly its intended limited tools.
- Moving between typed chat and voice preserves the same task/session.
- No UI calls an unverified outcome verified or done.

### Phase 1 - Measurement and common contracts (week 2)

Deliver:

- Operational ToolDef metadata
- Task/event/tool-call IDs and error taxonomy
- Readiness preflight
- Latency/token/cost baseline
- Canonical registry plan and drift checks
- Backup/restore smoke

Exit criteria:

- Every tool declares side-effect, resources, sensitivity, retry, timeout, and verification behavior.
- Every meaningful operation has a correlation ID.
- Missing setup is surfaced before a doomed execution attempt.
- A baseline report can compare capabilities by reliability and latency.

### Phase 2 - Reliable execution kernel (weeks 3-5)

Deliver:

- Central execution wrapper
- Resource leases
- Cancellation propagation
- Independent time/token/cost/no-progress budgets
- Idempotency/uncertain-side-effect states
- Correct run-based restart recovery
- Validated process ownership and graceful fatal restart
- Deep dependency health

Exit criteria:

- Stop prevents all late UI/speech/result updates.
- Conflicting use of the same browser/account/app is serialized.
- Restart tests do not falsely interrupt idle conversations or duplicate side effects.
- Provider/tool hangs end in a classified, visible state.

### Phase 3 - Evidence, Explorer, and release gates (weeks 5-8)

Deliver:

- Verification and evidence schema
- Missing subsystem instrumentation
- Artifacts/resources/parent relationships
- Task-specific live stream
- Golden missions and failure injection
- 100-run voice harness
- Default-desktop focus/capture/verification adapter

Exit criteria:

- At least 95% of meaningful operations in golden missions appear in the trace.
- Every external side-effect claim has a verification status and evidence or a clear evidence gap.
- Voice stress runs show zero overlapping speech, stale resumed results, or post-Stop action updates.
- Browser-visible claims are proven on the actual interactive desktop.

### Phase 4 - Memory, playbooks, privacy, and self-improvement (weeks 8-12)

Deliver:

- Memory provenance/scope/review
- Correction-to-friction flow
- Truthful playbook metrics, origin links, quarantine, replay, and canaries
- Unified sanitizer and privacy lifecycle
- Durable cross-process self-improvement coordinator and watchdog verdicts

Exit criteria:

- Sir can see, edit, narrow, confirm, or forget anything AVA learned.
- No playbook is called successful without verified replay.
- Privacy deletion/export behavior is explicit across all stores.
- Only one self-improvement coordinator can own a change, including across restart.

### Phase 5 - UX, scheduling, and performance (after the foundation)

Deliver:

- Mission Control and attention/results inbox
- Capability setup center and command palette
- Voice recent context/task card
- Frontend code splitting
- Durable scheduler with missed-run policy and budgets
- Hybrid semantic retrieval with measured precision

Exit criteria:

- Sir can answer “What is AVA doing, what needs me, and what worked?” from one screen.
- A new integration can be set up without reading source or `.env` documentation.
- Background work survives expected restarts without surprise duplicates.
- Semantic retrieval improves measured recall without unacceptable wrong-context injection.

### Phase 6 - New capability and earned autonomy

Only then consider:

- Direct calendar/email and other high-frequency integrations
- Routine detection and proposed automations
- Promotion of proven playbooks into deterministic tools
- Parallel sub-runs with isolated resources
- Evidence-based autonomy levels for low-risk work

## Key dependencies

1. **Canonical operational metadata:** A single tool/capability definition must feed policy, execution, Explorer, setup, tests, and documentation.
2. **Schema migrations:** Evidence, artifacts, IDs, approval redaction, memory provenance, leases, and self-improvement state require safe migrations and rollback.
3. **Windows desktop adapter:** Real focus/visibility/capture testing must run on the interactive Default desktop, not only in mocks.
4. **Controlled test accounts:** Messaging and other external-write golden missions need dedicated recipients/accounts and cleanup rules.
5. **Provider error normalization:** OpenAI, Anthropic, Realtime, browser, and app-control failures need one internal taxonomy.
6. **Privacy policy:** Decide retention and cascade behavior before persisting richer traces and screenshots.
7. **Supervisor behavior:** Durable recovery assumes AVA is restarted by a known launcher/service after fatal exit.
8. **Secure credential storage:** Direct integrations should use least-privilege tokens in an OS-backed vault where practical.

## Main risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Verification adds latency | Extra checks can make simple work feel slow | Use capability-specific cheap evidence first; parallelize safe checks; reserve screenshots for visual uncertainty |
| Retry duplicates an external action | A second send/write can be worse than a failure | Idempotency keys, durable side-effect boundary, and re-verify-before-retry |
| Rich traces become a privacy warehouse | AVA touches personal messages, files, pages, and accounts | Redact before persistence, selective artifacts, retention tiers, export re-redaction, deletion/anonymization |
| Semantic memory recalls the wrong private context | A confident wrong memory can steer the whole task | Strong scope filters, conservative thresholds, explanation, no-match bias, review feedback |
| Learning amplifies an unverified mistake | Bad playbook behavior compounds over time | Verified outcome gating, quarantine, canaries, version rollback, consequential-action approval |
| Parallel work races one browser/account | Wrong tab or recipient can be selected | Resource leases and isolated tabs/contexts before parallel execution |
| Capability metadata becomes stale marketing | A registry can claim more than runtime proves | Keep definition, readiness, health, test, and recent evidence separate; enforce contract/drift tests |
| More observability overwhelms the UI | Technical detail can make AVA harder to use | Progressive depth: plain status first, technical trace on demand |
| Authentication hardening locks out devices | Token migration can interrupt access | Staged migration, dual-validation window, recovery pairing path, tested rollback |
| Self-improvement coordinators overlap | Two swaps/reverts can corrupt or undo valid work | Durable lease, expected-HEAD guard, heartbeat, single state machine, global Stop |
| Third-party UIs change | Browser workflows can degrade suddenly | Dedicated adapters, selector/DOM contracts, visual fallback, health checks, controlled live canaries |

## What not to do yet

- Do not build polished animated replay before the event/evidence model can support truthful replay.
- Do not parallelize browser or desktop tasks before resource isolation and target verification.
- Do not auto-promote procedures based on final responses or self-reported success.
- Do not remove approvals globally. Reduce friction through explicit, scoped, evidence-earned grants while preserving hard boundaries for secrets, identity, money, external sends, and destructive actions.
- Do not record continuous screenshots or raw private content to make Explorer look comprehensive.
- Do not add a large agent framework rewrite; AVA’s current loop is understandable and can be strengthened incrementally.
- Do not add many new integrations until setup, health, evidence, and failure recovery are reusable across integrations.

## Product ideas worth revisiting after the foundation

### AVA Flight Recorder

An Explorer mode that replays exactly what AVA touched, with a synchronized workflow graph, evidence, timing, and an owner annotation lane. This becomes genuinely impressive only after instrumentation v2.

### Workflow Lab

Run a proposed playbook version in shadow or against a safe fixture, compare tool count, duration, cost, and verified outcome with the current version, then promote or reject it visibly.

### “What can AVA do right now?” palette

A command/search surface that answers with current readiness and evidence rather than static claims:

> “Send WhatsApp message - ready, last verified yesterday.”  
> “Instagram login - authentication required.”  
> “Desktop control - available, visual verification degraded.”

### Automation suggestions with proof

AVA proposes a routine only after it sees a repeated, verified pattern:

> “You ran this verified workflow four mornings in two weeks. Automating it would save about 11 minutes per run. Review the proposed schedule and steps?”

### Personal reliability brief

A weekly, concise owner report:

- What AVA did
- What was verified
- What failed or required correction
- What became faster
- What AVA learned or proposes to forget
- Which capability needs setup
- Cost and time saved

## Success measures

Initial targets should be adjusted after the baseline, but the program should track:

- **100%** of external side-effect claims have an explicit verification state.
- **Zero** raw secrets found by the redaction corpus across persisted stores and exports.
- **Zero** stale voice/action continuation after Stop in the repeatable stress suite.
- **Zero** duplicated side effects in restart/cancellation chaos fixtures.
- **At least 95%** pass rate over consecutive controlled golden missions before release.
- **At least 95%** trace coverage for meaningful operations in the golden suite.
- Declining owner correction and manual retry rates by capability.
- Measured memory/playbook retrieval precision as well as recall.
- p50/p95 time to first status, first text/audio, and verified completion.
- Token and cost per verified task, not merely per response.
- Frontend bundle/startup budgets and regression alerts.
- Backup restore success and recovery time.

The central design principle is:

> **Capture -> identify -> verify -> review -> learn -> automate -> earn trust.**

That sequence gives AVA more useful freedom over time without confusing broad access with reliable autonomy.
