# Ava Procedural Memory ("Playbooks") — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with user

## 1. Summary

Give Ava procedural memory: after it completes a multi-step task, it records a
reusable **playbook** of *how* it did it. The next time a similar request comes,
a matcher recalls the playbook and Ava follows the known-good path instead of
re-discovering it — so recurring tasks get faster and "it just knows how I like
this done" over time, with no manual teaching.

## 2. Behavior (plain language)

- **First time** Ava does a multi-step job successfully, it quietly saves a
  recipe: the gist of the approach (not a click-by-click macro).
- **Next time** a similar request arrives, Ava recognizes it, pulls up its recipe,
  and runs the known path — faster, less fumbling.
- **Adaptive care:** routine/harmless steps run fast; steps that change or destroy
  things (writes/deletes/irreversible) get a result-check before "done."
- **Tidy memory:** recipes that get reused stick; ones learned once and never
  needed again get pruned.

## 3. User-chosen parameters (requirements)

1. **Recall, don't replay:** store a high-level playbook and follow it with
   judgment — NOT a literal arg-by-arg script that blindly replays.
2. **Adaptive by stakes:** fast on routine steps; verify the result of
   consequential (write/delete/irreversible) steps before reporting done. Rides
   the existing `classifyRisk` tiers + approval gate.
3. **Capture trigger:** after ANY successful task that used **≥2 tools**. Auto,
   no manual ask. Pruned so it doesn't bloat.
4. **Recall via LLM matcher:** a small model call selects the best-matching
   playbook — gated to action-mode turns when ≥1 playbook exists, so chitchat
   never pays for it.

## 4. Goals & non-goals

**Goals**
- Capture a high-level playbook from a successful multi-step run, automatically.
- Recall and inject the matching playbook on a similar later request.
- Speed on routine steps, a verification on consequential ones.
- Bounded memory (prune by use/recency).

**Non-goals**
- Literal macro replay of exact tool args (explicitly rejected — brittle).
- Cross-device playbook sync.
- A playbook editor UI in Phase 1 (playbooks are plain memory files, viewable via
  the existing memory surface; a richer editor is a later follow-up).
- Capturing single-tool or failed runs.

## 5. Architecture

A focused `server/src/playbooks/` module, plus thin wiring in `chat.ts`. It reuses
four existing patterns: `project-index` (load index + read body + context
injection) for recall, `auto-summary`/`auto-title` (fire-and-forget post-run LLM
work) for capture, `store.ts` (secret-scrubbed writes) for storage, and
`budgets`/`promote-on-repeat` for pruning + use promotion. Playbook files live
under `<memoryDir>/playbooks/`, one `<slug>.md` per playbook, mirroring the
existing `projects/` layout.

## 6. Capture

- **Step collector:** rides the existing `emit` in `chat.ts`. On each `tool_call`
  it records `{ tool, args }`; on the matching `tool_result` it records `ok`.
- **Gate:** when a run ends with a `final` event (NOT `error`/`killed`) **and** the
  collected steps include **≥2 tool calls**, fire capture. Otherwise skip.
- **Distillation** (`distill.ts`, fire-and-forget, like `auto-summary`): an LLM
  turns `goal (user prompt) + step sequence (tool + args + ok) + outcome (final
  text)` into a playbook: a one-line **trigger summary**, distinctive **keywords**,
  the **ordered high-level steps**, and a **stakes tag** per step. The stakes tag
  is computed from the real tool via `classifyRisk` (read-only/low ⇒ routine;
  medium/high ⇒ consequential), not guessed by the model.
- Capture never blocks the user response; failures are swallowed and logged.

## 7. Storage format

`<memoryDir>/playbooks/<slug>.md`, written through `store.ts` (scrubbed):

```
---
trigger: download the monthly electricity bill to Downloads
keywords: electricity, bill, statement, download
created: 2026-06-02
last_used: 2026-06-02
uses: 1
---
# Steps
1. [routine] Open chrome to the provider's billing page
2. [routine] Open the latest statement
3. [consequential] Download the PDF into Downloads — verify the file landed
```

`slug` is kebab-derived from the trigger (same rule as project slugs). The header
is a small key:value block; the body is the steps section.

## 8. Recall (LLM matcher)

- **Index** (`playbook-index.ts`): `loadPlaybookIndex(memoryDir)` returns
  `{ slug, trigger }[]`; `readPlaybook(memoryDir, slug)` returns the body. Mirrors
  `project-index.ts`.
- **Matcher** (`match.ts`): `matchPlaybook({ prompt, index, provider })` calls the
  **side model with reasoning `none`** with the request + the list of trigger
  summaries, and returns the best-matching `slug` or `null`. Compact prompt; fast.
- **Gating:** only invoked in `chat.ts` when the turn is action-mode **and** the
  index is non-empty — so conversational turns never trigger a matcher call.
- **Injection:** on a hit, the playbook body is injected into the run's context as
  a `[PLAYBOOK — <slug>]` block (exactly how project context is injected today),
  followed by the stakes rubric line (§9). `uses` + `last_used` are bumped
  (promote-on-use).

## 9. Adaptive by stakes

The injected playbook is prefaced with a fixed rubric line:

> Follow this known-good path efficiently without re-exploring. For any step marked
> [consequential], verify the result before reporting done; [routine] steps need no
> recheck.

This rides the existing risk awareness: high-risk steps already pass through the
approval gate; the rubric adds the lightweight result-check for consequential steps
while letting routine steps run fast.

## 10. Pruning + promotion

- `uses` increments on each recall; `last_used` updated.
- The budget system prunes playbooks by low `uses` + age, capped at a soft N
  (e.g. 50). Frequently-used playbooks survive; one-off learnings fade.

## 11. Components / files

All under `server/src/playbooks/` with co-located tests:
- `store.ts` — write/read/list/prune playbook files (+ slug + header parse).
- `playbook-index.ts` — `loadPlaybookIndex` + `readPlaybook` (mirrors project-index).
- `distill.ts` — run → playbook via `LLMProvider` (+ `classifyRisk` for stakes).
- `match.ts` — `matchPlaybook` via the side model.
- `capture.ts` — the post-run gate + orchestration (collector → distill → store).
- Wiring in `server/src/routes/chat.ts` — the step collector on `emit`, the
  post-run capture trigger, and the pre-run match + injection.

## 12. Error handling

- Capture is fire-and-forget; a distill or write failure is logged, never surfaced.
- A matcher failure (timeout/parse) falls back to "no playbook" — Ava just does the
  task normally.
- Malformed/older playbook files are skipped by the index loader, not fatal.
- Steps and the goal pass through `scrubSecrets` on write (store layer).

## 13. Testing

- `distill` with `MockLLMProvider` → a parseable playbook with stakes tags.
- `match` with `MockLLMProvider` → returns the right slug / `null` on no match.
- `store` on a temp dir → write/read/list, slug derivation, prune by use+age.
- `capture` gate → fires on a ≥2-tool successful run, skips on error/killed/1-tool.
- Integration: a captured playbook is matched + injected on a similar follow-up
  prompt (mock provider for both distill and match).

## 14. Decisions log

- **Recall over replay** — high-level playbook + judgment; literal arg replay is
  brittle to changed pages/paths/state.
- **Adaptive by stakes over pure speed or always-careful** — reuse `classifyRisk`;
  speed where safe, a check where it matters.
- **Auto-capture multi-step successes** — matches "remember how when Ava performs a
  task"; the ≥2-tool gate + pruning keep it from capturing trivial/noisy runs.
- **LLM matcher over keyword/inline** — user chose robust semantic matching;
  mitigated cost via side model + reasoning none + action-turn gating.
- **Stakes tag from `classifyRisk`, not the model** — deterministic + reuses the
  real risk policy rather than trusting a guess.

## 15. Open questions / risks

- **Matcher precision:** a wrong match injects an unhelpful playbook. Mitigation:
  the model is told to return `null` unless clearly similar; the orchestrator can
  ignore an injected playbook that doesn't fit. Tune the matcher prompt during
  implementation.
- **Distillation quality:** the playbook is only as good as the distiller's summary
  of the run; the stakes tags are deterministic, the prose is not.
- **Soft cap N + prune cadence:** pin exact values during planning.
