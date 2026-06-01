# Ava Self-Improvement — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Ava edit its own code on the *explicit* trigger ("improve yourself so you can X"), verify the change in isolation, swap it into the running process, and auto-roll-back if it fails to run — without ever bricking itself.

**Architecture:** An in-process loop (`server/src/self/*`) reuses the existing `claude_code` tool, build/test scripts, and SSE. The dangerous step — swapping new code into the live process — is guarded by a **transient detached watchdog** that reverts to the last known-good commit if the new process doesn't report healthy. The currently-running (known-good) Ava always verifies a candidate before swapping; nothing is permanently fenced.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, Vitest + supertest, the existing `LLMProvider` + `claude_code` tool, `git worktree`, React 19 (Vite) PWA.

**Spec:** [docs/superpowers/specs/2026-06-01-ava-self-improvement-design.md](../specs/2026-06-01-ava-self-improvement-design.md)

**Build order (locked):** intents store → identity → reflect → worktree → swap → verify → watchdog → improver → tool+route → Self screen → end-to-end integration. Each task ships green with its own tests; the orchestrator (Task 8) injects the units built before it.

---

## File Structure

**Created (server):**
- `server/src/self/intents.ts` (+ `.test.ts`) — `self_improvements` table accessors.
- `server/src/self/identity.ts` (+ `.test.ts`) — reads `SELF.md` + repo facts.
- `server/src/self/SELF.md` — curated architecture map (static content).
- `server/src/self/reflect.ts` (+ `.test.ts`) — goal → change brief via `LLMProvider`.
- `server/src/self/worktree.ts` (+ `.test.ts`) — `git worktree` add/remove.
- `server/src/self/swap.ts` (+ `.test.ts`) — record known-good, fast-forward, revert.
- `server/src/self/verify.ts` (+ `.test.ts`) — run checks + boot smoke-test via an injected runner.
- `server/src/self/boot-smoke.ts` (+ `.test.ts`) — the auth/health/scrubber boot probe.
- `server/src/self/watchdog.ts` (+ `.test.ts`) — health-wait → rollback decision + spawn.
- `server/src/self/improver.ts` (+ `.test.ts`) — orchestrates the loop; single-flight lock.
- `server/src/routes/self.ts` (+ `.test.ts`) — `POST /api/self/improve`, `GET /api/self`, controls.
- `server/src/tools/self-improve-mcp.ts` (+ `.test.ts`) — the `self_improve` tool.

**Created (web):**
- `web/src/self/SelfScreen.tsx` (+ `.smoke.test.tsx`) — journal + Pause + Revert-last.
- `web/src/self/useSelfJournal.ts` (+ `.smoke.test.ts`) — fetch + SSE subscription.

**Modified:**
- `server/src/state/schema.sql` — add the `self_improvements` table.
- `server/src/index.ts` — mount `self` routes + construct the improver.
- `server/src/routes/chat.ts` — route "improve yourself…" to the `self_improve` tool (already covered by the action-mode tool stack; add the tool to the registry).
- `web/src/App.tsx` — add the `self` view + navigation entry.

---

## Task 1: `self_improvements` store

**Files:**
- Modify: `server/src/state/schema.sql`
- Create: `server/src/self/intents.ts`
- Test: `server/src/self/intents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent, listIntents, updateIntent } from "./intents.js";

function db() { return openDb(join(mkdtempSync(join(tmpdir(), "ava-self-")), "x.db")); }

describe("self_improvements store", () => {
  it("creates a queued intent and reads it back", () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "be faster at X" });
    const row = getIntent(d, id)!;
    expect(row.goal).toBe("be faster at X");
    expect(row.status).toBe("queued");
    expect(row.trigger).toBe("explicit");
  });

  it("updates status + fields and lists newest first", () => {
    const d = db();
    const a = createIntent(d, { trigger: "explicit", goal: "a" });
    const b = createIntent(d, { trigger: "explicit", goal: "b" });
    updateIntent(d, b, { status: "swapped", commit_sha: "deadbeef", diff_summary: "did b" });
    expect(getIntent(d, b)!.status).toBe("swapped");
    expect(getIntent(d, b)!.commit_sha).toBe("deadbeef");
    expect(listIntents(d).map((r) => r.id)).toEqual([b, a]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w server run test -- intents.test`
Expected: FAIL — `createIntent is not a function` / missing table.

- [ ] **Step 3: Add the table to `schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS self_improvements (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  branch TEXT,
  commit_sha TEXT,
  last_known_good TEXT,
  diff_summary TEXT,
  verify_log TEXT,
  outcome TEXT,
  error TEXT
);
```

- [ ] **Step 4: Implement `intents.ts`**

```ts
import { nanoid } from "nanoid";
import type { Db } from "../state/db.js";

export type IntentTrigger = "explicit" | "failure" | "friction" | "schedule";
export type IntentStatus =
  | "queued" | "reflecting" | "implementing" | "verifying"
  | "swapped" | "failed" | "rolled_back";

export type Intent = {
  id: string; created_at: number; trigger: IntentTrigger; goal: string;
  status: IntentStatus; branch: string | null; commit_sha: string | null;
  last_known_good: string | null; diff_summary: string | null;
  verify_log: string | null; outcome: string | null; error: string | null;
};

export function createIntent(db: Db, o: { trigger: IntentTrigger; goal: string }): string {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO self_improvements (id, created_at, trigger, goal, status) VALUES (?, ?, ?, ?, 'queued')",
  ).run(id, Date.now(), o.trigger, o.goal);
  return id;
}

export function getIntent(db: Db, id: string): Intent | null {
  return (db.prepare("SELECT * FROM self_improvements WHERE id = ?").get(id) as Intent) ?? null;
}

export function listIntents(db: Db): Intent[] {
  return db.prepare("SELECT * FROM self_improvements ORDER BY created_at DESC, id DESC").all() as Intent[];
}

export function updateIntent(db: Db, id: string, patch: Partial<Omit<Intent, "id" | "created_at">>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE self_improvements SET ${set} WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), id);
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm -w server run test -- intents.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add server/src/state/schema.sql server/src/self/intents.ts server/src/self/intents.test.ts
git commit -m "feat(self): self_improvements store"
```

---

## Task 2: `identity.ts` + `SELF.md`

**Files:**
- Create: `server/src/self/SELF.md`, `server/src/self/identity.ts`
- Test: `server/src/self/identity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { loadSelfKnowledge } from "./identity.js";

describe("loadSelfKnowledge", () => {
  it("returns repo facts + the SELF.md body", () => {
    const k = loadSelfKnowledge({ repoRoot: "C:/ai/chemiapebi/yovlisshemdzle" });
    expect(k.repoRoot).toContain("yovlisshemdzle");
    expect(k.testCmd).toBe("npm test");
    expect(k.body).toMatch(/Ava/);
    expect(k.body.length).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`loadSelfKnowledge is not a function`).

Run: `npm -w server run test -- identity.test`

- [ ] **Step 3: Write `SELF.md`** (curated; abbreviated here — include the real module map when implementing)

```markdown
# Ava — self-knowledge
Ava is a personal AI agent. Monorepo: `server/` (Express + better-sqlite3 orchestrator
and tool host) and `web/` (Vite + React 19 PWA). Build: `npm -w web run build` then
`npm -w server run build`. Test: `npm test`. Run (dev): `npm -w server run dev`.
Key dirs: server/src/orchestrator (agent loop), server/src/tools (claude_code, chrome,
shell, fs, memory), server/src/self (this self-improvement system), server/src/memory.
```

- [ ] **Step 4: Implement `identity.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type SelfKnowledge = {
  repoRoot: string; testCmd: string; buildCmd: string; devCmd: string; body: string;
};

export function loadSelfKnowledge(opts: { repoRoot: string }): SelfKnowledge {
  const selfMd = fileURLToPath(new URL("./SELF.md", import.meta.url));
  return {
    repoRoot: opts.repoRoot,
    testCmd: "npm test",
    buildCmd: "npm -w web run build && npm -w server run build",
    devCmd: "npm -w server run dev",
    body: readFileSync(selfMd, "utf8"),
  };
}
```

- [ ] **Step 5: Run tests — expect PASS.** `npm -w server run test -- identity.test`

- [ ] **Step 6: Commit**

```bash
git add server/src/self/SELF.md server/src/self/identity.ts server/src/self/identity.test.ts
git commit -m "feat(self): self-knowledge (SELF.md + identity)"
```

---

## Task 3: `reflect.ts` (goal → change brief)

**Files:**
- Create: `server/src/self/reflect.ts`
- Test: `server/src/self/reflect.test.ts`

Uses the existing `LLMProvider` interface (`server/src/orchestrator/llm/types.ts`) and the `MockLLMProvider` for tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { reflect } from "./reflect.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

describe("reflect", () => {
  it("asks the model for a change brief and returns its text", async () => {
    const provider = new MockLLMProvider({
      scripts: [[{ kind: "delta", text: "CHANGE: add X to file Y\nACCEPTANCE: test Z passes" },
                 { kind: "done", stop_reason: "end_turn" }]],
    });
    const brief = await reflect({
      provider, goal: "be faster at greetings",
      knowledge: { repoRoot: "R", testCmd: "npm test", buildCmd: "b", devCmd: "d", body: "map" },
      failureLog: null,
    });
    expect(brief).toContain("CHANGE:");
    expect(brief).toContain("ACCEPTANCE:");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- reflect.test`

- [ ] **Step 3: Implement `reflect.ts`**

```ts
import type { LLMProvider } from "../orchestrator/llm/types.js";
import type { SelfKnowledge } from "./identity.js";

export async function reflect(o: {
  provider: LLMProvider; goal: string; knowledge: SelfKnowledge; failureLog: string | null;
}): Promise<string> {
  const system =
    "You are Ava planning a change to your OWN codebase. Produce a concise change brief:\n" +
    "lines starting CHANGE: (what to edit, which files) and ACCEPTANCE: (how a test/build proves it).\n" +
    "Be specific and minimal. Do not write the code; describe the change for a coding worker.\n\n" +
    `REPO: ${o.knowledge.repoRoot}\nTEST: ${o.knowledge.testCmd}\n\n${o.knowledge.body}`;
  const user = o.failureLog
    ? `Goal: ${o.goal}\n\nPrevious attempt failed with:\n${o.failureLog}`
    : `Goal: ${o.goal}`;
  let text = "";
  for await (const ev of o.provider.stream({
    model: o.provider.defaultOrchestratorModel,
    system, messages: [{ role: "user", content: user }], tools: [],
    abort: new AbortController().signal, reasoningEffort: "medium",
  })) {
    if (ev.kind === "delta") text += ev.text;
  }
  return text.trim();
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npm -w server run test -- reflect.test`

- [ ] **Step 5: Commit**

```bash
git add server/src/self/reflect.ts server/src/self/reflect.test.ts
git commit -m "feat(self): reflect goal into a change brief"
```

---

## Task 4: `worktree.ts` (git isolation)

**Files:**
- Create: `server/src/self/worktree.ts`
- Test: `server/src/self/worktree.test.ts`

- [ ] **Step 1: Write the failing test** (operates on a real temp git repo)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorktree, removeWorktree } from "./worktree.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-wt-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "f.txt"), "hi"); git("add", "."); git("commit", "-qm", "init");
  return dir;
}

describe("worktree", () => {
  let repo: string; let wt: { path: string; branch: string } | null = null;
  beforeEach(() => { repo = tmpRepo(); });
  afterEach(() => { if (wt) removeWorktree(repo, wt); rmSync(repo, { recursive: true, force: true }); });

  it("adds an isolated worktree on a new branch and removes it", () => {
    wt = addWorktree(repo, "imp-1");
    expect(existsSync(join(wt.path, "f.txt"))).toBe(true);
    expect(wt.branch).toBe("self/imp-1");
    removeWorktree(repo, wt); wt = null;
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- worktree.test`

- [ ] **Step 3: Implement `worktree.ts`**

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Worktree = { path: string; branch: string };

export function addWorktree(repoRoot: string, id: string): Worktree {
  const path = mkdtempSync(join(tmpdir(), "ava-imp-"));
  const branch = `self/${id}`;
  execFileSync("git", ["worktree", "add", "-B", branch, path], { cwd: repoRoot });
  return { path, branch };
}

export function removeWorktree(repoRoot: string, wt: Worktree): void {
  try { execFileSync("git", ["worktree", "remove", "--force", wt.path], { cwd: repoRoot }); } catch { /* */ }
  try { execFileSync("git", ["branch", "-D", wt.branch], { cwd: repoRoot }); } catch { /* */ }
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npm -w server run test -- worktree.test`

- [ ] **Step 5: Commit**

```bash
git add server/src/self/worktree.ts server/src/self/worktree.test.ts
git commit -m "feat(self): git worktree isolation"
```

---

## Task 5: `swap.ts` (known-good, fast-forward, revert)

**Files:**
- Create: `server/src/self/swap.ts`
- Test: `server/src/self/swap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headSha, swapTo, revertTo } from "./swap.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-swap-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "f.txt"), "v1"); git("add", "."); git("commit", "-qm", "v1");
  return dir;
}

describe("swap", () => {
  let repo: string;
  beforeEach(() => { repo = tmpRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("fast-forwards live tree to a commit and can revert to known-good", () => {
    const known = headSha(repo);
    // make a second commit on a branch, then swap to it
    execFileSync("git", ["checkout", "-qb", "cand"], { cwd: repo });
    writeFileSync(join(repo, "f.txt"), "v2");
    execFileSync("git", ["commit", "-qam", "v2"], { cwd: repo });
    const candSha = headSha(repo);
    execFileSync("git", ["checkout", "-q", "master"], { cwd: repo });

    swapTo(repo, candSha);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v2");

    revertTo(repo, known);
    expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("v1");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- swap.test`

- [ ] **Step 3: Implement `swap.ts`**

```ts
import { execFileSync } from "node:child_process";

export function headSha(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
}

export function swapTo(repoRoot: string, sha: string): void {
  // Move the live working tree + current branch to the verified commit.
  execFileSync("git", ["reset", "--hard", sha], { cwd: repoRoot });
}

export function revertTo(repoRoot: string, sha: string): void {
  execFileSync("git", ["reset", "--hard", sha], { cwd: repoRoot });
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npm -w server run test -- swap.test`

- [ ] **Step 5: Commit**

```bash
git add server/src/self/swap.ts server/src/self/swap.test.ts
git commit -m "feat(self): swap + revert via git reset"
```

---

## Task 6: `verify.ts` + `boot-smoke.ts`

**Files:**
- Create: `server/src/self/boot-smoke.ts`, `server/src/self/verify.ts`
- Test: `server/src/self/verify.test.ts`

`verify.ts` takes an injected `run(cmd, cwd)` so tests don't spawn real builds. `boot-smoke.ts` is exercised by the integration test (Task 11); here it is injected as a function.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { verify } from "./verify.js";

describe("verify", () => {
  const ok = async () => ({ code: 0, output: "ok" });
  const fail = async () => ({ code: 1, output: "boom" });

  it("passes only when every check AND the boot smoke-test pass", async () => {
    const r = await verify({ cwd: "W", run: ok, bootSmoke: async () => ({ ok: true, log: "healthy" }) });
    expect(r.ok).toBe(true);
  });

  it("fails fast and reports which check failed", async () => {
    const calls: string[] = [];
    const run = async (cmd: string) => { calls.push(cmd); return cmd.includes("test") ? { code: 1, output: "tests failed" } : { code: 0, output: "" }; };
    const r = await verify({ cwd: "W", run, bootSmoke: async () => ({ ok: true, log: "" }) });
    expect(r.ok).toBe(false);
    expect(r.log).toContain("tests failed");
    expect(calls.some((c) => c.includes("build"))).toBe(false); // stopped before build
  });

  it("fails when the boot smoke-test fails even if checks pass", async () => {
    const r = await verify({ cwd: "W", run: ok, bootSmoke: async () => ({ ok: false, log: "auth 401" }) });
    expect(r.ok).toBe(false);
    expect(r.log).toContain("auth 401");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- verify.test`

- [ ] **Step 3: Implement `verify.ts`**

```ts
export type RunResult = { code: number; output: string };
export type RunFn = (cmd: string, cwd: string) => Promise<RunResult>;
export type BootSmokeFn = (cwd: string) => Promise<{ ok: boolean; log: string }>;

const CHECKS = ["npm test", "npx tsc --noEmit -p server/tsconfig.json", "npm -w web run build"];

export async function verify(o: { cwd: string; run: RunFn; bootSmoke: BootSmokeFn }): Promise<{ ok: boolean; log: string }> {
  for (const cmd of CHECKS) {
    const r = await o.run(cmd, o.cwd);
    if (r.code !== 0) return { ok: false, log: `FAILED: ${cmd}\n${r.output}` };
  }
  const boot = await o.bootSmoke(o.cwd);
  if (!boot.ok) return { ok: false, log: `FAILED: boot smoke-test\n${boot.log}` };
  return { ok: true, log: "all checks + boot smoke passed" };
}
```

- [ ] **Step 4: Implement `boot-smoke.ts`** (real probe; integration-tested in Task 11)

```ts
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Boots the built candidate on a scratch port + temp DATA_DIR, asserts /api/health,
// then shuts it down. Auth round-trip + scrubber are covered by the candidate's own
// `npm test` (run in verify); this probe proves the built server actually starts.
export async function bootSmoke(cwd: string): Promise<{ ok: boolean; log: string }> {
  const port = 8000 + Math.floor(Math.random() * 1000);
  const dataDir = mkdtempSync(join(tmpdir(), "ava-smoke-"));
  const child = spawn("node", ["dist/index.js"], {
    cwd: join(cwd, "server"),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, OPENAI_API_KEY: "" },
    windowsHide: true,
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  try {
    const ok = await waitForHealth(port, 15_000);
    return { ok, log: ok ? "healthy" : `no /api/health within timeout\n${log.slice(-2000)}` };
  } finally {
    child.kill();
  }
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
```

- [ ] **Step 5: Run tests — expect PASS.** `npm -w server run test -- verify.test`

- [ ] **Step 6: Commit**

```bash
git add server/src/self/verify.ts server/src/self/boot-smoke.ts server/src/self/verify.test.ts
git commit -m "feat(self): verify pipeline + boot smoke-test"
```

---

## Task 7: `watchdog.ts` (rollback authority)

**Files:**
- Create: `server/src/self/watchdog.ts`
- Test: `server/src/self/watchdog.test.ts`

The decision logic is pure and unit-tested; the detached spawn is a thin wrapper.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { decideRollback } from "./watchdog.js";

describe("decideRollback", () => {
  it("does nothing when the new process becomes healthy", async () => {
    const actions: string[] = [];
    await decideRollback({
      checkHealth: async () => true, timeoutMs: 100, intervalMs: 10,
      rollback: async () => { actions.push("rollback"); },
    });
    expect(actions).toEqual([]);
  });

  it("rolls back when health never arrives", async () => {
    const actions: string[] = [];
    await decideRollback({
      checkHealth: async () => false, timeoutMs: 50, intervalMs: 10,
      rollback: async () => { actions.push("rollback"); },
    });
    expect(actions).toEqual(["rollback"]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- watchdog.test`

- [ ] **Step 3: Implement `watchdog.ts`**

```ts
export async function decideRollback(o: {
  checkHealth: () => Promise<boolean>; timeoutMs: number; intervalMs: number;
  rollback: () => Promise<void>;
}): Promise<void> {
  const deadline = Date.now() + o.timeoutMs;
  while (Date.now() < deadline) {
    if (await o.checkHealth()) return;
    await new Promise((r) => setTimeout(r, o.intervalMs));
  }
  await o.rollback();
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npm -w server run test -- watchdog.test`

- [ ] **Step 5: Commit**

```bash
git add server/src/self/watchdog.ts server/src/self/watchdog.test.ts
git commit -m "feat(self): watchdog rollback decision"
```

---

## Task 8: `improver.ts` (orchestrate the loop)

**Files:**
- Create: `server/src/self/improver.ts`
- Test: `server/src/self/improver.test.ts`

Pure orchestration with every external step injected, so the whole loop is unit-tested without git/builds.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent } from "./intents.js";
import { runImprovement } from "./improver.js";

function db() { return openDb(join(mkdtempSync(join(tmpdir(), "ava-imp-")), "x.db")); }
const deps = (over: Partial<any> = {}) => ({
  reflect: async () => "CHANGE: x", addWorktree: () => ({ path: "W", branch: "self/i" }),
  removeWorktree: () => {}, implement: async () => ({ ok: true, output: "" }),
  verify: async () => ({ ok: true, log: "ok" }),
  headSha: () => "good", commitWorktree: () => "cand", swapTo: () => {}, revertTo: () => {},
  restart: async () => {}, watch: async () => {}, emit: () => {}, ...over,
});

describe("runImprovement", () => {
  it("happy path: verified change is swapped and marked swapped", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    await runImprovement(d, id, deps());
    expect(getIntent(d, id)!.status).toBe("swapped");
    expect(getIntent(d, id)!.last_known_good).toBe("good");
  });

  it("verify failure: discards worktree, never swaps, marks failed", async () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "g" });
    let swapped = false;
    await runImprovement(d, id, deps({ verify: async () => ({ ok: false, log: "tests failed" }), swapTo: () => { swapped = true; } }));
    expect(swapped).toBe(false);
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(getIntent(d, id)!.error).toContain("tests failed");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- improver.test`

- [ ] **Step 3: Implement `improver.ts`**

```ts
import type { Db } from "../state/db.js";
import { getIntent, updateIntent } from "./intents.js";

export type ImproverDeps = {
  reflect: (goal: string, failureLog: string | null) => Promise<string>;
  addWorktree: (id: string) => { path: string; branch: string };
  removeWorktree: (wt: { path: string; branch: string }) => void;
  implement: (brief: string, cwd: string) => Promise<{ ok: boolean; output: string }>;
  verify: (cwd: string) => Promise<{ ok: boolean; log: string }>;
  headSha: () => string;
  commitWorktree: (cwd: string, msg: string) => string;
  swapTo: (sha: string) => void;
  revertTo: (sha: string) => void;
  restart: () => Promise<void>;
  watch: (knownGood: string) => Promise<void>;
  emit: (e: { intentId: string; step: string; ok?: boolean }) => void;
};

let inFlight = false; // single-flight lock

export async function runImprovement(db: Db, id: string, deps: ImproverDeps): Promise<void> {
  if (inFlight) { updateIntent(db, id, { status: "failed", error: "another improvement is in progress" }); return; }
  inFlight = true;
  const intent = getIntent(db, id)!;
  let wt: { path: string; branch: string } | null = null;
  try {
    updateIntent(db, id, { status: "reflecting" }); deps.emit({ intentId: id, step: "reflecting" });
    const brief = await deps.reflect(intent.goal, null);

    updateIntent(db, id, { status: "implementing" }); deps.emit({ intentId: id, step: "implementing" });
    wt = deps.addWorktree(id);
    const impl = await deps.implement(brief, wt.path);
    if (!impl.ok) throw new Error(`implement failed: ${impl.output.slice(0, 500)}`);

    updateIntent(db, id, { status: "verifying" }); deps.emit({ intentId: id, step: "verifying" });
    const v = await deps.verify(wt.path);
    updateIntent(db, id, { verify_log: v.log });
    if (!v.ok) throw new Error(v.log);

    const knownGood = deps.headSha();
    const sha = deps.commitWorktree(wt.path, `self: ${intent.goal}`);
    updateIntent(db, id, { last_known_good: knownGood, commit_sha: sha, branch: wt.branch });
    deps.swapTo(sha);
    deps.emit({ intentId: id, step: "swapped", ok: true });
    updateIntent(db, id, { status: "swapped", outcome: "shipped" });

    void deps.watch(knownGood); // transient watchdog; rolls back if unhealthy
    await deps.restart();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateIntent(db, id, { status: "failed", error: msg });
    deps.emit({ intentId: id, step: "failed", ok: false });
  } finally {
    if (wt) deps.removeWorktree(wt);
    inFlight = false;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npm -w server run test -- improver.test`

- [ ] **Step 5: Commit**

```bash
git add server/src/self/improver.ts server/src/self/improver.test.ts
git commit -m "feat(self): improvement loop orchestrator"
```

---

## Task 9: `self_improve` tool + `/api/self` routes

**Files:**
- Create: `server/src/tools/self-improve-mcp.ts`, `server/src/routes/self.ts`
- Test: `server/src/routes/self.test.ts`
- Modify: `server/src/index.ts` (mount routes, build improver deps), `server/src/routes/chat.ts` (add tool to the action stack)

- [ ] **Step 1: Write the failing test (route)**

```ts
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { selfRoutes } from "./self.js";

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "ava-selfroute-")), "x.db"));
  const start = vi.fn(async () => {});
  const app = express(); app.use(express.json());
  app.use("/api/self", selfRoutes(db, (_q, _s, n) => n(), { startImprovement: start }));
  return { app, db, start };
}

describe("/api/self", () => {
  it("POST /improve queues an intent and kicks off the loop", async () => {
    const { app, start } = setup();
    const res = await request(app).post("/api/self/improve").send({ goal: "be faster" }).expect(200);
    expect(res.body.id).toBeTruthy();
    expect(start).toHaveBeenCalledWith(res.body.id);
  });

  it("GET / lists intents", async () => {
    const { app } = setup();
    await request(app).post("/api/self/improve").send({ goal: "x" });
    const res = await request(app).get("/api/self").expect(200);
    expect(res.body.intents.length).toBe(1);
  });

  it("rejects an empty goal", async () => {
    const { app } = setup();
    await request(app).post("/api/self/improve").send({ goal: "" }).expect(400);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w server run test -- self.test`

- [ ] **Step 3: Implement `routes/self.ts`**

```ts
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Db } from "../state/db.js";
import { createIntent, listIntents, getIntent, updateIntent } from "../self/intents.js";

const Body = z.object({ goal: z.string().min(1).max(2000) });

export function selfRoutes(db: Db, auth: RequestHandler, deps: { startImprovement: (id: string) => void }): Router {
  const r = Router();
  r.post("/improve", auth, (req, res) => {
    const p = Body.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: "bad_request" }); return; }
    const id = createIntent(db, { trigger: "explicit", goal: p.data.goal });
    deps.startImprovement(id);
    res.json({ id });
  });
  r.get("/", auth, (_req, res) => res.json({ intents: listIntents(db) }));
  r.post("/:id/revert", auth, (req, res) => {
    const row = getIntent(db, req.params.id);
    if (!row?.last_known_good) { res.status(404).json({ error: "no_known_good" }); return; }
    deps.startImprovement; // revert handled by index wiring; mark intent
    updateIntent(db, row.id, { status: "rolled_back", outcome: "manual revert requested" });
    res.json({ ok: true, revertTo: row.last_known_good });
  });
  return r;
}
```

- [ ] **Step 4: Implement `tools/self-improve-mcp.ts`** (lets Ava call it mid-chat)

```ts
import type { ToolDef } from "./ava-mcp.js";

export function buildSelfImproveTool(deps: { queue: (goal: string) => string }): ToolDef {
  return {
    tool: {
      name: "self_improve",
      description: "Queue an autonomous improvement to Ava's OWN code. Use when Sir says 'improve yourself' or asks Ava to change its own behavior/capabilities. Args: { goal }.",
      inputSchema: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
    },
    run: async (args) => {
      const goal = String(args.goal ?? "").trim();
      if (!goal) return { ok: false, text: "missing goal" };
      const id = deps.queue(goal);
      return { ok: true, text: `queued self-improvement ${id}: ${goal}` };
    },
  };
}
```

- [ ] **Step 5: Wire in `index.ts`** (construct improver deps from real modules; pass `startImprovement` that calls `runImprovement` with concrete adapters for reflect/worktree/verify/swap/watchdog/restart) and mount `app.use("/api/self", selfRoutes(db, requireToken(db), { startImprovement }))`. Add `buildSelfImproveTool({ queue })` to the action-mode tool list in `chat.ts`.

- [ ] **Step 6: Run tests — expect PASS.** `npm -w server run test -- self.test`

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/self.ts server/src/routes/self.test.ts server/src/tools/self-improve-mcp.ts server/src/index.ts server/src/routes/chat.ts
git commit -m "feat(self): self_improve tool + /api/self routes + wiring"
```

---

## Task 10: `SelfScreen` (journal + controls)

**Files:**
- Create: `web/src/self/useSelfJournal.ts`, `web/src/self/SelfScreen.tsx`
- Test: `web/src/self/SelfScreen.smoke.test.tsx`
- Modify: `web/src/App.tsx` (add `self` view + nav entry)

- [ ] **Step 1: Write the failing smoke test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelfScreen } from "./SelfScreen.js";

vi.mock("./useSelfJournal.js", () => ({
  useSelfJournal: () => ({
    intents: [{ id: "i1", goal: "be faster", status: "swapped", outcome: "shipped" }],
    paused: false, setPaused: vi.fn(), revertLast: vi.fn(),
  }),
}));

describe("SelfScreen", () => {
  it("renders the journal and a pause control", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByText(/be faster/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.** `npm -w web run test -- SelfScreen`

- [ ] **Step 3: Implement `useSelfJournal.ts`** (fetch `GET /api/self`; poll or SSE) and **`SelfScreen.tsx`** (list intents with status badges; Pause toggle calling the kill-switch; "Revert last" calling `/api/self/:id/revert`). Keep styling consistent with existing screens (e.g., `RulesScreen.tsx`).

```tsx
import { useSelfJournal } from "./useSelfJournal.js";

export function SelfScreen({ onClose }: { onClose: () => void }) {
  const { intents, paused, setPaused, revertLast } = useSelfJournal();
  return (
    <div className="absolute inset-0 bg-black text-white p-5 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-widest text-white/60">Self-improvement</h2>
        <button onClick={onClose} aria-label="close" className="text-white/60">✕</button>
      </div>
      <div className="flex gap-3 mb-4">
        <button onClick={() => setPaused(!paused)} className="px-3 py-1 rounded border border-white/15">
          {paused ? "Resume" : "Pause"}
        </button>
        <button onClick={revertLast} className="px-3 py-1 rounded border border-white/15">Revert last</button>
      </div>
      <ul className="space-y-2">
        {intents.map((i) => (
          <li key={i.id} className="border border-white/10 rounded p-3">
            <div className="text-sm">{i.goal}</div>
            <div className="text-[10px] uppercase tracking-widest text-white/40">{i.status}{i.outcome ? ` · ${i.outcome}` : ""}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS.** `npm -w web run test -- SelfScreen`

- [ ] **Step 5: Commit**

```bash
git add web/src/self/ web/src/App.tsx
git commit -m "feat(self): Self screen — journal + pause + revert"
```

---

## Task 11: End-to-end integration test

**Files:**
- Test: `server/src/self/improver.integration.test.ts`

Proves the real loop on a throwaway clone: a trivial change swaps; a breaking change is rejected and rolled back. Uses real `worktree`/`swap` + a fake `implement` (writes a file) + real `verify` with an injected `run` that runs a fast fake test, and a `bootSmoke` stub.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent } from "./intents.js";
import { runImprovement } from "./improver.js";
import { addWorktree, removeWorktree } from "./worktree.js";
import { headSha, swapTo, revertTo } from "./swap.js";

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ava-e2e-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  git("init", "-q"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  writeFileSync(join(dir, "marker.txt"), "v1"); git("add", "."); git("commit", "-qm", "v1");
  return dir;
}
const commitWorktree = (cwd: string, msg: string) => {
  execFileSync("git", ["add", "-A"], { cwd }); execFileSync("git", ["commit", "-qm", msg], { cwd });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd }).toString().trim();
};

describe("self-improvement integration", () => {
  let repo: string;
  beforeEach(() => { repo = tmpRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const baseDeps = (over: any) => ({
    reflect: async () => "CHANGE: edit marker",
    addWorktree: (id: string) => addWorktree(repo, id),
    removeWorktree: (wt: any) => removeWorktree(repo, wt),
    headSha: () => headSha(repo),
    commitWorktree, swapTo: (sha: string) => swapTo(repo, sha), revertTo: (sha: string) => revertTo(repo, sha),
    restart: async () => {}, watch: async () => {}, emit: () => {}, ...over,
  });

  it("ships a verified change into the live tree", async () => {
    const d = openDb(join(repo, "state.db"));
    const id = createIntent(d, { trigger: "explicit", goal: "bump marker" });
    await runImprovement(d, id, baseDeps({
      implement: async (_b: string, cwd: string) => { writeFileSync(join(cwd, "marker.txt"), "v2"); return { ok: true, output: "" }; },
      verify: async () => ({ ok: true, log: "ok" }),
    }));
    expect(getIntent(d, id)!.status).toBe("swapped");
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("v2");
  });

  it("rejects a change that fails verify and leaves the live tree untouched", async () => {
    const d = openDb(join(repo, "state.db"));
    const id = createIntent(d, { trigger: "explicit", goal: "bad change" });
    await runImprovement(d, id, baseDeps({
      implement: async (_b: string, cwd: string) => { writeFileSync(join(cwd, "marker.txt"), "broken"); return { ok: true, output: "" }; },
      verify: async () => ({ ok: false, log: "tests failed" }),
    }));
    expect(getIntent(d, id)!.status).toBe("failed");
    expect(readFileSync(join(repo, "marker.txt"), "utf8")).toBe("v1"); // live tree untouched
  });
});
```

- [ ] **Step 2: Run — expect PASS** (after Tasks 1–8). `npm -w server run test -- improver.integration`

- [ ] **Step 3: Full suite + typecheck**

Run: `npm test` then `npx tsc --noEmit -p server/tsconfig.json` and `npx tsc -b web`
Expected: all green, exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/self/improver.integration.test.ts
git commit -m "test(self): end-to-end loop — ship vs reject+rollback"
```

---

## Self-Review

**Spec coverage:** §6 loop → Tasks 3–8; §7 module map → Tasks 1–10; §8 data model → Task 1; §9 safety (verify/boot-smoke/single-flight/timeouts) → Tasks 6–8; §10 control surface → Task 10; §11 error handling → Task 8 + 9; integration (§spec testing) → Task 11. Self-knowledge (§5) → Task 2.

**Deferred to Phase 2 (not in this plan, by design):** autonomous triggers (failure/friction/schedule). The `trigger` column + `runImprovement` already accept them.

**Known wiring note for Task 9:** the concrete `startImprovement` adapter in `index.ts` binds `reflect`→`reflect.ts` (with the real provider), `implement`→ the existing `claude_code` tool, `verify`→`verify.ts` with a real `run` (spawning `npm`) + `bootSmoke`, and `watch`→ a detached process invoking `decideRollback` with `revertTo` + restart. Restart mechanism (tsx-watch touch vs pm2 restart) is the one open item from spec §14 — pin it during Task 9.
