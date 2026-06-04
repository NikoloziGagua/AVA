# Ava Self-Improve v2 — Plan Review + Model Selection + Escalation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Ava's self-improvement so Ava and Claude Code *collaborate on the plan* before building, the user (or Ava) can pick the Claude model per task, and a failed verify automatically *escalates* to Claude Opus 4.8 at max effort before giving up.

**Architecture:** The existing loop is `reflect → implement → verify → commit → swap → watch` (`server/src/self/improver.ts`). v2 inserts a **code-grounded plan review** step (a Claude Code worker reads the real repo and critiques Ava's brief) between reflect and implement, threads a **ModelSpec** (model + effort) from the request through to the worker, and wraps implement+verify in an **escalation loop** (chosen model first, then Opus 4.8 max). The worker already authenticates via the user's subscription (`workerEnv` strips the API key) and can edit (`--permission-mode acceptEdits`) — v2 only adds model/effort and a review pass.

**Tech Stack:** TypeScript, better-sqlite3 (`state/schema.sql`), the `claude` CLI worker (`tools/claude-code.ts`), Vitest.

**Baseline (proven 2026-06-04):** the v1 loop ships a real self-change end-to-end on the user's subscription. v2 builds on that working baseline.

**Out of scope (Phase 2 — separate plans):** (a) persistent Ava↔Claude session continuity via `claude --resume`/`--continue`; (b) Ava self-initiating ideas ("ask Claude what I should improve"). Both are noted at the end.

---

## File Structure

**Created:**
- `server/src/self/model-policy.ts` — `ModelSpec` type + the escalation ladder (`attemptsFor`).
- `server/src/self/model-policy.test.ts`
- `server/src/self/review.ts` — `reviewPlan`: a Claude Code worker reads the repo and returns a refined brief.
- `server/src/self/review.test.ts`

**Modified:**
- `server/src/state/schema.sql` — add `model`, `review_log` columns to `self_improvements`.
- `server/src/self/intents.ts` — `Intent` gains `model`/`review_log`; `createIntent` accepts an optional model.
- `server/src/tools/claude-code.ts` — `ClaudeCodeRunArgs.model` becomes a `ModelSpec`; `defaultClaudeArgs` emits `--model`/`--effort`.
- `server/src/self/improver.ts` — review step + escalation loop; `ImproverDeps.implement`/`reviewPlan` signatures.
- `server/src/tools/self-improve-mcp.ts` — `self_improve` tool accepts optional `model`.
- `server/src/routes/self.ts` — `POST /improve` accepts optional `model`.
- `server/src/index.ts` — wire `reviewPlan` + model into `buildImproverDeps`.

---

## Task 1: ModelSpec + escalation ladder

**Files:**
- Create: `server/src/self/model-policy.ts`
- Test: `server/src/self/model-policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { attemptsFor, ESCALATION, type ModelSpec } from "./model-policy.js";

describe("attemptsFor", () => {
  it("tries the chosen model first, then escalates to Opus 4.8 max", () => {
    const chosen: ModelSpec = { model: "sonnet" };
    expect(attemptsFor(chosen)).toEqual([{ model: "sonnet" }, ESCALATION]);
  });
  it("defaults the first attempt to the claude default (empty spec) when none chosen", () => {
    expect(attemptsFor(null)).toEqual([{}, ESCALATION]);
  });
  it("does not add a duplicate escalation rung when the chosen model already IS the escalation", () => {
    expect(attemptsFor({ ...ESCALATION })).toEqual([ESCALATION]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './model-policy.js'`): `npm -w server run test -- self/model-policy`

- [ ] **Step 3: Implement `server/src/self/model-policy.ts`**

```ts
// A model choice for a Claude Code worker. `model` is a CLI alias ("opus",
// "sonnet") or a full id ("claude-opus-4-8"); `effort` maps to claude --effort.
export type ModelSpec = { model?: string; effort?: string };

// On verify failure we escalate to the strongest model at max effort. "opus"
// resolves to the latest Opus (4.8); "high" is the max effort level.
export const ESCALATION: ModelSpec = { model: "opus", effort: "high" };

function sameSpec(a: ModelSpec, b: ModelSpec): boolean {
  return a.model === b.model && a.effort === b.effort;
}

// The ordered attempts for one self-improvement: the caller's choice first
// (empty spec = the claude default model), then the escalation rung — unless
// the caller already chose the escalation model, in which case one attempt.
export function attemptsFor(chosen: ModelSpec | null): ModelSpec[] {
  const first: ModelSpec = chosen ?? {};
  return sameSpec(first, ESCALATION) ? [first] : [first, ESCALATION];
}
```

- [ ] **Step 4: Run — expect PASS** (3 tests): `npm -w server run test -- self/model-policy`
- [ ] **Step 5: Commit**

```bash
git add server/src/self/model-policy.ts server/src/self/model-policy.test.ts
git commit -m "feat(self): ModelSpec + escalation ladder (chosen model -> Opus 4.8 max)"
```

---

## Task 2: Worker accepts a ModelSpec (model + effort)

**Files:**
- Modify: `server/src/tools/claude-code.ts`
- Test: `server/src/tools/claude-code.test.ts`

Today `defaultClaudeArgs(prompt, cwd, model?: string)` only emits `--model`. v2 takes a `ModelSpec` and also emits `--effort`. `ClaudeCodeRunArgs.model` becomes `ModelSpec`.

- [ ] **Step 1: Update the failing test** (replace the existing `defaultClaudeArgs` model test)

```ts
import { defaultClaudeArgs } from "./claude-code.js";
import type { ModelSpec } from "../self/model-policy.js";

it("emits --model and --effort from a ModelSpec", () => {
  const spec: ModelSpec = { model: "opus", effort: "high" };
  expect(defaultClaudeArgs("p", "/c", spec)).toEqual(
    ["-p", "p", "--permission-mode", "acceptEdits", "--model", "opus", "--effort", "high"],
  );
});
it("omits model/effort flags when the spec is empty", () => {
  expect(defaultClaudeArgs("p", "/c", {})).toEqual(["-p", "p", "--permission-mode", "acceptEdits"]);
});
```

- [ ] **Step 2: Run — expect FAIL** (type error / wrong args): `npm -w server run test -- claude-code`

- [ ] **Step 3: Implement** — in `server/src/tools/claude-code.ts`:

Change the import and types:
```ts
import type { ModelSpec } from "../self/model-policy.js";

export type ClaudeCodeRunArgs = { prompt: string; cwd: string; runId: string; model?: ModelSpec };
```
Replace `defaultClaudeArgs`:
```ts
export function defaultClaudeArgs(prompt: string, _cwd: string, model?: ModelSpec): string[] {
  const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
  if (model?.model) args.push("--model", model.model);
  if (model?.effort) args.push("--effort", model.effort);
  return args;
}
```
The `buildArgs` type in `ClaudeCodeConfig.claudeArgs` becomes `(prompt: string, cwd: string, model?: ModelSpec) => string[]`. The `run({ prompt, cwd, runId, model })` call already forwards `model` to `buildArgs(prompt, cwd, model)` — no change there.

- [ ] **Step 4: Run — expect PASS**: `npm -w server run test -- claude-code`
- [ ] **Step 5: Typecheck** (catches the `chat.ts` claude_code tool caller if it passed a string model): `npx tsc --noEmit -p server/tsconfig.json`. If a caller passes `model: "..."` as a string, wrap it as `{ model: "..." }`.
- [ ] **Step 6: Commit**

```bash
git add server/src/tools/claude-code.ts server/src/tools/claude-code.test.ts
git commit -m "feat(claude-code): worker takes a ModelSpec (model + effort)"
```

---

## Task 3: Persist the chosen model on the intent

**Files:**
- Modify: `server/src/state/schema.sql`, `server/src/self/intents.ts`
- Test: `server/src/self/intents.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (`server/src/self/intents.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent, updateIntent } from "./intents.js";

function db() { return openDb(join(mkdtempSync(join(tmpdir(), "ava-int-")), "x.db")); }

describe("intents model + review_log", () => {
  it("stores the chosen model at creation and reads it back", () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g", model: "opus" });
    expect(getIntent(d, id)!.model).toBe("opus");
  });
  it("defaults model to null when not given, and round-trips review_log", () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    expect(getIntent(d, id)!.model).toBeNull();
    updateIntent(d, id, { review_log: "looks good" });
    expect(getIntent(d, id)!.review_log).toBe("looks good");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no `model` column): `npm -w server run test -- self/intents`

- [ ] **Step 3: Implement**

In `server/src/state/schema.sql`, add two columns to the `self_improvements` table (after `error`):
```sql
  error TEXT,
  model TEXT,
  review_log TEXT
```
(Existing DBs: `openDb` applies `schema.sql` with `CREATE TABLE IF NOT EXISTS`, which will NOT add columns to an existing table. Add idempotent migrations next to where the schema is applied — follow the existing migration pattern in `state/db.ts`; if none exists, add: `ALTER TABLE self_improvements ADD COLUMN model TEXT` and `... review_log TEXT` each wrapped in try/catch for "duplicate column".)

In `server/src/self/intents.ts`:
```ts
export type Intent = {
  id: string; created_at: number; trigger: IntentTrigger; goal: string;
  status: IntentStatus; branch: string | null; commit_sha: string | null;
  last_known_good: string | null; diff_summary: string | null;
  verify_log: string | null; outcome: string | null; error: string | null;
  model: string | null; review_log: string | null;
};

export function createIntent(db: Db, o: { trigger: IntentTrigger; goal: string; model?: string }): string {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO self_improvements (id, created_at, trigger, goal, status, model) VALUES (?, ?, ?, ?, 'queued', ?)",
  ).run(id, Date.now(), o.trigger, o.goal, o.model ?? null);
  return id;
}
```
(`getIntent`/`listIntents` are `SELECT *` so they pick up the new columns automatically. `updateIntent` is generic and already supports `review_log`.)

- [ ] **Step 4: Run — expect PASS**: `npm -w server run test -- self/intents`
- [ ] **Step 5: Commit**

```bash
git add server/src/state/schema.sql server/src/state/db.ts server/src/self/intents.ts server/src/self/intents.test.ts
git commit -m "feat(self): persist chosen model + review_log on the intent"
```

---

## Task 4: Accept a model from the tool + route

**Files:**
- Modify: `server/src/tools/self-improve-mcp.ts`, `server/src/routes/self.ts`
- Test: `server/src/routes/self.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** (route accepts `model` and stores it)

```ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { selfRoutes } from "./self.js";
import { listIntents } from "../self/intents.js";

function app(db: ReturnType<typeof openDb>) {
  const a = express(); a.use(express.json());
  a.use("/api/self", selfRoutes(db, (_q, _s, n) => n(), { startImprovement() {}, revert() {} }));
  return a;
}

describe("POST /api/self/improve", () => {
  it("stores an optional model with the queued intent", async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), "ava-self-")), "x.db"));
    await request(app(db)).post("/api/self/improve").send({ goal: "g", model: "opus" }).expect(200);
    expect(listIntents(db)[0]!.model).toBe("opus");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (model not stored): `npm -w server run test -- routes/self`

- [ ] **Step 3: Implement**

In `server/src/routes/self.ts`, widen the body schema and pass the model:
```ts
const Body = z.object({ goal: z.string().min(1).max(2000), model: z.string().max(64).optional() });
// ...
const id = createIntent(db, { trigger: "explicit", goal: p.data.goal, model: p.data.model });
```
In `server/src/tools/self-improve-mcp.ts`, accept `model` and pass it to `queue`:
```ts
export function buildSelfImproveTool(deps: { queue: (goal: string, model?: string) => string }): ToolDef {
  return {
    tool: {
      name: "self_improve",
      description:
        "Queue an autonomous improvement to Ava's OWN code. Use when Sir says 'improve yourself' " +
        "or asks Ava to change its own behavior. Optional `model` picks the Claude model for the " +
        "job (e.g. 'opus', 'sonnet'). Args: { goal, model? }.",
      inputSchema: {
        type: "object",
        properties: { goal: { type: "string" }, model: { type: "string" } },
        required: ["goal"],
      },
    },
    run: async (args) => {
      const goal = String(args.goal ?? "").trim();
      if (!goal) return { ok: false, text: "missing goal" };
      const model = args.model ? String(args.model) : undefined;
      const id = deps.queue(goal, model);
      return { ok: true, text: `queued self-improvement ${id}: ${goal}${model ? ` (model ${model})` : ""}` };
    },
  };
}
```
In `server/src/index.ts`, widen `queueSelfImprove`:
```ts
function queueSelfImprove(goal: string, model?: string): string {
  const id = createIntent(db, { trigger: "explicit", goal, model });
  startImprovement(id);
  return id;
}
```

- [ ] **Step 4: Run — expect PASS**: `npm -w server run test -- routes/self`
- [ ] **Step 5: Commit**

```bash
git add server/src/tools/self-improve-mcp.ts server/src/routes/self.ts server/src/routes/self.test.ts server/src/index.ts
git commit -m "feat(self): self_improve accepts an optional model (tool + route)"
```

---

## Task 5: Code-grounded plan review

**Files:**
- Create: `server/src/self/review.ts`
- Test: `server/src/self/review.test.ts`

`reviewPlan` runs a Claude Code worker (read-only intent) IN the real repo so it can read actual files, and returns a refined brief. It reuses the `ClaudeCode` worker shape so it's injectable/mockable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { reviewPlan } from "./review.js";

describe("reviewPlan", () => {
  it("returns the worker's refined brief when review succeeds", async () => {
    const run = vi.fn(async () => ({ ok: true as const, output: "REFINED: do X in fileA", exitCode: 0 }));
    const out = await reviewPlan({ run }, { brief: "do X", cwd: "/repo", model: { model: "opus" } });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", model: { model: "opus" } }));
    expect(out).toBe("REFINED: do X in fileA");
  });
  it("falls back to the original brief if the reviewer fails or returns nothing", async () => {
    const run = vi.fn(async () => ({ ok: false as const, reason: "boom" }));
    const out = await reviewPlan({ run }, { brief: "do X", cwd: "/repo", model: null });
    expect(out).toBe("do X");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**: `npm -w server run test -- self/review`

- [ ] **Step 3: Implement `server/src/self/review.ts`**

```ts
import type { ClaudeCode } from "../tools/claude-code.js";
import type { ModelSpec } from "./model-policy.js";

// Ask a Claude Code worker — reading the REAL repo — to critique Ava's brief and
// return a tightened, code-grounded version. Best-effort: on any failure or empty
// output we keep Ava's original brief so review never blocks the run.
export async function reviewPlan(
  worker: Pick<ClaudeCode, "run">,
  o: { brief: string; cwd: string; model: ModelSpec | null },
): Promise<string> {
  const prompt =
    "You are reviewing a planned change to THIS repository before it is implemented. " +
    "Read the relevant files to check the plan is correct, minimal, and feasible. " +
    "Reply with ONLY the refined plan as `CHANGE:`/`ACCEPTANCE:` lines (improve it if needed, " +
    "keep it if it's already good). Do NOT edit any files.\n\n" +
    `PLAN:\n${o.brief}`;
  const r = await worker.run({ prompt, cwd: o.cwd, runId: `review-${Date.now()}`, model: o.model ?? undefined });
  if (!r.ok) return o.brief;
  const refined = r.output.trim();
  return refined.length > 0 ? refined : o.brief;
}
```

- [ ] **Step 4: Run — expect PASS**: `npm -w server run test -- self/review`
- [ ] **Step 5: Commit**

```bash
git add server/src/self/review.ts server/src/self/review.test.ts
git commit -m "feat(self): code-grounded plan review (Claude reads the repo, refines the brief)"
```

---

## Task 6: Wire review + escalation into the improver

**Files:**
- Modify: `server/src/self/improver.ts`
- Test: `server/src/self/improver.test.ts`

v2 loop: reflect → **review** → for each attempt model `[chosen, Opus-max]`: implement → verify; first green wins; on failure re-reflect with the failure log and try the next model; if all fail, fail.

- [ ] **Step 1: Write the failing tests** (add to `improver.test.ts`)

```ts
import { ESCALATION } from "./model-policy.js";

it("escalates to Opus 4.8 max when the first attempt fails verify, and ships the retry", async () => {
  const d = db();
  const id = createIntent(d, { trigger: "explicit", goal: "g", model: "sonnet" });
  const usedModels: Array<unknown> = [];
  let calls = 0;
  await runImprovement(d, id, deps({
    reviewPlan: async (brief: string) => brief + " [reviewed]",
    implement: async (_brief: string, _cwd: string, model: unknown) => { usedModels.push(model); return { ok: true, output: "" }; },
    verify: async () => (++calls === 1 ? { ok: false, log: "tests failed" } : { ok: true, log: "ok" }),
  }));
  expect(getIntent(d, id)!.status).toBe("swapped");
  expect(usedModels).toEqual([{ model: "sonnet" }, ESCALATION]); // chosen, then escalation
});

it("records the reviewed brief in review_log", async () => {
  const d = db();
  const id = createIntent(d, { trigger: "explicit", goal: "g" });
  await runImprovement(d, id, deps({ reviewPlan: async (b: string) => b + " [reviewed]" }));
  expect(getIntent(d, id)!.review_log).toContain("[reviewed]");
});
```

Update the test `deps(...)` factory to include `reviewPlan: async (b: string) => b` and make `implement` accept a third `model` arg.

- [ ] **Step 2: Run — expect FAIL**: `npm -w server run test -- self/improver`

- [ ] **Step 3: Implement** — in `server/src/self/improver.ts`:

Extend `ImproverDeps`:
```ts
import { attemptsFor, type ModelSpec } from "./model-policy.js";

export type ImproverDeps = {
  reflect: (goal: string, failureLog: string | null) => Promise<string>;
  reviewPlan: (brief: string, cwd: string, model: ModelSpec | null) => Promise<string>;
  addWorktree: (id: string) => { path: string; branch: string };
  removeWorktree: (wt: { path: string; branch: string }) => void;
  resetWorktree: (cwd: string) => void;               // NEW: clean between attempts
  implement: (brief: string, cwd: string, model: ModelSpec) => Promise<{ ok: boolean; output: string }>;
  verify: (cwd: string) => Promise<{ ok: boolean; log: string }>;
  headSha: () => string;
  commitWorktree: (cwd: string, msg: string) => string;
  swapTo: (sha: string) => void;
  revertTo: (sha: string) => void;
  restart: () => Promise<void>;
  watch: (knownGood: string) => Promise<void>;
  emit: (e: { intentId: string; step: string; ok?: boolean }) => void;
};
```

Replace the body between `addWorktree` and the commit with review + escalation:
```ts
updateIntent(db, id, { status: "implementing" }); deps.emit({ intentId: id, step: "implementing" });
wt = deps.addWorktree(id);

const chosen: ModelSpec | null = intent.model ? { model: intent.model } : null;
let brief = await deps.reflect(intent.goal, null);
const reviewed = await deps.reviewPlan(brief, wt.path, chosen);
updateIntent(db, id, { review_log: reviewed.slice(0, 4000) });
brief = reviewed;

let lastFailure: string | null = null;
let verified = false;
const attempts = attemptsFor(chosen);
for (let i = 0; i < attempts.length; i++) {
  if (i > 0) {                      // retry: clean the worktree + re-plan with the failure
    deps.resetWorktree(wt.path);
    brief = await deps.reflect(intent.goal, lastFailure);
  }
  const impl = await deps.implement(brief, wt.path, attempts[i]!);
  updateIntent(db, id, { diff_summary: `BRIEF:\n${brief}\n\nWORKER:\n${impl.output ?? ""}`.slice(0, 4000) });
  if (!impl.ok) { lastFailure = `implement failed: ${impl.output.slice(0, 500)}`; continue; }

  updateIntent(db, id, { status: "verifying" }); deps.emit({ intentId: id, step: "verifying" });
  const v = await deps.verify(wt.path);
  updateIntent(db, id, { verify_log: v.log });
  if (v.ok) { verified = true; break; }
  lastFailure = v.log;
}
if (!verified) throw new Error(lastFailure ?? "all attempts failed");
```
(The subsequent `commitWorktree → swapTo → watch` block is unchanged.)

- [ ] **Step 4: Run — expect PASS**: `npm -w server run test -- self/improver`
- [ ] **Step 5: Wire the new deps in `server/src/index.ts`** `buildImproverDeps`:

```ts
reviewPlan: (brief, cwd, model) => reviewPlan(selfClaudeCode, { brief, cwd, model }),
implement: async (brief, cwd, model) => {
  const r = await selfClaudeCode.run({ prompt: brief, cwd, runId: nanoid(12), model });
  return r.ok ? { ok: true, output: r.output } : { ok: false, output: r.reason };
},
resetWorktree: (cwd) => { execFileSync("git", ["reset", "--hard"], { cwd }); execFileSync("git", ["clean", "-fd"], { cwd }); },
```
(Add `import { reviewPlan } from "./self/review.js";`.)

- [ ] **Step 6: Typecheck + full suite**: `npx tsc --noEmit -p server/tsconfig.json` then `npm -w server run test`
- [ ] **Step 7: Commit**

```bash
git add server/src/self/improver.ts server/src/self/improver.test.ts server/src/index.ts
git commit -m "feat(self): plan review + escalate to Opus 4.8 max on verify failure"
```

---

## Task 7: Integration — chosen model, review, escalation end-to-end

**Files:**
- Test: `server/src/self/improver.integration.test.ts` (extend)

- [ ] **Step 1: Add a test** that runs `runImprovement` with real `attemptsFor` + a fake worker whose first model no-ops/fails verify and whose escalation model succeeds, against a real temp git repo (mirror the existing integration test's repo setup). Assert: `status === "swapped"`, the commit exists, and the escalation model was the one used for the successful attempt.
- [ ] **Step 2: Run — expect PASS**: `npm -w server run test -- self/improver.integration`
- [ ] **Step 3: Full suite + typecheck**: `npm test` then `npx tsc --noEmit -p server/tsconfig.json`
- [ ] **Step 4: Commit**

```bash
git add server/src/self/improver.integration.test.ts
git commit -m "test(self): v2 integration — review + model escalation ship a change"
```

---

## Self-Review

**Spec coverage:**
- *Per-task model choice* → Tasks 1–4 (ModelSpec, worker flags, persisted on intent, accepted by tool+route).
- *Ava + Claude collaborate on the plan* → Task 5 (`reviewPlan`, code-grounded) + Task 6 (wired between reflect and implement).
- *Escalate to Opus 4.8 max on test failure* → Task 1 (`ESCALATION`/`attemptsFor`) + Task 6 (escalation loop with re-reflect on the failure log).
- *Build done by Claude Code* → unchanged (existing `implement`).

**Type consistency:** `ModelSpec` is defined once (Task 1) and used identically in `claude-code.ts` (Task 2), `review.ts` (Task 5), and `improver.ts` (Task 6). `implement` is `(brief, cwd, model: ModelSpec)` everywhere after Task 6; `reviewPlan` is `(brief, cwd, model: ModelSpec | null)`.

**Open detail to confirm during execution:** the exact `--effort` max level name (`"high"` assumed) — verify against `claude --help` output; adjust `ESCALATION.effort` if the max level is named differently.

---

## Phase 2 (separate plans — recommended next)

1. **Persistent Ava↔Claude chat.** Give the worker session continuity via `claude --resume <session-id>` / `-c, --continue` (persistence is on by default) so Ava and Claude carry one ongoing conversation instead of meeting fresh each call. Store the session id on the intent (or a per-Ava singleton). Subscription auth is already in place (`workerEnv`).
2. **Ava self-initiates ideas.** A "suggest" path where Ava asks Claude "what should I improve, and why?", reads the repo, and proposes goals for the user to approve — feeding the same v2 pipeline.
