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

## Runtime configuration

Import/build a synchronous webhook flow matching
`integrations/activepieces/ava-system-report-contract.json`, then set:

```text
ACTIVEPIECES_ENABLED=true
ACTIVEPIECES_SYSTEM_REPORT_WEBHOOK_URL=http://127.0.0.1:8080/...
ACTIVEPIECES_WEBHOOK_TOKEN=<optional shared bearer token>
ACTIVEPIECES_TIMEOUT_SECONDS=20
```

The deterministic fixture is test-only and is never a production fallback.
On this development machine Docker Desktop is installed, but the Linux engine
cannot start because WSL is absent and the current unelevated session cannot
start `com.docker.service`. Therefore this commit proves AVA's adapter and full
verification path deterministically, but does not claim a live Activepieces run.
The external prerequisite is a functioning Docker Linux engine (normally WSL2),
an Activepieces Community Edition instance, and the pinned imported flow.

## Failure and restart behavior

- Missing/invalid configuration fails closed as `unavailable`.
- Webhook responses over 100 KB, wrong identities, invalid steps, or claimed
  success without a complete report fail validation.
- Calls are bounded to 5-30 seconds and follow the AVA task abort signal.
- An in-flight run found after restart becomes failed and is never replayed.
- Mission Control shows the AVA parent/automation child ancestry, delegation,
  terminal outcome, verification boundary, and honest missing usage/cost.

Future workflows should be added as pinned, versioned registry entries with
their own input/output schemas and independent verification; arbitrary workflow
execution is intentionally not part of this foundation.
