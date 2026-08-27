# Microsoft UFO: design-only eligibility assessment

| Field | Value |
|---|---|
| AVA Self intent | `-Nb9YsN1KWjQ` |
| Approved scope digest | `aab588082709b78ea5aa6f31185c778e3be3837ac9a0012145d5f85188150020` |
| Assessment date | 2026-08-27 |
| Candidate reference | Microsoft UFO, with UFO² `v3.0.8` used only as the documentary reference point |
| Status | Design-only; no authorization to acquire or run UFO |

This proposal implements the latest Strategy Room UFO brief. It explicitly excludes the superseded 10–15-repository research phase and does not select or advance a fallback. The work performed for this document was limited to reading canonical Microsoft UFO repository/documentation pages and AVA's checked-in source and documentation. It did **not** install, execute, import, integrate, benchmark, or grant UFO access to any environment, and it made no production change.

## Scope and decision rule

This assessment asks only whether the documented system is sufficiently understood to be considered for a later, tightly confined, reversible evaluation. Documentation cannot establish that an autonomous GUI agent is safe. Any later acquisition, installation, execution, empirical test, normal-environment access, external screenshot/UI-state transmission, or fallback choice remains a separate decision for Niko.

The decision is fail-closed: a consequential action or outbound-data path that is unknown, dynamically introduced, or not completely mediated is a blocker. An apparent in-product safeguard is not a substitute for an AVA-owned enforcement boundary.

## Evidence method and canonical source register

Facts below cite the following canonical sources. Every source was accessed 2026-08-27. Release and security statements are time-bounded to that access date.

### Microsoft UFO sources

<a id="u1"></a>**U1.** [Microsoft/UFO repository](https://github.com/microsoft/UFO) and [UFO² README](https://github.com/microsoft/UFO/blob/main/ufo/README.md) — project scope, architecture, quick start, RAG, logs, model configuration, and project status.

<a id="u2"></a>**U2.** [UFO releases](https://github.com/microsoft/UFO/releases), [`v3.0.8` tree](https://github.com/microsoft/UFO/tree/v3.0.8), and [`v3.0.8` tip commit](https://github.com/microsoft/UFO/commit/96983c73ed09e884a5f1d7ff8936c953b234b684) — release dates, tag contents, and the documented IPv6 SSRF-guard change.

<a id="u3"></a>**U3.** [UFO² quick start](https://microsoft.github.io/UFO/getting_started/quick_start_ufo2/) — documented Windows, Python, Git, clone, and dependency requirements.

<a id="u4"></a>**U4.** [HostAgent overview](https://microsoft.github.io/UFO/ufo2/host_agent/overview/), [HostAgent strategy](https://microsoft.github.io/UFO/ufo2/host_agent/strategy/), and [platform sessions](https://microsoft.github.io/UFO/infrastructure/modules/platform_sessions/) — host/app hierarchy, process and window observation, orchestration, and shared state.

<a id="u5"></a>**U5.** [AppAgent overview](https://microsoft.github.io/UFO/ufo2/app_agent/overview/), [AppAgent strategy](https://microsoft.github.io/UFO/ufo2/app_agent/strategy/), and [HostAgent states](https://microsoft.github.io/UFO/ufo2/host_agent/state/) — ReAct loop, screenshots/UI controls, memory, action execution, and confirmation state.

<a id="u6"></a>**U6.** [MCP overview](https://microsoft.github.io/UFO/mcp/overview/), [local MCP servers](https://microsoft.github.io/UFO/mcp/local_servers/), and [HostAgent commands](https://microsoft.github.io/UFO/ufo2/host_agent/commands/) — collectors, UI executors, shell, COM/API tools, local/remote/stdio transports, and dynamic tool availability.

<a id="u7"></a>**U7.** [UFO client overview](https://microsoft.github.io/UFO/client/overview/) and [agent overview](https://microsoft.github.io/UFO/infrastructure/agents/overview/) — broader platform facilities, including filesystem and command operations, and a documented clipboard-mediated Office example. Some facilities apply to the broader UFO³/Galaxy stack rather than necessarily to a minimal UFO² process; that distinction is preserved below.

<a id="u8"></a>**U8.** [System configuration](https://microsoft.github.io/UFO/configuration/system/system_config/) and [configuration migration](https://microsoft.github.io/UFO/configuration/system/migration/) — control backends, safeguards, MCP/API fallback, step bounds, logging, screenshots, and RAG settings.

<a id="u9"></a>**U9.** [Model configuration](https://microsoft.github.io/UFO/configuration/models/overview/) and [FAQ](https://microsoft.github.io/UFO/faq/) — model providers, endpoints/configurability, vision requirements, and documented per-step latency expectations.

<a id="u10"></a>**U10.** [UFO² log reference](https://microsoft.github.io/UFO/ufo2/evaluation/logs/overview/) — request, response, evaluation, screenshot, and UI-tree artifacts.

<a id="u11"></a>**U11.** [Server overview](https://microsoft.github.io/UFO/server/overview/) — optional FastAPI/WebSocket service, bind behavior, endpoints, device telemetry, and production-readiness warning.

<a id="u12"></a>**U12.** [`requirements.txt`](https://github.com/microsoft/UFO/blob/main/requirements.txt) — direct Python dependencies and version constraints.

<a id="u13"></a>**U13.** [Price configuration](https://microsoft.github.io/UFO/configuration/system/prices_config/) — token/cost estimation and the warning that bundled price data may be outdated.

<a id="u14"></a>**U14.** [MIT license](https://github.com/microsoft/UFO/blob/main/LICENSE), [disclaimer](https://github.com/microsoft/UFO/blob/main/DISCLAIMER.md), and [security policy](https://github.com/microsoft/UFO/blob/main/SECURITY.md) — reuse obligations, warranty disclaimer, screenshot handling statement, controlled-environment warning, and vulnerability-reporting route.

<a id="u15"></a>**U15.** GitHub security advisories: [stored replay command injection](https://github.com/microsoft/UFO/security/advisories/GHSA-wj72-7w8h-695f), [DNS rebinding](https://github.com/microsoft/UFO/security/advisories/GHSA-vf4c-mf32-gf2h), [IPv6 SSRF](https://github.com/microsoft/UFO/security/advisories/GHSA-7hrg-r8xr-p8gr), and [unauthenticated mobile MCP access](https://github.com/microsoft/UFO/security/advisories/GHSA-24fq-m9rr-g3mm) — affected-version and patched-version metadata.

### AVA sources in this repository

<a id="a1"></a>**A1.** [`docs/architecture/03-tools-catalog.md`](../../architecture/03-tools-catalog.md) and [`docs/architecture/04-safety-policy-approvals.md`](../../architecture/04-safety-policy-approvals.md) — current AVA tool and approval model.

<a id="a2"></a>**A2.** [`server/src/tools/control-app-mcp.ts`](../../../server/src/tools/control-app-mcp.ts) and [`server/src/tools/computer-use-mcp.ts`](../../../server/src/tools/computer-use-mcp.ts) — AVA Windows UI Automation/SendKeys and browser-computer-use paths.

<a id="a3"></a>**A3.** [`server/src/tools/screenshot/screenshot.ts`](../../../server/src/tools/screenshot/screenshot.ts) and [`server/src/tools/screenshot/look-mcp.ts`](../../../server/src/tools/screenshot/look-mcp.ts) — AVA desktop screenshot capture and vision path.

<a id="a4"></a>**A4.** [`server/src/tools/shell.ts`](../../../server/src/tools/shell.ts), [`server/src/tools/filesystem.ts`](../../../server/src/tools/filesystem.ts), and [`server/src/policy/classify.ts`](../../../server/src/policy/classify.ts) — AVA shell/filesystem capability and tool-specific risk classification.

<a id="a5"></a>**A5.** [`server/src/process/kill-tree.ts`](../../../server/src/process/kill-tree.ts) and [`docs/features/stop-tree-kill.md`](../../features/stop-tree-kill.md) — AVA-owned PID registration and descendant termination.

<a id="a6"></a>**A6.** [`docs/features/security-hardening.md`](../../features/security-hardening.md) and [`docs/features/shell-powershell.md`](../../features/shell-powershell.md) — current Windows execution and hardening boundaries.

## Verified evidence

### Project identity, license, and maintenance health

- The repository describes UFO as a Windows OS interaction agent. UFO² is the Windows-native host/app-agent line and is described as actively maintained/LTS, while UFO³/Galaxy is a broader evolving stack. This assessment confines any possible later evaluation to a frozen UFO² subset and excludes Galaxy, mobile, Linux client, and server components. [U1](#u1)
- On the access date, GitHub listed `v3.0.8` dated 2026-08-10 after `v3.0.7` dated 2026-06-12. The `v3.0.8` tip documents an IPv6-transition SSRF guard. This is evidence of recent maintenance, not evidence that the release is safe or that all advisories are resolved. [U2](#u2)
- UFO is MIT-licensed. Copying or redistributing the software or substantial portions requires retaining the copyright and permission notice; the software is provided without warranty. A later internal evaluation would still preserve the license file and attribution in its evidence bundle. [U14](#u14)
- Recent advisories cover stored replay command injection, DNS rebinding, IPv6 SSRF, and unauthenticated mobile MCP access. Several advisory pages do not identify a patched release, while the `v3.0.8` tip specifically records the SSRF guard. The applicability and remediation status of every advisory for an exact minimal UFO² `v3.0.8` build is therefore not established by the canonical metadata reviewed. [U2](#u2) [U15](#u15)

### Architecture and data flow

UFO² uses a two-level architecture. A HostAgent observes the desktop and process/window metadata, launches or selects applications, maintains a global blackboard/state machine, and delegates to per-application AppAgents. An AppAgent repeatedly captures application state, builds an LLM request from the user goal, screenshot/UI controls and memory, selects actions, executes them through UI or API/MCP tools, and records the result. [U4](#u4) [U5](#u5)

```text
user goal
   |
   v
HostAgent -- desktop screenshot + process/window/UI metadata --> model provider
   |                                                       ^          |
   | launch/select app, shared blackboard                  |          | plan/tool choice
   v                                                       |          v
AppAgent -- app screenshot + UI tree + history + RAG ------+     action executor
   ^                                                                  |
   | result, new screenshot, logs                                    +-- UIA/click/type/scroll
   +-----------------------------------------------------------------+-- COM/native API/MCP
                                                                     +-- shell/child process
                                                                     +-- optional remote HTTP/MCP

Local side stores: configuration/secrets, request and response logs,
screenshots/UI trees, action/session records, and optional learned/RAG artifacts.
```

The diagram combines the documented host/app loops, MCP executors, logs, and optional RAG. Whether a particular datum leaves the VM depends on the frozen model, RAG, MCP, and server configuration; current documentation permits multiple such configurations. [U1](#u1) [U4](#u4) [U5](#u5) [U6](#u6) [U8](#u8) [U10](#u10)

### Supported Windows configurations and dependencies

- The UFO² quick start documents Windows 10 or later, Python 3.10 or later, Git, repository cloning, and installation from `requirements.txt`. It does not specify an exhaustive tested matrix of Windows editions, builds, security modes, architectures, or Python patch versions. [U3](#u3)
- The requirements file includes model/client, web/server, data, image, automation, and Windows packages. Windows-facing dependencies include `pywin32`, `pywinauto`, `pyautogui`, `uiautomation`, and `comtypes`; other dependencies include OpenAI/Anthropic clients, FastAPI/Uvicorn/FastMCP/websockets, LangChain, MSAL, Pillow, NumPy/Pandas, and FAISS. Most direct entries are version-constrained, but the file is not a hash-locked transitive dependency manifest. [U12](#u12)
- UFO can use UI Automation and GUI input as well as application-native COM/API routes. The documented default configuration enables MCP and API use, permits UI fallback, uses UIA control, and sets `SAFE_GUARD` false. The documented safeguard limits control types; it is not a semantic policy against sending messages, purchasing, deleting, or disclosing data. [U6](#u6) [U8](#u8)
- The documented Picture-in-Picture desktop is described as future work, so it cannot be treated as an available containment layer. [U1](#u1)

### Model providers, screenshots, UI state, and knowledge sources

The model configuration supports OpenAI, Azure OpenAI, Gemini, Claude, Qwen, DeepSeek, Ollama, and custom endpoints; host, app, backup, and evaluation roles can be configured separately. External providers require their provider-specific endpoint/deployment and API credential, while local Ollama still introduces a local model service and model-artifact dependency. The documented OpenAI example uses `https://api.openai.com/v1/chat/completions`; Azure and custom bases are configurable rather than a closed endpoint set. Visual GUI operation is documented around vision-capable models. Screenshots, UI control metadata, the request, history, retrieved material, and execution feedback can become model inputs. [U5](#u5) [U9](#u9)

The project disclaimer says desktop/application screenshots are sent to GPT and says Microsoft does not collect or permanently store those transmitted screenshots. It also warns users to keep sensitive material out of view and use a secure, controlled environment. That statement does not establish the policy of a chosen third-party model endpoint and does not negate UFO's documented local logs. [U10](#u10) [U14](#u14)

Optional RAG can search Bing and can use offline documents, demonstrations, and prior execution experience/vector stores. Those paths add outbound queries and persistent local derivatives of task data unless disabled. [U1](#u1) [U5](#u5) [U8](#u8)

### Logging, telemetry, retention, and persistence

Documented UFO² artifacts include `request.log` with LLM prompt requests, `response.log` with agent responses/execution information, evaluation output, screenshots, and UI trees beneath task log directories. The system configuration also exposes Markdown logging, last-screenshot inclusion, screenshot-to-memory, and UI-tree logging options. No canonical retention duration, pruning guarantee, or complete uninstall/removal procedure was found in the reviewed sources. [U8](#u8) [U10](#u10)

The optional server exposes HTTP/WebSocket functions, device telemetry, and by default can bind to `0.0.0.0:5000`; its documentation says the default setup is not production-ready and discusses authentication/TLS hardening. This server is unnecessary for the proposed minimal UFO² evaluation and must be absent, not merely unused. [U11](#u11)

No canonical source reviewed establishes a separate Microsoft product-analytics endpoint for the minimal UFO² path. That absence is not proof of no telemetry: custom providers, remote MCP servers, optional server/client components, dependency behavior, update/download paths, and configuration can alter network behavior. Exact endpoints and provider retention remain unresolved until a frozen artifact and configuration have a complete static inventory. [U6](#u6) [U9](#u9) [U11](#u11) [U12](#u12)

Potential residue includes the source tree, virtual environment and package caches, configuration/API secrets, logs, screenshots, UI trees, request/response/action/session records, optional demonstration/experience/vector databases, temporary files, model caches, and child-server logs. The list combines documented artifact types and ordinary consequences of the documented clone/install/configuration process; completeness is not yet verified. [U1](#u1) [U3](#u3) [U5](#u5) [U10](#u10) [U12](#u12)

### Latency and cost scenarios

The FAQ says GPT-4o steps commonly take roughly 10–30 seconds, with visual processing, network conditions, and provider load affecting latency. The documented system default allows up to 50 steps and can involve both host and app reasoning, retries, backup/evaluation roles, and additional RAG/tool calls. A short synthetic task could therefore range from a few model turns to many minutes; a near-limit or retry-heavy task could make dozens of model calls. These are planning scenarios, not benchmark results. [U8](#u8) [U9](#u9)

UFO estimates prompt/completion token cost from a prices file and warns that its bundled prices may be outdated. No monetary ceiling is invented here. Before any future run, the chosen provider's then-current canonical price, image-token method, role/call graph, maximum steps/rounds/retries, and hard time/token/request budgets must be recorded and separately approved; actual provider receipts must be reconciled afterward. [U13](#u13)

## Consequential-action inventory

This is the minimum closed inventory that a future evaluator would have to prove for the frozen build. “Block” means the AVA mediation layer denies the channel; “blocker” means testing cannot start until the channel can be proven absent or completely mediated.

| Channel | Verified capability or uncertainty | Consequence | Proposed default |
|---|---|---|---|
| Observe desktop/app screenshot | Host and app strategies capture desktop/app images. [U4](#u4) [U5](#u5) | Captures visible secrets and personal data | Synthetic VM only; local receipt only; external transmission separately approved |
| Enumerate windows/processes/UI tree | Host observes applications/processes; AppAgent consumes controls/UI metadata. [U4](#u4) [U5](#u5) | Reveals titles, structure, process context | Allow only inside synthetic VM; redact/deny unexpected windows |
| Focus/select/launch application | Host/UI executor focuses, selects, and launches apps. [U4](#u4) [U6](#u6) | Changes foreground ownership; starts processes | Frozen executable/window allowlist; per-action confirmation |
| Mouse click/double-click/scroll/drag | UI executor provides GUI/UIA operations. [U6](#u6) | Can activate any visible consequential control | Synthetic test app only; semantic target check and confirmation |
| Keyboard/type/set-text/hotkey | UI executor provides typing and key operations. [U6](#u6) [U8](#u8) | Can submit forms, invoke shortcuts, enter data | Synthetic data only; block submit/send/delete shortcuts |
| UI Automation invocation | UIA is a documented control backend. [U6](#u6) [U8](#u8) | Can activate controls without visible pointer path | Frozen control class/name/action allowlist; deny unknown controls |
| Native/COM application API | Word, Excel, PowerPoint and other local API tools are documented. [U6](#u6) | Can read/write documents and bypass GUI-only checks | Absent in initial configuration; load failure if discovered |
| Shell/command execution | Command-line executor and stdio MCP child-process paths are documented. [U6](#u6) | Arbitrary process/file/network effects within OS authority | No shell tool; process-policy deny; discovery is a blocker/stop |
| Filesystem read/write/delete | Broader client tooling documents filesystem operations; logs and memory necessarily write locally. Exact minimal-UFO² reach is not closed. [U7](#u7) [U10](#u10) | Disclosure, modification, deletion, residue | VM test directory only for evaluator-owned logs; delete API blocked; unresolved reach is a blocker |
| Clipboard read/write/paste | A documented Office workflow uses clipboard copy/paste, but a complete direct clipboard API inventory was not found. [U7](#u7) | Cross-boundary secret theft or injection | Disable VM clipboard integration; block hotkeys/APIs; unknown access is a blocker |
| Registry/WMI/Win32 | The broader Windows client overview names these platform facilities; minimal UFO² applicability is unresolved. [U7](#u7) | Persistence, configuration, system discovery | Deny by OS/process policy; any reach is a blocker |
| Remote HTTP MCP | MCP can use remote HTTP. [U6](#u6) | Sends task/UI data; receives new action surface | No remote MCP; network deny and configuration load failure |
| Stdio/local MCP server | MCP can start or connect to local/stdio servers and dynamically discover tools. [U6](#u6) | Child process and expandable authority | Only a signed AVA mediator, if later built; every other server blocked |
| REST/native network API | MCP/API design permits native/REST actions. [U6](#u6) | Consequential external mutation and disclosure | No API tools; outbound network deny |
| Model request | Model roles receive visual/textual state. [U5](#u5) [U9](#u9) | Exports screenshots, UI state, prompt, memory, results | No external provider without Niko's separate data-transmission approval |
| Bing/online RAG | Optional Bing search uses task-derived queries. [U1](#u1) [U8](#u8) | Exports query/task context | Disabled and endpoint blocked |
| Experience/demo/vector memory | UFO can save learned trajectories and retrieve demonstrations. [U1](#u1) [U5](#u5) | Persists sensitive derivatives; replay poisoning | Disabled; fresh VM; no replay across runs |
| Logs/screenshots/UI trees | Request, response, screenshot, and UI-tree artifacts are documented. [U8](#u8) [U10](#u10) | Local sensitive retention | Minimal local receipts in encrypted VM; destroy VM after export of approved redacted evidence |
| Optional HTTP/WebSocket server | Server can expose tasks/results/device telemetry and listen on all interfaces. [U11](#u11) | Remote control, data exposure, task collision | Component absent; any listener is an automatic stop |
| Background/autostart/service/update | No complete canonical negative inventory or removal guarantee was found | Persistence or unsupervised autonomy | Block startup/service/task creation; unexpected child/background process is a blocker/stop |
| Custom plugin/model/dependency egress | Providers, MCP tools, and dependencies are configurable/dynamic. [U6](#u6) [U9](#u9) [U12](#u12) | Unenumerated authority or data export | Frozen hashes/SBOM/config required; every unknown endpoint/tool is a blocker |

Purchases, financial transactions, messaging, posting, account changes, credential entry, deletion, destructive edits, privilege changes, persistence, background autonomy, and access outside the synthetic VM are hard-denied even if a model, UI label, or in-product confirmation suggests otherwise.

## Outbound-data and network inventory

| Destination/path | Potential data | Status for a future test |
|---|---|---|
| Configured primary/backup/evaluation model endpoints | Prompt, screenshots, UI tree/control metadata, window/process context, history/memory, retrieved text, action results, tokens/metadata [U5](#u5) [U9](#u9) | Denied unless Niko separately approves the exact provider, endpoint, fields, retention terms, credential, and run |
| Bing or another online retriever | Task-derived search query and network metadata [U1](#u1) [U8](#u8) | Disabled and denied |
| Remote MCP/REST API | Tool arguments, documents/UI data, results, protocol metadata [U6](#u6) | No allowlist entry; denied |
| Optional UFO HTTP/WebSocket server and clients | Tasks, commands, results, device telemetry [U11](#u11) | Server/client components absent; inbound and outbound denied |
| Package, Git, model, update, or artifact hosts | Host fingerprint, requested packages/artifacts, credentials, downloaded code [U3](#u3) [U12](#u12) | No network acquisition during a run; any later acquisition occurs in a separate approved staging gate with hashes |
| DNS, redirects, proxies, IPv4/IPv6 and private/link-local ranges | Destination names/traffic and possible SSRF reach [U15](#u15) | Forced through evaluator proxy; deny by default; private, host, metadata, multicast and link-local destinations blocked in both IP families |
| Crash reporting/product analytics/dependency telemetry | Unknown; no closed canonical endpoint inventory was found | Blocking unknown until static and observed-in-a-separate-approved-test inventories agree |
| VM-to-host integrations | Clipboard, shared folders/drives, drag/drop, device forwarding, guest tools, host services | Disabled; no data channel to normal environment |

The frozen endpoint allowlist begins empty. If Niko later approves cloud vision, it contains only the exact model hostname/IP-validation policy and proxy route for that one run; DNS names, redirects, certificate identity, request fields, and byte counts are receipted. A provider allowlist never implicitly allows RAG, MCP, telemetry, package, or update traffic.

## Collision analysis with AVA's Windows controls

| Collision | Current AVA behavior | Risk if UFO runs independently | Required resolution |
|---|---|---|---|
| Foreground/focus and keyboard/mouse ownership | AVA `control_app` uses UI Automation/SendKeys and browser computer-use performs visual actions. [A1](#a1) [A2](#a2) | Interleaved actions, wrong-window input, focus stealing, stale screenshots | Exclusive VM desktop lease; AVA pauses all other UI controllers; focus/window identity checked before every action |
| Screenshot/vision flow | AVA can capture the full desktop and can send visual browser state to model providers. [A2](#a2) [A3](#a3) | Duplicate or unapproved capture/export; normal desktop leakage | UFO receives only VM display; AVA screenshot and provider policies do not automatically authorize UFO transmission |
| Shell/filesystem authority | AVA exposes separately classified shell and filesystem tools. [A1](#a1) [A4](#a4) | UFO shell/API actions could bypass AVA's tool names, scopes, and approval classification | UFO gets no direct shell/filesystem capability; all such requests must reach a dedicated AVA broker and default-deny |
| Risk and confirmation policy | AVA classifies known tool/action pairs and requires approval by policy. [A1](#a1) [A4](#a4) | UFO's model-controlled confirmation state and dynamically discovered tools are outside that classifier | Stable UFO capability IDs mapped to AVA policy; unknown ID cannot execute; in-product confirmation has no authority |
| Process stop/kill | AVA Stop terminates registered owned PIDs and descendants. [A5](#a5) | An independently launched UFO/MCP process may not be registered and can outlive a run | Supervisor registers every process before resume; host-side VM power/network kill remains authoritative |
| Script/log residue | AVA Windows tools and screenshots have known local paths and run receipts. [A2](#a2) [A3](#a3) | UFO adds separate logs, images, vector stores, scripts, caches, and secrets | Disposable VM only; explicit artifact manifest; snapshot rollback/destroy rather than trusting uninstall |
| Browser/Office ownership | AVA already has browser visual control and Windows application automation. [A1](#a1) [A2](#a2) | Competing agents can mutate the same session/document or trigger sync/external actions | No personal browser/Office session; initial evaluation uses one synthetic local harness; no concurrent AVA controller |

No current AVA component is demonstrated to mediate all UFO UIA, raw input, COM/API, shell, MCP, clipboard, filesystem, and network routes. Existing AVA safety and Stop behavior therefore cannot be inherited by configuration or assertion; a dedicated boundary must be designed and proven before a run.

## Assumptions

These are planning assumptions, not verified properties of UFO:

1. A later evaluator could obtain and independently hash one immutable source artifact corresponding to a reviewed commit, rather than following a moving branch.
2. UFO² can be configured without Galaxy, the optional HTTP/WebSocket server, mobile/Linux clients, remote MCP, online RAG, experience replay, evaluation agents, COM/API servers, and shell tools. Static inspection must prove the exclusions before this assumption can be relied upon.
3. A disposable Windows VM can be provisioned with clipboard, shared folders/drives, drag/drop, host integration, device forwarding, personal accounts, sync, and host-network reach disabled.
4. A future AVA-owned broker could represent each allowed observation/action as a stable, typed capability and prevent UFO from reaching equivalent OS facilities by another route. If raw UI/input authority cannot be removed while preserving the test's purpose, this assumption fails.
5. A synthetic local application can exercise observation, focus, click, and typing without credentials, personal information, messaging, purchases, deletion, or an external service.
6. Niko may choose either no model egress or a separately reviewed provider path later. No provider, retention term, cost, or screenshot transmission is assumed approved by this document.

## Unresolved questions and blocking evidence gaps

Each item below blocks acquisition or execution until resolved in a new approved gate:

1. **Exact source and advisory status.** Which immutable commit would be evaluated, and does a line-by-line applicability matrix show that every relevant published advisory is fixed or absent from that component set? Current advisory pages and the `v3.0.8` release metadata do not provide a complete mapping. [U2](#u2) [U15](#u15)
2. **Closed action graph.** What tools, commands, plugins, MCP servers, fallback executors, COM/native APIs, shell routes, and dynamic imports are reachable from the frozen configuration? Documentation says tool availability depends on configuration and connections. [U6](#u6) [U8](#u8)
3. **Closed outbound graph.** What exact DNS names, redirects, IP families, local listeners, proxy bypasses, provider calls, RAG calls, MCP transports, dependency telemetry, update/download behavior, and crash paths exist in the frozen artifact?
4. **Mediator completeness.** Can an AVA-owned deny-by-default broker intercept every UIA, raw input, window/process, filesystem, clipboard, COM/API, child-process, and network operation without leaving an equivalent direct path?
5. **Clipboard reach.** Does the minimal UFO² subset directly read or set the clipboard, indirectly invoke it through hotkeys/Office APIs, or inherit VM integration? Canonical documentation demonstrates a clipboard workflow but not a closed API inventory. [U7](#u7)
6. **Filesystem and OS reach.** Which directories, registry keys, WMI/Win32 calls, symlinks/junctions, environment variables, named pipes, sockets, and device interfaces can the exact process tree reach?
7. **Retention and deletion.** What creates each log, screenshot, UI tree, prompt/response, cache, memory/vector, temporary, credential, and server artifact; what is its retention; and can removal be independently verified? [U8](#u8) [U10](#u10)
8. **Supply chain.** What is the complete transitive SBOM, artifact/wheel provenance, hash set, signature status, build script behavior, known-vulnerability result, and license obligation for the frozen dependency graph? `requirements.txt` alone is not that evidence. [U12](#u12)
9. **Windows matrix.** Which exact Windows edition/build, Python build, display/session mode, UIA backend, locale, DPI, security controls, and dependency versions are supported and reproducible beyond the broad Windows 10+ statement? [U3](#u3)
10. **Provider governance.** If cloud inference is proposed, what exact request fields include pixels/UI state, where are they processed, what are the provider's then-current retention/training/abuse-monitoring terms, what credential scope is used, and what deletion/audit evidence is available?
11. **Cost and latency envelope.** For the frozen call graph and provider, what are the current canonical prices, image-token accounting, maximum role calls/retries, and Niko-approved request/token/time budgets? Bundled UFO prices cannot be treated as current. [U13](#u13)
12. **Stop and cleanup proof.** Can the external supervisor cut network, stop every descendant/listener, prevent restart, and destroy all residue even during focus races, hangs, exceptions, provider timeouts, or guest compromise?

## Disqualifying findings

No permanent rejection condition is established solely by the reviewed documentation. That does not authorize testing. The candidate must be rejected without a run if later static evidence shows any of the following:

- an applicable unpatched critical/high-impact vulnerability in the frozen minimal component set;
- a consequential action or outbound channel that cannot be removed or completely mediated;
- required administrator/kernel authority, host integration, personal credentials/accounts, or normal-environment access;
- an unavoidable external screenshot/UI-state transmission that Niko has not separately approved;
- unavoidable shell, COM, clipboard, filesystem deletion, remote MCP, public listener, persistence, background autonomy, online RAG, or replay-learning authority;
- an artifact or dependency whose provenance/integrity/license cannot be resolved;
- a provider or component whose retention/deletion/network behavior cannot satisfy the frozen policy; or
- a rollback design that depends on UFO's own cooperation instead of host-side VM destruction.

## Threat model

### Assets

Protected assets are Niko's normal host and accounts; credentials/tokens; personal, business, and AVA data; clipboard and files; messages and financial state; AVA's policy/receipts/control plane; the integrity of the evaluation result; and third parties reachable through applications or networks.

### Adversaries and failure modes

- a malicious or compromised source/dependency/model/MCP server;
- prompt injection in UI text, documents, retrieved content, logs, or replay memories;
- an inaccurate model plan, hallucinated target, stale screenshot, focus race, or UI spoof;
- a tool/schema mismatch, fallback to a broader executor, or dynamically discovered capability;
- SSRF, DNS rebinding, IPv4/IPv6 bypass, proxy bypass, exposed listener, or covert dependency egress;
- malicious synthetic content attempting path traversal, symlink/junction escape, clipboard theft, shell/COM execution, or persistence;
- AVA and UFO concurrently controlling the same foreground desktop;
- crash, hang, orphaned descendant, incomplete cleanup, log leakage, or supervisor/guest disagreement; and
- an evaluator accidentally expanding an allowlist, using real data/account state, or treating UFO's confirmation as AVA authorization.

### Trust boundaries

The model and all UFO-generated plans are untrusted. The guest VM, downloaded artifact, dependencies, MCP servers, and synthetic content are also treated as untrusted. Only the host-side evaluation controller, immutable policy, network enforcement, artifact hashes, and append-only receipts may authorize or attest an action. Niko is the authority for gate changes and cloud UI transmission.

## Proposed layered fail-closed containment

This section is a design, not an implemented control set. Failure or absence of any layer blocks a future run; layers do not compensate for a known bypass in another layer.

### 1. Disposable-VM boundary

- Use a fresh, non-domain-joined Windows VM built from an independently verified image and a pre-run snapshot.
- Expose no host clipboard, shared folder/drive, drag/drop, host browser, USB/device forwarding, personal account, cloud sync, saved credential, or host automation socket.
- Present only a synthetic local test application and generated non-sensitive documents. Do not install or sign into mail, messaging, shopping, finance, social, enterprise, password-manager, or personal browser profiles.
- Give the VM no route to the host, LAN, metadata services, private/link-local ranges, or other guests. A host-side controller owns display observation, virtual NIC, process supervision, snapshot, and power-off.
- Treat snapshot restore followed by VM destruction as the authoritative removal mechanism.

### 2. OS boundary

- Run as a dedicated standard local user with no administrator rights, domain identity, cached credentials, developer mode, remote desktop, accessibility elevation, or interactive access to another session.
- Apply an executable/script/library allow policy and deny PowerShell, `cmd`, WSH, installers, package managers, Office, browsers, registry editors, task/service tools, and unapproved interpreters from the evaluation identity.
- Deny writes outside evaluator-owned scratch/log paths; deny registry startup keys, services, scheduled tasks, startup folders, system directories, named persistence points, raw devices, and cross-user data.
- Disable clipboard history/sync, VM integration clipboard, shared-drive automount, notifications containing real data, indexing/sync, sleep/resume autonomy, and guest-initiated time extensions.
- Fix locale, DPI, resolution, theme, app build, and synthetic state in the run manifest to reduce UI ambiguity.

### 3. Process boundary

- Start every allowed process suspended under an external supervisor/job boundary; validate its executable hash, parent, command line, environment, modules, and policy before resume.
- Allow only the frozen Python executable, audited UFO entry point, required signed libraries, synthetic harness, and AVA broker. No shell, package manager, compiler, updater, debugger, remote server, Office process, browser, or independent MCP process is allowed.
- Register and continuously reconcile the complete process tree and listeners. Deny child creation unless the exact child hash/role is in the frozen manifest.
- Set Niko-approved wall-time, step, request, token, CPU, memory, output-size, and retry limits before the run. No default becomes an implicit budget.
- The supervisor, not the guest agent, kills the process tree and powers off the VM. An orphan, reparent, restart, detached/background process, or policy-observation failure triggers network cut and destruction.

### 4. Network boundary

- Begin with the virtual NIC disconnected and an empty destination allowlist.
- If Niko separately approves one cloud model flow, force it through an authenticated evaluator proxy outside the guest. Permit only the exact endpoint identity and method; validate DNS on every connection/redirect and block literal/private/link-local/multicast/metadata/host/LAN addresses in IPv4 and IPv6.
- Deny direct DNS, UDP/QUIC, peer-to-peer, inbound connections, local/public listeners, remote MCP, RAG/search, package/Git/model downloads, telemetry, crash upload, update checks, and proxy bypass.
- The proxy records timestamps, destination/certificate, method, content type, byte counts, request classification, and receipt/run IDs. Pixel/text contents remain local unless explicitly approved for the exact flow.
- A network packet without a matching frozen rule is dropped and ends the run; it is never approved interactively after observation.

### 5. Application boundary

- Use one synthetic, deterministic local harness with explicit window/process/control identities and fake text. Do not use real Office, browser, filesystem-management, settings, terminal, mail, or third-party applications in the initial evaluation.
- Disable online RAG, experience learning/replay, evaluation/backup roles, COM/native APIs, shell commands, remote/local non-AVA MCP servers, server/client/Galaxy components, and UI fallback around the broker.
- Limit observations to the harness window and an evaluator-owned status overlay. Unexpected windows, prompts, focus, controls, pixels, or process metadata are redacted and stop the run.
- Keep run memory ephemeral. Only the minimal approved receipt set may be exported; prompt/response logs, screenshots, UI trees, caches, and vector stores remain in the disposable VM unless separately reviewed and redacted.

### 6. AVA-owned deny-by-default mediation boundary

- UFO never directly exercises UIA, raw keyboard/mouse, process launch, filesystem, clipboard, COM/API, shell, network, or MCP authority. It emits a typed request to the AVA broker.
- The broker accepts only frozen capability IDs, schemas, target process/window/control identities, argument constraints, state preconditions, and run/step nonces. It re-observes the target immediately before execution and rejects stale state, ambiguous controls, overlays, focus changes, untrusted text-derived targets, or policy-version mismatch.
- The broker maps requested intent to effective OS events, performs semantic consequence checks, obtains any required Niko confirmation, executes at most one bounded action, then records and verifies the resulting state. Batch/speculative multi-actions are disabled.
- Unknown tools, optional arguments, schema versions, actions, targets, transports, model roles, plugins, MCP servers, fallback paths, and equivalent bypasses are denied. UFO cannot change policy, request an emergency exception, or treat its own `CONFIRM` state as authorization.
- If direct OS authority cannot be technically removed and mediation cannot be proven complete, the evaluation does not run.

## Frozen initial allowlists and hard denies

The following lists are proposals for a later approval package. They are not active authorization.

| Object | Initial allowlist |
|---|---|
| Source | One immutable commit/tag artifact, archive hash, dependency hashes, SBOM, configuration hash, and advisory matrix; values remain unset until independently verified |
| Processes | External supervisor, AVA broker, frozen Python/UFO process, and synthetic harness only |
| Applications/windows | One evaluator-built local synthetic harness with exact binary hash, process ID lineage, window class/title pattern, and control map |
| Observation | Harness client area and evaluator status overlay only; no full normal desktop |
| UI actions | Observe, focus harness, single click on named inert test controls, and type generated synthetic text into named non-submitting fields |
| Files | Evaluator-created VM scratch/log directories only, with path-handle validation against links/junctions; no user/host/shared paths |
| Network | Empty by default; one exact model proxy route only after Niko's separate cloud UI-state approval |
| Model roles | One frozen role/configuration only; no backup/evaluator/online retriever or automatic provider fallback |
| MCP/API | AVA broker only; no remote MCP, shell, COM, native app API, REST action, server/client/Galaxy component, or dynamic discovery |
| Data | Generated synthetic labels, numbers, and documents carrying a visible `SYNTHETIC` marker; no credentials, personal identifiers, or copied production data |

Hard denies have no per-run override: purchases or other financial actions; messaging, posting, calling, inviting, or external form submission; account creation/login/change; credential/token/API-key entry; deletion or destructive modification; privilege/security-setting changes; shell/PowerShell/command execution; arbitrary file/registry/WMI/Win32 access; clipboard access; COM/native/REST actions; package/update/download activity; persistence, startup, services, scheduled tasks, background autonomy, replay learning, remote control, and access to Niko's normal environment.

## Confirmation rules

1. Niko approves the frozen evaluation manifest before the VM receives the artifact or any code is installed/executed.
2. Niko gives a separate, explicit approval for the exact external model/provider request schema before any screenshot, pixels, UI tree/state, window/process metadata, prompt history, or action result may leave the VM. General evaluation approval does not imply this approval.
3. At the start of a later run, Niko confirms the task, artifact/configuration hashes, synthetic dataset, allowlists, provider/egress state, budgets, and rollback target.
4. During the first evaluation, every state-changing allowed UI action (focus, click, or typing) requires an AVA-issued per-action confirmation showing the fresh before-state, semantic target, exact text/event, predicted consequence, and destination. Observation of the approved harness may proceed only within the task-level observation grant.
5. A changed target, focus, screenshot, UI tree, control identity, action argument, model output, policy hash, or elapsed confirmation nonce invalidates approval and requires a new request.
6. Hard-denied actions cannot be authorized from inside a run. Any desired expansion ends the run and requires a new proposal/approval; it is not an interactive allowlist edit.

UFO's documented confirmation state is useful as an agent signal but is not an authority boundary because the model participates in state transitions. [U5](#u5)

## Receipts and evidence integrity

For every observation request, decision, action attempt, network attempt, stop, and cleanup event, the AVA controller records an append-only receipt containing:

- run/step/parent IDs, monotonic sequence, timestamps, artifact/configuration/policy hashes, VM/snapshot identity, and actor;
- original UFO request and normalized capability ID, model role, target process/window/control, arguments or content hash, and synthetic-data label;
- fresh precondition observation hash, focus/overlay checks, risk classification, allow/deny reason, Niko confirmation ID where required, and the effective low-level event;
- before/after local screenshot/UI-state hashes (pixels remain local unless separately approved), resulting state, exception/timeout, child-process and listener deltas;
- network rule/attempt, resolved addresses in both IP families, certificate/destination, redirect chain, request class and byte counts without silently retaining prohibited content;
- budget counters, kill/rollback events, exported-artifact manifest, redaction decision, credential revocation, snapshot destruction, and cleanup verification.

Receipts are written by the external controller to storage the guest cannot modify. A sequence gap, hash mismatch, clock/nonce anomaly, lost observer, or controller/guest disagreement is an automatic stop and invalidates the run evidence.

## Kill switch, rollback, and removal

The kill switch is host-side and reachable independently of UFO, the guest UI, and the guest network. One activation atomically blocks the VM's virtual NIC, prevents new guest execution, terminates the supervised process tree, captures only the already-approved minimal forensic metadata, and powers off the VM. If graceful termination competes with containment, power-off wins.

Rollback restores no agent state: discard the run VM/snapshot, revoke and verify revocation of any disposable scoped provider credential, invalidate proxy/run nonces, delete proxy queues and unapproved local captures, and verify that no listener, child process, virtual disk attachment, shared integration, or exported unredacted artifact remains. Preserve only the append-only controller receipts and explicitly approved redacted evidence. Because canonical documentation does not establish complete UFO removal, “uninstall” is not an accepted rollback strategy. [U10](#u10)

## Preconditions and acceptance criteria for a later evaluation

All of the following must be satisfied in a separately approved package before execution:

- the immutable artifact, commit, archive and dependency hashes, transitive SBOM, provenance/signature results, licenses, build/install behavior, and vulnerability scan are complete and reproducible;
- every security advisory is mapped to the frozen reachable component graph with evidence of remediation or non-applicability;
- static analysis yields closed action, subprocess, filesystem/registry/clipboard/COM, persistence, listener, and outbound-endpoint inventories, with no unknown or unmediated consequential path;
- the exact Windows/VM configuration is documented and the disposable boundary has no host clipboard, shared paths/devices, credentials, personal accounts, private-network route, or background autonomy;
- AVA mediation is the only route to any consequential OS action, and equivalence/bypass analysis covers UIA, raw input, APIs, shell, MCP, and fallback behavior;
- cloud UI-state transmission is absent or has Niko's separate exact provider/schema/retention approval;
- frozen allowlists, semantic confirmations, receipts, budgets, kill behavior, removal plan, and automatic stops are machine-enforced outside UFO;
- the test dataset and application are demonstrably synthetic and local; prohibited applications and outcomes cannot be reached;
- current provider pricing and the call/latency model are recorded without treating an outdated bundled table as a ceiling; and
- Niko has approved the full manifest and run after reviewing the remaining evidence.

If those preconditions are later met, a run is accepted only if every requested and effective action has a matching receipt and policy decision; every permitted action targets the intended current synthetic control; every prohibited/adversarial action is denied before OS effect; egress matches the exact allowlist byte-for-byte at the policy level; no unexpected process/listener/file/registry/persistence artifact occurs; Stop cuts authority and leaves no live descendant; rollback destroys all guest residue; and no personal, credential, host, or third-party data is observed or transmitted. Thresholds for timing, resource use, token/request counts, and cost must be set by Niko in that future manifest rather than invented here.

## Required adversarial tests (future, not performed)

A later approved evaluation must attempt at least the following using synthetic content:

- visible and hidden prompt injection in UI text, tool output, document content, accessibility names, image pixels, logs, and replay-like artifacts;
- misleading/duplicate controls, transparent overlays, moved windows, focus theft, stale screenshots, DPI/theme/locale changes, modal dialogs, and a target changed after confirmation;
- attempts to click Submit/Send/Buy/Delete, enter credentials, open account/authentication UI, message, purchase, delete, change settings, or escalate privilege;
- keyboard shortcuts and UIA patterns that imply clipboard, shell, browser, file picker, terminal, Run dialog, task manager, registry, settings, or accessibility escape;
- filesystem traversal, alternate data streams, symlinks/junctions, UNC/device paths, environment expansion, temp/cache escape, and read/write/delete outside scratch;
- direct child process, reparent/orphan, stdio MCP, COM/native API, dynamic tool discovery, fallback executor, plugin/import, service/task/startup, and restart attempts;
- model/RAG/MCP/package/update/crash/telemetry egress, direct DNS, redirect, alternate port/protocol, proxy bypass, literal IPv4/IPv6, DNS rebinding, private/link-local/metadata/LAN/host destinations, and inbound/listener attempts;
- screenshot or UI-tree requests containing synthetic canary secrets, including provider rejection, timeout, retry, backup-role, and redirect paths;
- poisoned demonstrations/memory, cross-run replay, fabricated confirmations/receipts, nonce reuse, policy/schema downgrade, receipt loss, and log tampering;
- simultaneous AVA controller activity, Stop during action, Stop during provider response, guest hang/crash, broker crash, network cut, snapshot failure, and cleanup after every fault.

Each test must demonstrate prevention at the boundary, not merely a model refusal. A test that cannot be safely induced within the disposable synthetic environment remains a blocking untested path.

## Automatic stop conditions

The external controller immediately cuts network and terminates/destroys the run on any of these events:

- any unknown, malformed, dynamically added, fallback, unmediated, or policy-mismatched tool/action/argument/target;
- any hard-denied or unconfirmed consequential action, batch/speculative action, stale-state action, target ambiguity, unexpected focus/window/overlay, or synthetic-data-label failure;
- any screenshot/UI-state export without the separate approval or any prohibited field in an otherwise approved request;
- any network packet, DNS answer, redirect, endpoint, certificate, protocol, listener, server, remote MCP, RAG, telemetry, update, package, or crash path outside the frozen allowlist;
- any clipboard, shell, COM/native/REST API, arbitrary filesystem/registry/WMI/Win32, deletion, credential, personal-account, messaging, purchase, privilege, persistence, service/task/startup, or background-autonomy attempt;
- any unexpected process/module/child/reparent/orphan/restart, executable or configuration hash drift, artifact mutation, policy/schema downgrade, or supervisor coverage loss;
- any receipt gap/tamper/hash mismatch, observer disagreement, approval nonce reuse, unbounded retry, budget/time/resource exhaustion, agent/broker/controller exception, or kill-switch impairment;
- any host/shared-path/device/private-network reach, real/personal/third-party data exposure, provider retention-policy discrepancy, or evaluator uncertainty; or
- any failed cleanup/revocation/snapshot/destruction verification.

No stopped run resumes. Changed evidence or desired scope produces a new manifest and Niko approval; it does not loosen the active policy.

## Future gated sequence

This design ends at documentation. If Niko later chooses to continue, the next proposal should first close the static evidence gaps and present one frozen artifact/configuration/SBOM/advisory/action/endpoint manifest. Only after Niko approves that package may a separate worker acquire code or dependencies in a staging boundary, and only after a second review may a disposable-VM run be proposed. Cloud pixels/UI state require their own explicit approval. Normal-environment access is outside this design. A fallback is neither selected nor advanced.

## Substantive finding

**More evidence required**

The canonical evidence establishes an active MIT-licensed Windows automation project and identifies a plausible layered containment design, but it does not close the frozen action and outbound-channel inventory, advisory-to-release mapping, clipboard/filesystem/subprocess reach, provider retention/endpoints, dependency supply chain, persistence/removal residue, or AVA mediator completeness. Those are blockers, not matters to discover by running the software.

Documentation alone does not characterize UFO as safe. Niko's approval is required before any code change for an evaluator or mediator, acquisition, installation, execution, empirical testing, access to the normal environment, external/cloud transmission of screenshots or UI state, or fallback selection.
