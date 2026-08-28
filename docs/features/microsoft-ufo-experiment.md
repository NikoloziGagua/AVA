# Microsoft UFO experimental adapter proof

## Status

This is an **experimental, default-off, fixture-only adapter proof**. It is not
an operational Microsoft UFO integration and it grants AVA no new host computer
control.

The design-only assessment remains authoritative for the real-runtime decision:
[`docs/self/proposals/microsoft-ufo-evaluation.md`](../self/proposals/microsoft-ufo-evaluation.md).
The local environment checked during implementation did not have Microsoft UFO,
Docker, a verified Hyper-V/Windows Sandbox runtime, a frozen UFO artifact/SBOM,
or an isolation manifest. AVA did not install or enable any of them.

## Implemented boundary

AVA exposes three typed tools:

- `ufo_experiment_status`: truthful read-only health.
- `ufo_experiment_observe`: observes a synthetic disposable counter.
- `ufo_experiment_action`: advances that counter by exactly one versioned step;
  it is registered only while fixture actions are genuinely enabled.

The strict allowlist contains only `counter-v1`. The adapter has no shell,
filesystem, browser, clipboard, account, network, screenshot, COM, secret, or
arbitrary UI interface. It cannot receive an arbitrary command. The durable
schema stores bounded operation identifiers and sanitized summaries only.

Fixture observation and actions have independent routes at the tool boundary.
An action is always `high` risk in AVA's existing policy runtime. It requires an
explicit approval and expires rather than auto-approving; a standing allow rule
cannot bypass this gate. The fixture additionally requires an observed
`expectedFixtureVersion`, so a stale action fails instead of replaying.

The only HTTP endpoints are authenticated and read-only:

- `GET /api/ufo-experiment/health`
- `GET /api/ufo-experiment/requests/:id`

There is no HTTP action, generic mutation, provider launch, or fake Stop route.
Agent Stop reaches an in-flight fixture through the existing per-tool abort
signal.

## Configuration

All defaults are fail-closed:

```dotenv
UFO_EXPERIMENT_ENABLED=false
UFO_EXPERIMENT_MODE=off
UFO_EXPERIMENT_ISOLATION=none
UFO_EXPERIMENT_ALLOW_FIXTURE_ACTIONS=false
UFO_EXPERIMENT_ALLOWED_FIXTURES=counter-v1
UFO_EXPERIMENT_TIMEOUT_MS=2000
UFO_EXPERIMENT_MAX_STEPS=3
```

The deterministic fixture is available only with all of:

```dotenv
UFO_EXPERIMENT_ENABLED=true
UFO_EXPERIMENT_MODE=fixture
UFO_EXPERIMENT_ISOLATION=synthetic-fixture-v1
```

It remains observe-only unless
`UFO_EXPERIMENT_ALLOW_FIXTURE_ACTIONS=true`. Setting mode to `ufo` does not
launch or install anything; health remains unavailable and names the missing
frozen artifact, SBOM, disposable Windows VM, and runtime adapter.

## Durability, replay, and evidence

Each request has a stable request key, input fingerprint, durable projection,
and stable Mission Control child-run ID. Repeating the same request returns the
same record. Reusing its key for different input is rejected. Terminal outcomes
are idempotent; a late adapter completion cannot overwrite a cancellation,
timeout, restart recovery, or prior terminal result. A restart fails an in-flight
request safely and never replays an uncertain action.
The tool boundary derives the key from AVA's run and version identifiers; it
does not accept a user/provider-supplied idempotency string that could hide
sensitive content.

Mission Control records the AVA parent/child trace, adapter boundary, sanitized
input summary, lifecycle, terminal outcome, and verification evidence. It says
`not_reported` for usage and cost and explicitly records that the Microsoft UFO
runtime is unavailable. The shared sanitizer runs before durable evidence and
again when Mission Control reads it.
The initiating AVA tool call owns action accounting; the child adapter trace is
evidence-only, so one fixture operation is never counted twice.

Task receipts treat a returned tool result separately from verification. The
fixture emits typed local-operation verification only; it does not claim that a
real host workflow or Microsoft UFO outcome was verified.

## Limits and prerequisite for a real runtime

This proof validates AVA's adapter, policy, durability, cancellation, and
observability boundaries only. A real trial remains blocked until Niko approves
a separately scoped disposable Windows VM with no host clipboard/shared paths,
a frozen UFO artifact and dependency lock/SBOM, verified egress and fixture
allowlists, independent kill/rollback evidence, and adversarial escape tests.
Nothing in this proof authorizes installation on Niko's normal desktop.
