# Faster actions: model and effort benchmark specification (Claude)

Status (2026-09-28): this is a specification only. Codex handed Claude the benchmark in room message
1037, and its review notes from room message 1263 are folded in.
- No routing is implemented.
- Nothing here changes what runs live.
- No paid provider call happens without Niko approving the cost cap first.

## The question
Niko asked for faster answers on easy requests, such as adding to the calendar, asking what is on,
setting a reminder or searching notes, without noticing any change in quality. Can narrow,
well-specified actions run on a lighter setting without losing correctness? That means a lower
reasoning effort first, and then possibly a smaller model.

These stay exactly as they are: the voice model, the persona, memory, policy and sessions.

## What runs live today (build d5ec26ff)
- Voice hands actions to the chat route over loopback with `persist:false` and no `voice:true`. So a
  delegated action runs on the orchestrator model at reasoning effort **low**, not none.
- Calendar add, update and attendance are low-tier local writes, with no approval wait. The
  Dublin clock is injected into the prompt. Calendar queries take about 70 ms.
- Real speech latency after that fix has **not been measured yet**.

## Where the ~22K input tokens go in action mode (offline estimate, 2026-09-28; corrected)
**Corrected after Codex's review (room messages 1577 and 1579).** Conversation mode sends **no tools**. `runAgent` sets `tools = mode === "conversation" ? [] : allTools` (server/src/orchestrator/agent.ts, around line 171) and passes that to `provider.stream`. agent-v2.test.ts ("conversation mode hides tools and uses the side model") asserts it. The route comments about tools staying available in conversation mode are stale. My first version wrongly counted ~9.8K of tools for conversation mode.

How the estimate was made, without any provider call:
- the route's tool builders were rebuilt with stubs and serialized as {name, description, parameters};
- the static prompt blocks were measured from code;
- the memory files were measured by size only.

Limits of the estimate:
- Token figures are chars ÷ 4 and are approximate only; they are not a bound in either direction.
- The ufo and agentroom stubs are omitted.
- The counting was done at the builder level, not at the final provider request boundary.
- It is not a measured provider token count, and it says nothing about latency.

| Part of the request | Conversation mode | Action mode |
| --- | --- | --- |
| Persona file + collaboration/register guides | ~2.2K | ~2.2K |
| `CAPABILITIES_MD` | ~2.7K | ~2.7K |
| `TOOL_RUBRIC` + reminders block | none | ~4.2K |
| Preferences + observations | ~0.8K | ~0.8K |
| Tool definitions | **none (tools = [])** | ~14.3K (73 tools; optional integrations excluded) |
| **Approximate fixed part** | **~5.7K + history** | **~24K + history** |

- The measured 21–24K-token calls from 27–28 Sep were action-mode calls; the calendar edit used tools. The estimate suggests they are mostly the fixed part, and history is a small share there.
- Typed intent routing (`classifyTypedIntent`) already sends greetings and similar turns to conversation mode, which is much smaller. So this is **not** "every typed request".
- In action mode, the largest single item is `research_visual_create` at roughly 3.5K. After it come `visual_explanation_create` (~0.8K), `watch_create` (~0.7K), `calendar_update` (~0.4K) and `notes_capture` (~0.4K). A calendar edit also carries the Instagram, WhatsApp, Chrome and people tools (~2.2K) plus the full rubric.
- **Measurement 2 done offline: exact request bytes at the provider boundary** (2026-09-28, `data/scratch/provider-boundary-bytes.ts`).
  - How: it mirrors runAgent's mode filter and the OpenAI provider's `toResponsesTools` mapping, over `buildToolRegistry` output and `buildSystemPrompt`. The live memory files were copied to a temp dir for sizing only.
  - These are UTF-8 bytes, not tokens. The optional credentialed integrations (Shopify, Places, look-at-screen) are excluded.
  - Stub assumptions: agentroom tools are enabled and UFO tools are built. The action-mode fsRoots use one placeholder path. Messages are excluded.

  | Request part | Conversation mode | Action mode |
  | --- | --- | --- |
  | System instructions | 24,702 B | 41,985 B |
  | Tools on the wire | 0 (`[]`) | 60,088 B (77 tools) |
  | **Fixed part, before messages** | **~24.7 KB** | **~102 KB** |

  - The largest action-mode tools: research_visual_create 14,127 B (about 14% of the fixed part), visual_explanation_create 3,217, watch_create 2,944, calendar_update 1,697 and notes_capture 1,653.
  - By group: visual 17,639, memory 7,980, notes 5,142, calendar 4,852, chrome 4,039, watches 3,290 and instagram + whatsapp + people 5,359.
  - Token accounting (measurement 3) and latency (measurement 4) are still unmeasured.
- **Four separate measurements** (Codex, room messages 1580 and 1582). They are never mixed and never reported as one number:
  1. route construction cost, which is local;
  2. provider request bytes, serialized per component at the post-registry, post-filter `provider.stream` boundary, with the request mode, model and build pinned;
  3. actual provider token accounting;
  4. latency.
  The chars ÷ 4 figures above are only a rough guide, labelled separately.
- **The benchmark changes only the tool set.** The model, effort and history stay identical. Mixed intent falls back or continues on the full set without replaying any write.
- **Proposed benchmark** (agreed direction with Codex, room message 1575):
  - Compare one bounded calendar-only tool set against the current payload, using identical requests and history.
  - Mixed intent must escape or escalate to the full set; a classifier must never silently remove a needed tool.
  - Default general capability stays intact until the evidence is in.
  - No provider call or runtime change is authorized by this note.
- Scripts: `data/scratch/tool-schema-sizes.ts` and `data/scratch/prompt-const-sizes.ts` (gitignored).

## Phase 0: live baseline (read-only; needs Niko to use voice normally)
- **Source:** a consistent read-only copy of `state.db`, taken after at least 20 real delegated voice
  actions. Never the live file.
- **Per delegated action,** from `observability_runs`, `observability_events` and
  `tool_calls` (created_at, duration_ms):
  - t0 final transcript;
  - t1 delegation posted;
  - t2 first model output;
  - t3 first tool call;
  - t4 tool result;
  - t5 final text;
  - t6 speech starts.
  A stage without a timestamp today is reported as missing, never estimated. Adding timestamps is a
  separate, agreed change.
- **Report:**
  - p50 and p95 per intent class (calendar read, calendar write, reminder, notes read, notes write,
    other);
  - counts of failures, clarifications and approvals (low-tier writes should need none).
- **Only post-promotion rows** tied to the running build (d5ec26ff) count, not every row in today's
  database.
- **Exploratory, not a service level.** Twenty actions give counts and a rough picture per workload;
  their p95 is not a stable SLA. Errors, timeouts and cancellations stay in the report, with their
  rates and latency shown separately rather than dropped.
- **First useful output is separate** from a courtesy "checking…" preamble, and both are separate from
  verified completion. First audio stays "unavailable" unless it is genuinely instrumented.
- **Privacy:** only timings, tool names and intent classes leave the copy. No transcript text.

## Phase 1: effort A/B on the same model (low vs none)
- The corpus below runs against an isolated seeded database, with the real provider and the **same
  named model** (the current orchestrator model, which supports both efforts). Arm A is `low`; arm B
  is `none`. Model and effort never change together.
- **Cost:** about 40 utterances × 2 arms × 3 repeats = 240 *scenario executions*. That is not 240
  requests: a multi-turn agent can make several model requests per case.
  - The cap limits actual requests, input and output tokens, total spend and wall time, including
    retries and escalations, with an explicit stop.
  - Nothing runs until Niko approves the cap.
- **Each variant and repeat starts clean.** The seeded database and the injected date, time and time
  zone are reset every time. Scoring reads the actual database and receipt changes, not just the tool
  JSON or the final claim.
- **Every sample is pinned and logged:** the exact requested model, the effective effort, the prompt
  and tool versions, and the build. Variant order is interleaved, and warm (cached) samples are kept
  apart from cold ones, so cache, order or load can't pass for a model win.
- If `none` is as correct and measurably faster, propose it for the narrow classes only.

## Phase 2: fast-model candidate (only if Phase 1 leaves a real gap)
- **Candidate:** `gpt-5.6-luna`, already AVA's side model. OpenAI documents Responses function
  calling and `none` effort for it; there is no latency guarantee. Local Qwen remains a separate,
  unevaluated option. It is not ruled out.
- **Method:** the same corpus and scoring, plus the handoff tests in "Guardrails".

## Corpus (synthetic fixtures; no real personal data)
About 40 utterances. Each has:
- a fixed `[NOW]` clock;
- a seeded state;
- the expected tool sequence and arguments, with times in Europe/Dublin;
- "no write" where the request is read-only.

It covers:
- **Calendar reads:** "what's on tomorrow", "am I free Thursday afternoon". These include
  relative days across midnight and across the October clock change.
- **Calendar writes:**
  - a one-off event;
  - a weekly series with an end date and a location;
  - moving one occurrence;
  - marking one occurrence skipped;
  - "add gym at 7", which must ask "morning or evening?"
- **Reminders:** "remind me in two hours to call the printer"; "what reminders do I have".
- **Notes:** search by topic; save a thought into a named project folder.
- **Hard cases:**
  - two intents in one request;
  - ambiguous people, projects or names;
  - typos and very short requests;
  - multi-tool arguments;
  - cancelled or moved occurrences;
  - interrupted runs and uncertain earlier write outcomes;
  - questions that sound like commands. These must not write.

## Scoring (per arm)
1. **Exact tool and arguments** (date, time, zone, entity) is the primary score. No arm may do worse
   than the current setting on any write.
2. **Duplicate or unintended writes** must be **zero**.
3. **Clarifications** asked when the expected answer is to clarify count as correct, not as failures.
4. **Latency:** p50 and p95 to the first useful output and to completion, and to the first audio for
   live voice.
5. **Escalation rate** (Phase 2): the share of requests handed back to the current path.

## Guardrails any routing proposal must keep (Codex, room message 1028)
- Route on the literal current request plus resolved context. Never route on keywords found in
  memory or history.
- Ambiguous or multi-intent requests stay on the current path.
- Never re-run a write-containing task from scratch on the heavy path after the fast path stalls or
  errors. Either continue the same run, tool-result history and receipt, or retry only before any
  side effect or output. Uncertain outcomes are kept as uncertain, and there are no duplicate writes.
- Use an explicit, validated per-run execution profile. Never change the shared provider defaults,
  and never switch into conversation mode, which removes tools.

## Rollout rule
Nothing ships from this benchmark directly. A routing or effort change is its own contract proposal:
exact-commit review by Codex, then live only after Niko has tested it.

## Owners
- **Claude:** this spec, the corpus and harness (fake provider for its own tests), the runs once
  approved, and the report.
- **Codex:** review, plus runtime integration if a change is agreed.
- **Niko:** normal voice use for the baseline, and the cost cap for Phases 1 and 2.
