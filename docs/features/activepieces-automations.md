# Activepieces deterministic playbooks

AVA now has one deliberately narrow automation seam for mature, repeatable
playbooks. AVA still owns intent, routing, approval policy, receipts, Mission
Control, independent verification and memory. Activepieces owns only the pinned
deterministic execution steps.

## V1 workflow

`ava.system-report` version 1 is manually invoked from chat or voice with
`automation_system_report`. AVA builds a bounded capability-readiness snapshot,
calls one configured synchronous webhook, validates that the response echoes the
exact request/workflow/version, writes the returned Markdown locally, then reads
it back and verifies its SHA-256 hash. Only that final evidence produces a
verified task outcome. The immutable artifact record is indexed into AVA memory;
repeating the same tool request is idempotent.

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
provisions the pinned synchronous webhook flow. Provisioning writes the local
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
ACTIVEPIECES_WEBHOOK_TOKEN=<local shared bearer token>
ACTIVEPIECES_TIMEOUT_SECONDS=30
```

The deterministic fixture is test-only and is never a production fallback.
Docker/WSL is not required for this local source-runtime configuration.

## Acceptance evidence

`npm.cmd -w server run smoke:activepieces-report` sends the literal request
`Run AVA's system health report.` through authenticated `/api/chat`. It fails
unless AVA selects `automation_system_report`, the live executor is
`activepieces`, the workflow completes, the report file passes SHA-256
read-back, the immutable artifact is indexed with verified provenance, the task
receipt is verified and Mission Control contains delegation and terminal
evidence. This smoke deliberately cannot pass against the deterministic fixture.

The runtime was stopped completely, relaunched through the tracked startup
script, and the black-box smoke passed again. This is the restart acceptance
boundary; a configured endpoint alone remains insufficient proof.

## Failure and restart behavior

- Missing/invalid configuration fails closed as `unavailable`.
- Webhook responses over 100 KB, wrong identities, invalid steps, or claimed
  success without a complete report fail validation.
- Calls are bounded to 5-30 seconds and follow the AVA task abort signal.
- An in-flight run found after restart becomes failed and is never replayed.
- Mission Control shows the AVA parent/automation child ancestry, delegation,
  terminal outcome, verification boundary, and honest missing usage/cost.
- If the optional runtime fails during desktop launch, AVA remains available;
  the automation invocation then reports the genuine runtime error rather than
  pretending the playbook ran.

Future workflows should be added as pinned, versioned registry entries with
their own input/output schemas and independent verification; arbitrary workflow
execution is intentionally not part of this foundation.
