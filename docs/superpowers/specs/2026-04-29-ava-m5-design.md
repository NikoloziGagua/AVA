# Ava M5 — Polish & Deferred Items

> **Status:** design  
> **Predecessor:** [M4](2026-04-28-ava-m4-design.md) — phases 1–4 shipped.  
> **Date:** 2026-04-29

## 1. Goal

Close out the deferred items from M3 and M4 and add the small set of features that emerged during M4 use. M5 is polish — no new subsystems, only additions inside the layers that already exist (Express routes, SQLite tables, PWA screens, memory store).

## 2. Scope

Six items across three layers:

| # | Item                              | Layer            |
|---|-----------------------------------|------------------|
| 1 | Reasoning level UI                | Server + Web     |
| 2 | Memory editor UI                  | Server + Web     |
| 3 | Auto-learn from corrections       | Server           |
| 4 | §4.4 promotion flow               | Server (memory)  |
| 5 | LLM-summarized chip labels        | Server           |
| 6 | People-category observations      | Server (memory)  |

Items 4–6 were pre-designed in the M4 spec; M5 implements them. Items 1–3 are new and designed in this document.

**Out of scope:** voice mode (deferred to M6), full frontend redesign (M6), Anthropic-side reasoning controls (no API equivalent at this writing).

## 3. Reasoning level UI

### 3.1 Why
M4 hard-coded `reasoning_effort` to `minimal` for conversation and `low` for action. The user wants a runtime knob to dial speed vs depth without editing code.

### 3.2 Server

New SQLite table:

```sql
CREATE TABLE IF NOT EXISTS reasoning_pref (
  scope_id TEXT PRIMARY KEY,         -- single row keyed 'global'
  level TEXT NOT NULL,               -- 'fast' | 'thorough'
  updated_at INTEGER NOT NULL
);
```

New routes (mounted at `/api/reasoning`):

- `GET /api/reasoning` → `{ level: 'fast' | 'thorough', supported: boolean }`. `supported` is `true` when `provider.name === 'openai'`.
- `PUT /api/reasoning` body `{ level }` → `{ level }`. Validates against the two-value enum.

Both routes auth-gated.

### 3.3 Effort mapping

| Pref level  | Conversation effort | Action effort |
|-------------|---------------------|---------------|
| fast        | minimal             | low           |
| thorough    | low                 | medium        |

Default: `fast` (matches current hard-coded behavior).

The chat route reads the pref before dispatch and replaces the literal in `agent.ts` with the mapped value. The mapping table lives in a new `server/src/orchestrator/reasoning.ts` so the agent stays free of route-layer state.

### 3.4 Web

New section at the top of the **Rules** screen:

```
Reasoning
( ) Fast        — instant replies, light reasoning on actions
( ) Thorough    — slower, thinks more before acting
```

Two radio buttons. Disabled with caption *"Available with OpenAI provider only"* when `supported === false`.

State is fetched on mount; the PUT happens immediately on change (no save button).

### 3.5 Tests

- `reasoning.test.ts`: GET default, PUT roundtrip, PUT rejects invalid level.
- `reasoning.test.ts` (mapping): table-driven test of the four cells.
- Agent test: when `pref = thorough`, conversation passes `low`; action passes `medium`.

## 4. Memory editor UI

### 4.1 Why
Stale or wrong observations accumulate. The user wants a peer to Ava's `memory_remember` / `memory_forget` tools — line-level edits without typing in chat.

### 4.2 Edit surface

| File                | UI access                       |
|---------------------|---------------------------------|
| `personality.md`    | view-only                       |
| `MEMORY.md`         | view-only                       |
| `preferences.md`    | view, append, edit, delete      |
| `observations.md`   | view, edit, delete (no append)  |
| `projects/<slug>.md`| view-only (auto-managed)        |

Observations are not directly appendable from the UI because they belong to Ava's auto-recording flow (single-mention → low; cross-session repeat → medium; etc.). Users wanting a fact recorded say it to Ava.

### 4.3 Server

New routes (mounted at `/api/memory`):

- `GET /api/memory` →
  ```ts
  {
    personality: string,
    memoryIndex: string,
    preferences: { lines: string[] },
    observations: { lines: ObsLine[] },
    projects: { slug: string, body: string }[]
  }
  ```
  where `ObsLine = { raw: string, date: string, confidence: 'low'|'medium'|'high', category: string, text: string }`.

- `PATCH /api/memory/lines` body `{ file: 'preferences'|'observations', oldLine: string, newLine?: string }` →
  - `200 { line }` on success (`newLine` provided) or `200 { deleted: true }` (newLine null/missing).
  - `409 { error: 'stale_line', current: <full file body> }` if `oldLine` is not present in the current file.

- `POST /api/memory/lines` body `{ file: 'preferences', line: string }` →
  - `200 { line }`.
  - Server appends to the existing file, runs the memory firewall (existing `firewallText` from M4), normalizes whitespace.

All writes use the existing memory store helpers (`writeFile`, `appendLine`) which call `scrubSecrets` internally — the firewall and bootstrap behavior are inherited.

### 4.4 Concurrency

Last-write-wins, but PATCH is *line-keyed*. The client sends the exact text it saw. If Ava's tool wrote a new line in between, that's fine — the user's edit still locates its target. If Ava removed or rewrote the user's target line, PATCH returns 409 with the current file body so the UI can re-render.

POST always succeeds (append is commutative).

### 4.5 Web

New screen `MemoryEditor.tsx` reachable from the chat header. Header layout becomes:

```
☰  Ava                       [memory] ⊕  [rules] ⚙
```

Sections in this order:

1. **Personality** — collapsed by default, shows file body in a `<pre>` block when expanded. Footer: *"Edit `data/memory/personality.md` directly to change."*
2. **Preferences** — list of lines. Each row: text + ✏ edit + 🗑 delete. Footer: text input + Add button (POST).
3. **Observations** — grouped by category. Each row: confidence badge (low/medium/high), date, text, ✏ edit + 🗑 delete. Filter pills above (`all` `preferences` `context` `skills` `setup` `schedule` `people`).
4. **Projects** — list of `{slug, path}` rows; tap to expand the body. Read-only.

Edits use a small inline form. Save calls PATCH; on 409 the row blinks and the page refetches `GET /api/memory`.

### 4.6 Tests

- `memory-routes.test.ts`: GET shape; PATCH delete; PATCH edit; PATCH 409 on stale line; POST append + firewall scrub.
- `MemoryEditor.test.tsx`: renders sections; click delete dispatches PATCH; 409 triggers refetch.

## 5. Auto-learn from corrections

### 5.1 Why
Ava sometimes does things the user has to push back on ("no, don't auto-execute that"). Capturing those pushbacks as low-confidence observations means the §4.4 promotion flow surfaces real preferences over time without the user having to remember the exact phrasing of `remember`.

### 5.2 Detection

Pure heuristic, server-side, no extra LLM call.

```ts
const CORRECTION_RE =
  /^(no|nope|wrong|actually|stop|don't|do not|instead)\b[\s,:.\-—]/i;
```

Triggered when:
1. The new user message matches the regex, AND
2. The previous message in the session is `role === 'assistant'`, AND
3. The previous message was emitted within the last 5 minutes.

Condition 3 prevents stale corrections (resuming a 3-day-old session and saying "no" to something else).

### 5.3 Action

Fire-and-forget. The body of the existing `memory_remember` tool is extracted to a plain function `rememberObservation()` in a new `server/src/memory/remember.ts` so both the tool wrapper and the auto-learn hook can call it. After `appendMessage(user)` and *before* the agent dispatch:

```ts
if (detectedCorrection(...)) {
  void rememberObservation({
    memoryDir,
    category: 'preferences',
    confidence: 'low',
    text: `(corrected) ${userText.slice(0, 200)}`,
    today: isoToday(),
  });
}
```

The `(corrected)` prefix is searchable so the user can prune these entries from the memory editor (item 4).

The §4.4 promotion flow (item 6) dedups and bumps tier on repeat corrections.

### 5.4 Tests

- `correction-detector.test.ts`: matches/non-matches across the regex variants; 5-minute staleness gate; no-trigger when previous turn is user.
- Integration: send a correction in two sessions on the same day; observations.md ends with one line at medium confidence.

## 6. §4.4 promotion flow

### 6.1 Why
Carry-over from M4. Currently `memory_remember` always appends. We want repeated observations to bump tier (low → medium → high) instead of duplicating, and contradicting observations to supersede.

### 6.2 Algorithm

The existing `memory/observations.ts` already exposes `applyRefresh` (used today only when the caller passes an explicit `refresh=` substring). M5 adds **automatic** promotion: callers no longer need to set `refresh` for repeat-text bumps to happen.

New function `promoteOnRepeat(existingContent, newLine, today)`:

1. Normalize both sides: lowercase, strip punctuation, collapse whitespace.
2. For each existing line in the same `category`:
   - If normalized text equals the new text → bump confidence one tier (low→medium, medium→high, capped at high). Refresh date in place via `applyRefresh`. Return `{ kind: 'promoted', content }`.
3. Otherwise append the new line via `appendLine`. Return `{ kind: 'appended', content }`.

`supersedes` keeps its existing explicit-call semantics (no auto-detection — contradiction is hard to infer reliably).

Wired into `rememberObservation` (the extracted helper from item 5.3) so both the tool and auto-learn benefit. Existing `refresh=`-explicit callers are unaffected — the new logic is a fast path before append, not a replacement.

### 6.3 Tests

- `observations-promotion.test.ts`:
  - Two `low` writes of the same text → one line at `medium`, date refreshed.
  - Three writes → `high`.
  - Four writes → still `high` (capped).
  - Different categories of the same text → two separate lines.
  - `supersedes` flag → old line tagged, new line appended.
  - Whitespace and punctuation differences treated as duplicates.

## 7. LLM-summarized chip labels

### 7.1 Why
Carry-over from M4 §5.2. The current heuristic truncates raw user prompts; labels read awkwardly ("list the contents of m..."). We want short imperative labels ("List home folder") via a tiny gpt-5-mini call.

### 7.2 Architecture

New module `server/src/orchestrator/chip-summarizer.ts`:

```ts
async function summarizeChips(
  raws: { id: string; prompt: string }[],
  deps: { provider: LLMProvider; cache: ChipLabelCache }
): Promise<{ id: string; label: string }[]>
```

- For each raw, hash the prompt to a stable key.
- Hit `cache.get(deviceId, hash)` first. Return if fresh.
- Batch the misses into one provider call:

  ```
  System: "You write short imperative chip labels for a smart-home assistant.
  Output JSON: {labels: [{id, label}, ...]}. Each label ≤ 6 words, imperative,
  no trailing punctuation, sentence case."
  User: <raws as JSON>
  ```
- Use `provider.complete` with `model = defaultSideModel`, `reasoningEffort: 'minimal'`.
- Persist results in a new table:

  ```sql
  CREATE TABLE IF NOT EXISTS chip_label_cache (
    device_id    TEXT NOT NULL,
    prompt_hash  TEXT NOT NULL,
    label        TEXT NOT NULL,
    expires_at   INTEGER NOT NULL,
    PRIMARY KEY (device_id, prompt_hash)
  );
  ```

  TTL = 24 hours from write time.

### 7.3 Refresh model

`generateChips` (existing) is split: it now first checks the cache and substitutes any cached LLM labels in place of the heuristic ones for matching prompt hashes. After the response is returned, the route handler kicks off a background `summarizeChips` call for any auto-chips whose label is still heuristic. The result populates the cache.

The PWA's existing `refreshKey` reload pattern picks the new labels up on the next chat send or session switch.

We do NOT push live updates via SSE for label refresh — too much plumbing for a non-critical polish feature. First-run latency stays as-is (heuristic labels show until the next refresh).

### 7.4 Tests

- `chip-summarizer.test.ts`: cache hit path skips the LLM; batched miss path makes one call with all ids; mapping back by id.
- `chips.test.ts`: integration that GET /suggested first call returns heuristic labels; second call (after summarizer completion) returns LLM labels.

## 8. People-category observations

### 8.1 Why
Carry-over from M4. The category list (`preferences | context | skills | setup | schedule`) lacks a slot for facts about humans (collaborators, family members). Forcing them into `context` makes them hard to filter in the memory editor.

### 8.2 Changes

Single category extension. Files touched:

- `memory/observations.ts` — add `'people'` to the category union and parser.
- `memory/budgets.ts` — add `people` to the `SOFT_CAPS` map (start at the same cap as `preferences`).
- `orchestrator/tool-rubric.ts` — extend the rubric line `category: preferences | context | skills | setup | schedule` to include `people`.
- `web/src/memory/MemoryEditor.tsx` — include `people` in the filter pills.

### 8.3 Use

Ava's `memory_remember` tool can now pick `people` when the observation is about a named human ("Ali prefers async standups", "Mom's birthday is March 12"). The auto-learn-from-corrections flow (item 5) does *not* default to `people` — corrections are about Ava's behavior, which lives under `preferences`.

### 8.4 Tests

- `observations.test.ts`: parsing accepts `people` as a category; rejects unknown categories as before.
- `tool-rubric.test.ts`: rubric mentions `people`.
- `memory-routes.test.ts`: GET response groups people-category lines correctly.

## 9. Build sequence

1. **§4.4 promotion flow** — foundation for items 5 and 6.
2. **People-category** — small enum extension.
3. **Reasoning level UI** — fully isolated, easy win.
4. **Auto-learn from corrections** — depends on (1).
5. **Memory editor UI** — largest item.
6. **LLM-summarized chip labels** — last; nice-to-have.

Each step ships independently with its own tests. No step depends on a later step's code.

## 10. Smoke test additions

Append to `scripts/smoke-test.md` under a new "M5" section:

- **Promotion**: send `"remember I prefer terse responses"` twice in two sessions same day → observations.md has one line at `medium`.
- **People category**: send `"remember Ali likes async standups"` → observations.md has a line with `category=people`.
- **Reasoning toggle**: open Rules, switch to Thorough, send a complex prompt → response noticeably slower; toggle back to Fast → instant.
- **Memory editor**: open the new memory screen, delete a low-confidence observation, refresh → it's gone.
- **Auto-learn**: reply `"no, don't auto-run things"` to an Ava response; observations.md gains a `(corrected)` line at low confidence.
- **Chip labels**: open chat with no chips, send a few messages, then check the chip labels — they read as imperative phrases ("Resume yesterday", "Open yov", etc., not truncated raw text).

## 11. Risks

- **Memory editor concurrency** — covered by line-keyed PATCH + 409 fallback. Race window is small in a single-user context anyway.
- **Auto-learn noise** — mitigated by the 5-minute window, the `(corrected)` prefix making them deletable, and the cap-at-high promotion. If it produces too many false positives, the regex tightens; the surface is small.
- **Chip summarizer cost** — gpt-5-mini at minimal effort is cheap. 24h cache means at most one batched call per device per day under normal use.
