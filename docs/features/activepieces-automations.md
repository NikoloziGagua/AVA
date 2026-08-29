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

The registry is implemented by `AutomationPlaybookService` plus two typed
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
idempotently provisions both pinned synchronous webhook flows. Provisioning writes the local
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
terminal evidence, and status shows both workflows configured. This smoke
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
