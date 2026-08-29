# Activepieces deterministic playbooks

AVA has a deliberately narrow automation seam for mature, repeatable playbooks.
AVA still owns intent, routing, approval policy, receipts, Mission Control,
independent verification and memory. Activepieces owns only the deterministic
steps of workflows declared in AVA's typed registry.

## Registered V1 workflows

`ava.system-report` version 1 is manually invoked from chat or voice with
`automation_system_report`. AVA builds a bounded capability-readiness snapshot,
calls one configured synchronous webhook, validates that the response echoes the
exact request/workflow/version, writes the returned Markdown locally, then reads
it back and verifies its SHA-256 hash. Only that final evidence produces a
verified task outcome. The immutable artifact record is indexed into AVA memory;
repeating the same tool request is idempotent.

`ava.operations-brief` version 1 is manually invoked with
`automation_operations_brief`. Its snapshot contains only aggregate counts:
current core readiness; Mission Control run status and verification totals for
the last 24 hours; pending approval, blocked Self and watcher-successor counts;
Notes workflow counts; Self and watch counts; and active/verified memory-index
counts. It never includes prompts, task titles, errors, note bodies, memory
content, tool arguments or logs. The result is a structured Markdown operations
brief with Readiness, Last 24 hours, Attention, and Work and knowledge sections.
It follows the same atomic write, read-back SHA-256 verification, immutable
artifact, memory-index and Mission Control path as the system report.

`ava.approved-action-plan` version 1 is an internal compiler/validation flow for
generated playbooks. It receives only an already-approved, schema-validated
single-action definition, its revision, exact target identity and a fingerprint
of the source-task evidence. It returns a bounded plan artifact; AVA reads back
and hash-verifies that artifact, revalidates current identity data, and only then
runs the local action. Activepieces never receives arbitrary tool arguments and
never controls the browser itself.

The first generated-playbook compiler deliberately supports one procedure:
`instagram_open_chat`. After two distinct task receipts independently verify the
same exact people-map route, AVA creates a **proposed** candidate. It does not
activate from observation alone. `automation_playbook_activate` requires the
candidate's current version and a high-tier explicit approval card. Activation
binds the revision to the stable people-map person ID and current username. The
active playbook is then available through `automation_run_playbook`; every run
validates the Activepieces plan and current username again before using AVA's
existing profile-first Instagram workflow. If the username changed, it fails
closed and requires fresh verified observations. Inbox search, message typing
and message sending are outside this generated definition.

The registry is implemented by `AutomationPlaybookService` plus three typed
workflow registrations. The executor receives an exact workflow ID/version and
uses only that workflow's configured endpoint. Request-key reuse across
different workflows is rejected. `automation_status` reports configuration and
availability separately for every registered playbook; one configured workflow
cannot make a missing sibling appear available. There is no arbitrary flow ID,
payload or execution API.

The endpoint cannot select an arbitrary flow. Inputs contain readiness flags and
counts, never credentials, raw memories or authentication state. Outputs and
errors are secret-scrubbed before persistence. Activepieces-reported success is
executor evidence, not AVA verification. Usage and cost are `not_reported` until
the provider supplies trustworthy values.

## Genuine local runtime

The Windows development host now runs the genuine Activepieces Community
Edition source runtime, pinned to upstream commit
`217380c40e2a3c138cbf461b6f4bd442e3decf2b` (release `0.88.3`). It uses the
official API, engine and worker with local PGLite and memory-queue services. It
is not a mock and there is no fixture fallback in the live AVA path.

Install and provision it once from the repository root:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-activepieces-runtime.ps1
```

The setup script clones only the official repository into ignored local runtime
data, checks the exact commit, runs the official development setup, applies the
tracked Windows file-URL compatibility patch, starts the genuine runtime and
idempotently provisions all three pinned synchronous webhook flows. Provisioning writes the local
credentials and AVA webhook configuration only to the ignored root `.env`; it
does not print secrets.

After setup, AVA's normal desktop launcher automatically starts Activepieces
when `ACTIVEPIECES_ENABLED=true`. A standalone restart is available with:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-activepieces-runtime.ps1
```

The provisioner owns these AVA settings:

```text
ACTIVEPIECES_ENABLED=true
ACTIVEPIECES_SYSTEM_REPORT_WEBHOOK_URL=http://127.0.0.1:3000/api/v1/webhooks/<flow-id>/sync
ACTIVEPIECES_OPERATIONS_BRIEF_WEBHOOK_URL=http://127.0.0.1:3000/api/v1/webhooks/<flow-id>/sync
ACTIVEPIECES_APPROVED_ACTION_PLAN_WEBHOOK_URL=http://127.0.0.1:3000/api/v1/webhooks/<flow-id>/sync
ACTIVEPIECES_WEBHOOK_TOKEN=<local shared bearer token>
ACTIVEPIECES_TIMEOUT_SECONDS=30
```

The deterministic fixture is test-only and is never a production fallback.
Docker/WSL is not required for this local source-runtime configuration.

## Acceptance evidence

`npm.cmd -w server run smoke:activepieces-playbooks` sends the literal requests
`Run AVA's system health report.`, `Is Activepieces automation configured and
available now?`, and `Create AVA's operations brief for the last 24 hours.`
through authenticated `/api/chat`. It fails unless AVA selects the correct tool
for both action requests, both live runs identify `activepieces`, both artifacts
pass read-back SHA-256, both immutable records enter memory with verified
provenance, both receipts are verified, Mission Control contains the correlated
terminal evidence, and status shows all workflows configured. The generated
playbook smoke separately proves observation, approval, plan verification,
profile-first execution and duplicate suppression with Lasha's saved
`_princi150` identity. These smokes
deliberately cannot pass against the deterministic fixture.

The runtime was stopped completely, relaunched through the tracked startup
script, and the black-box smoke passed again. This is the restart acceptance
boundary; a configured endpoint alone remains insufficient proof.

## Failure and restart behavior

- Missing/invalid configuration fails closed per workflow as `unavailable`.
- Webhook responses over 100 KB, wrong identities, invalid steps, or claimed
  success without a complete report fail validation.
- Calls are bounded to 5-30 seconds and follow the AVA task abort signal.
- An in-flight run found after restart becomes failed and is never replayed.
- Mission Control shows the AVA parent/automation child ancestry, delegation,
  terminal outcome, verification boundary, and honest missing usage/cost.
- If the optional runtime fails during desktop launch, AVA remains available;
  the automation invocation then reports the genuine runtime error rather than
  pretending the playbook ran.

Future workflows must be added as pinned, versioned registry entries with their
own bounded snapshot producer, artifact contract, webhook configuration,
deterministic tests and independent acceptance evidence. Arbitrary workflow
execution is intentionally not part of this foundation.

## Automatic playbook lifecycle

1. A completed task receipt must contain task-outcome verification and an
   eligible, entirely successful tool sequence.
2. The compiler fingerprints a bounded semantic definition, not a transcript.
   Duplicate/replayed task IDs do not increase evidence.
3. One observation is `observing`; two distinct verified tasks become
   `proposed`.
4. Sir explicitly approves `automation_playbook_activate`. Stale candidate
   versions are rejected.
5. Activepieces validates the exact approved revision. AVA independently
   verifies its artifact and publishes the playbook as `active`.
6. A matching future request is steered to `automation_run_playbook`. The
   Activepieces plan and authoritative people-map identity are checked again,
   then the existing AVA tool performs and verifies the real action.

Candidates and active definitions survive restart in SQLite. A validation that
was in flight at restart becomes failed and is never silently resumed. Failed
or unverified tasks do not teach candidates. Generated plan artifacts are kept
as operational evidence but are not indexed as durable user knowledge, avoiding
memory clutter. V1 does not infer multi-step workflows, messaging, arbitrary
browser actions or user-authored Activepieces flows.
