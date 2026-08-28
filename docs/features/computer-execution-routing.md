# Computer execution routing

Status: first bounded route implemented
Authority: AVA's chat/action orchestrator

AVA now has a small provider-neutral decision boundary for computer actions whose
correct executor can be chosen deterministically. The first route is intentionally
narrow: a request such as **“Open Google and search for AVA”** goes directly to
AVA's persistent browser instead of asking a model to choose among browser,
vision, native control, shell, or Microsoft UFO.

## Why this exists

UFO's genuine local Notepad proof is fast, but the current adapter is not a
general Windows or browser controller. Routing every request to it would make AVA
fast at the wrong task. The router instead chooses the most direct executor that
actually supports the requested operation:

| Task | Selected executor | Why |
| --- | --- | --- |
| One explicit Google query | Ava persistent Chrome | One URL operation with deterministic post-action verification |
| Multi-step web research | Normal agent + browser tools | The request requires reading, reasoning, branching, and source synthesis |
| Native Windows action | Existing native/vision path | Outside this first route; no false support claim |
| Explicit UFO browser request | Unsupported | The installed AVA UFO adapter is fixed to its disposable Notepad proof |

`server/src/orchestrator/computer-execution-router.ts` returns a typed plan or no
plan. No plan means the existing agent loop remains authoritative. The router is
not a parallel scheduler or telemetry system.

## Google fast path

1. The chat route classifies the literal current turn.
2. A single-query Google command produces `google-search.direct.v1`.
3. Irrelevant playbook recall and durable-memory retrieval are skipped for this
   deterministic action, so neither source is falsely credited or mutated.
4. `runAgent` dispatches `chrome_google_search` through the same tool registry,
   policy, abort, timeout, activity-event, task-receipt, and Mission Control seams
   used by model-selected calls.
5. The tool opens an encoded `https://www.google.com/search?q=...` URL, or simply
   foregrounds the page when the exact query is already active.
6. AVA checks the live URL. Verification requires a supported Google host, the
   exact `/search` path, and an exact decoded `q` value.
7. Only that independent check produces a verified task outcome. A consent page,
   redirect, wrong query, launch failure, or URL mismatch is reported as a
   failure/contradiction rather than success.

Fast non-persisted voice handoffs retain their sanitized final response and task
receipt in a five-minute process-local replay window. The voice bridge also sends
the returned task ID when it opens the stream. This prevents an immediate
unsupported/fail-closed decision from finishing between POST and SSE connection
and leaving voice with a silent result.

The query is limited to 500 characters. Text recognized by AVA's secret scrubber
is refused before browser navigation. Activity surfaces receive redacted tool
arguments, and verification stores only a bounded hash reference rather than a
second copy of the search text.

## User-visible evidence

- Chat activity says **Searching Google for …**, not a raw tool identifier.
- The final reply identifies the direct persistent-browser route.
- The task receipt separates executor success from URL verification.
- Mission Control receives the ordinary correlated tool call, tool result, and
  typed verification evidence; no new control plane is introduced.
- Explorer's Browser automation workflow shows the direct-search branch and its
  verification/stop boundaries.

The opt-in committed-head black-box check is:

```powershell
npm.cmd -w server run smoke:computer-routing
```

It creates a temporary authenticated device, talks to the running AVA server,
executes typed, repeated and voice-originated searches, checks the real CDP URL,
reads receipts and Mission Control provenance, checks the unsupported UFO/web
boundary, and then revokes its token and soft-deletes its disposable sessions.

## Honest limitations and next boundary

- The fast grammar covers one direct Google query, not arbitrary web tasks.
- Compound instructions intentionally stay with the agent.
- Regional Google hosts other than `google.com` and `google.co.uk` are not yet
  accepted as verified outcomes.
- This slice reuses one persistent browser, but it does not add a new cross-session
  browser lease. Broader routing should only expand after authoritative browser
  ownership/arbitration is proven for concurrent chat, voice, watcher, and social
  workflows.
- The Microsoft UFO adapter remains its fixed, separately approved Notepad proof.
  It is neither a learning engine nor the universal fallback for browser work.

## Adding another route

A new route needs: a typed task kind and executor decision, one authoritative
tool boundary, independent outcome evidence, deterministic failure behavior,
privacy tests, receipt/Mission Control coverage, and Explorer truth. If those are
not available, the request must remain in the existing agent loop rather than be
promoted to a fast path.
