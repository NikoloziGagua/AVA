# Microsoft UFO bounded runtime integration

## Status

AVA has a genuine, experimental Microsoft UFO² runtime integration for one
disposable local Notepad task. It is not general computer use. The runtime is
pinned to Microsoft/UFO `v3.0.8` at commit
`96983c73ed09e884a5f1d7ff8936c953b234b684` and is installed beneath the
ignored `server/data/ufo-runtime` directory.

The earlier design assessment remains useful historical risk research, but its
“not installed” conclusion was superseded by Niko's explicit authorization for
this bounded implementation. Synthetic counter success is still never treated
as real UFO success.

## Working capability

AVA exposes these provider-neutral tools:

- `ufo_experiment_status`: truthful runtime/fixture health.
- `ufo_experiment_observe`: read-only synthetic counter evidence in fixture
  mode.
- `ufo_experiment_action`: versioned synthetic counter action in fixture mode.
- `ufo_runtime_run`: genuine Microsoft UFO execution in real mode. This tool
  accepts no arbitrary prompt, target, text, file, or application arguments.

`ufo_runtime_run` prepares an empty disposable `ava-ufo-proof.txt` document,
opens it in Notepad, and asks UFO to type one compiled-in proof string. UFO's
HostAgent must select that Notepad window and its AppAgent must perform the UI
action. AVA then reads the visible Notepad `Document` through a separate
Pywinauto/UI Automation fixture driver. Completion is verified only when the
process exits successfully, at least one UFO execution step is recorded, and
the independent exact-text comparison passes.

The fixture closes without saving. It never sends a message, uses an account,
opens a browser, or operates on Niko's documents. The bounded UFO profile omits
the CommandLineExecutor and disables online/offline RAG, experience/demo
retrieval, COM application profiles, the optional server, evaluation capture,
and retained UI trees. UFO necessarily sends screenshots and task context to
the configured OpenAI model while executing; the fixture must therefore remain
free of unrelated sensitive content.

## Installation and configuration

Requirements are Windows 10+, Git, Python 3.10, a configured
`OPENAI_API_KEY`, and an interactive desktop session. Install or repair the
pinned runtime with:

```powershell
npm.cmd -w server run setup:ufo-runtime
```

The installer verifies the exact Git commit, creates a dedicated virtual
environment, installs the official requirements, writes AVA's bounded UFO
configuration without persisting the provider key, copies the fixed fixture
driver, tests imports, and writes `manifest.json`. Health refuses an incomplete,
unpinned, malformed, differently configured, non-Windows, or credential-less
runtime.

Real mode requires:

```dotenv
UFO_EXPERIMENT_ENABLED=true
UFO_EXPERIMENT_MODE=ufo
UFO_EXPERIMENT_ISOLATION=local-windows-user-session
UFO_EXPERIMENT_ALLOW_FIXTURE_ACTIONS=true
UFO_EXPERIMENT_ALLOWED_FIXTURES=notepad-text-v1
UFO_EXPERIMENT_TIMEOUT_MS=240000
UFO_EXPERIMENT_MAX_STEPS=8
```

The integration remains off in `.env.example`; an installation alone does not
advertise the action. The existing policy classifier always treats
`ufo_runtime_run` as high risk. A standing allow rule cannot bypass the
explicit approval journal.

## Process, cancellation, and evidence boundaries

AVA launches Python directly with an argv array and a reduced environment. It
does not invoke a shell. The provider credential enters only the child process
environment and is never included in arguments, records, or logs. Agent Stop or
the bounded timeout aborts and tree-kills the UFO child process. An uncertain
action is never replayed: stable request keys, fingerprints, terminal
compare-and-set updates, and restart recovery preserve one immutable outcome.

UFO writes request/response screenshots and logs during its own execution.
AVA extracts only bounded facts—release/commit, task ID, step count, exit code,
fixed operation, independent verification method/result, and disposable
resource reference—and then deletes the raw per-task UFO log directory in a
`finally` boundary. Raw stdout/stderr, prompts, model payloads, screenshots,
credentials, and hidden reasoning do not enter AVA's database or Mission
Control.

Mission Control receives one correlated AVA-owned child run. The initiating
tool call owns action accounting; the child trace is evidence-only. The
terminal event distinguishes `runtime: microsoft_ufo` and
`microsoftUfoRuntime: executed` from the synthetic fixture, retains
`usage: not_reported` and `cost: not_reported`, and is marked verified only by
the independent UI Automation evidence. Task receipts use the same typed
verification producer, `microsoft_ufo_windows_uia`.

Authenticated HTTP remains read-only:

- `GET /api/ufo-experiment/health`
- `GET /api/ufo-experiment/requests/:id`

There is no HTTP mutation route, generic UFO prompt endpoint, or separate
control plane.

## Explorer visibility

Explorer exposes this experiment through the existing Capability Atlas and
runtime-health adapter. Its single **Experimental Microsoft UFO** capability
keeps four states distinct:

- disabled by configuration;
- synthetic counter available in observe-only mode;
- synthetic counter actions configured but still approval-required; and
- genuine pinned runtime available or unavailable for the fixed Notepad proof.

The capability workflow branches explicitly between those surfaces. Synthetic
evidence is labelled as fixture-harness evidence and never as Microsoft UFO
success. Genuine readiness comes from the same authenticated health contract
used by the tools, while recent runs link through the existing Mission Control
capability IDs. Explorer adds no action button, mutation route, fallback from
genuine to synthetic execution, or separate control plane.

## Tests and real smoke

Deterministic tests inject the process boundary and cover pinned health,
approval, fixed-tool exposure, successful execution, verification
contradiction, launch failure, cancellation, timeout/late-result suppression,
restart no-replay, idempotent readback, redaction, receipts, and Mission Control
correlation. They require no external credentials.

The opt-in genuine smoke uses the installed Microsoft runtime and a real model:

```powershell
$env:UFO_REAL_SMOKE='1'
npm.cmd -w server run smoke:ufo-runtime
```

It creates a temporary AVA database, obtains approval through the normal policy
journal, runs `ufo_runtime_run`, asserts independent visual evidence and one
Mission Control terminal event, confirms raw UFO task logs were removed, closes
the fixture, and deletes the temporary database.

## Current limitations

- Only the fixed Notepad proof is implemented. There is no arbitrary prompt,
  application, control, text, or file input.
- This is a reversible local user-session boundary, not a disposable VM. UFO
  observes the visible desktop to choose the allowlisted Notepad window, so
  unrelated sensitive windows should not be visible during an approved run.
- Provider token and cost telemetry are not exposed by this adapter and remain
  truthfully `not_reported`.
- A graceful Stop/timeout tree-kills the child. A hard operating-system or AVA
  process crash can require manual process cleanup; restart recovery prevents
  re-execution and marks the durable request failed, but Windows Job Object
  containment is a future hardening increment.
- The official `v3.0.8` OpenAI template contains a duplicated endpoint issue
  with its pinned SDK; AVA's installer uses the correct SDK base URL
  `https://api.openai.com/v1`.
