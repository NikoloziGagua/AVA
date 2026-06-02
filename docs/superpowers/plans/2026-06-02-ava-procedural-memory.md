# Ava Procedural Memory ("Playbooks") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Ava completes a successful multi-step task, save a high-level "playbook" of how it did it; on a similar later request, recall and inject that playbook so Ava follows the known path faster.

**Architecture:** A focused `server/src/playbooks/` module (store → distill → match → capture) plus thin wiring in `chat.ts`. Reuses `memory/store.ts` (secret-scrubbed writes), `policy/classify.ts` (deterministic stakes), the `LLMProvider` + `MockLLMProvider`, and the project-context injection pattern.

**Tech Stack:** TypeScript, better-sqlite3-adjacent file memory, Vitest, the existing `LLMProvider`.

**Spec:** [docs/superpowers/specs/2026-06-02-ava-procedural-memory-design.md](../specs/2026-06-02-ava-procedural-memory-design.md)

**Refinement vs spec:** stakes is a single **playbook-level** flag (`routine` | `consequential`), computed deterministically from the risk tiers of the tools the run used — matching the user's task-level "adaptive by stakes" choice (not per-step tags).

**Build order (locked):** store → store mutations (bumpUse/prune) → distill → match → capture → chat wiring → integration.

---

## File Structure

**Created (all under `server/src/playbooks/`, tests co-located):**
- `store.ts` — `Playbook` type, serialize/parse, `slugify`, `writePlaybook`/`readPlaybook`/`listPlaybooks`, `loadPlaybookIndex`.
- `mutate.ts` — `bumpUse`, `prunePlaybooks`.
- `distill.ts` — `distillPlaybook` (run → Playbook via LLM + `classifyRisk`).
- `match.ts` — `matchPlaybook` (side model picks a slug or null).
- `capture.ts` — `maybeCapture` (gate ≥2 tools + success → distill → write).

**Modified:**
- `server/src/routes/chat.ts` — step collector on `emit`, post-run capture trigger, pre-run match + playbook injection.

---

## Task 1: Playbook store

**Files:**
- Create: `server/src/playbooks/store.ts`
- Test: `server/src/playbooks/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, writePlaybook, readPlaybook, listPlaybooks, loadPlaybookIndex, type Playbook } from "./store.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-pb-")); }
const sample = (over: Partial<Playbook> = {}): Playbook => ({
  slug: "download-electricity-bill", trigger: "download the electricity bill",
  keywords: ["electricity", "bill"], created: "2026-06-02", last_used: "2026-06-02",
  uses: 1, stakes: "consequential", steps: ["open the billing page", "download the PDF to Downloads"], ...over,
});

describe("playbook store", () => {
  let d: string;
  beforeEach(() => { d = dir(); });

  it("slugifies a trigger into a safe slug", () => {
    expect(slugify("Download the Electricity Bill!")).toBe("download-the-electricity-bill");
  });

  it("round-trips a playbook through write/read", () => {
    writePlaybook(d, sample());
    const r = readPlaybook(d, "download-electricity-bill")!;
    expect(r.trigger).toBe("download the electricity bill");
    expect(r.keywords).toEqual(["electricity", "bill"]);
    expect(r.uses).toBe(1);
    expect(r.stakes).toBe("consequential");
    expect(r.steps).toEqual(["open the billing page", "download the PDF to Downloads"]);
  });

  it("lists playbooks and exposes a slim index", () => {
    writePlaybook(d, sample());
    writePlaybook(d, sample({ slug: "post-tweet", trigger: "post a tweet", stakes: "routine" }));
    expect(listPlaybooks(d).map((p) => p.slug).sort()).toEqual(["download-electricity-bill", "post-tweet"]);
    expect(loadPlaybookIndex(d).find((e) => e.slug === "post-tweet")!.trigger).toBe("post a tweet");
  });

  it("scrubs secrets in steps on write (memory firewall)", () => {
    writePlaybook(d, sample({ slug: "leaky", steps: ["use key sk-ant-abcdefghijklmnopqrstuvwxyz123456"] }));
    const raw = readFileSync(join(d, "playbooks", "leaky.md"), "utf8");
    expect(raw).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(raw).toContain("sk-ant-***");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`slugify is not a function`): `npm -w server run test -- playbooks/store.test`

- [ ] **Step 3: Implement `server/src/playbooks/store.ts`**

```ts
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";

export type Stakes = "routine" | "consequential";
export type Playbook = {
  slug: string; trigger: string; keywords: string[];
  created: string; last_used: string; uses: number; stakes: Stakes; steps: string[];
};

export function slugify(trigger: string): string {
  return trigger.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "playbook";
}

export function serializePlaybook(pb: Playbook): string {
  const head = [
    `trigger: ${pb.trigger}`, `keywords: ${pb.keywords.join(", ")}`,
    `created: ${pb.created}`, `last_used: ${pb.last_used}`,
    `uses: ${pb.uses}`, `stakes: ${pb.stakes}`,
  ].join("\n");
  const steps = pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `---\n${head}\n---\n# Steps\n${steps}\n`;
}

export function parsePlaybook(slug: string, content: string): Playbook | null {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!m) return null;
  const head: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!head.trigger) return null;
  const steps = m[2]!.split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, "").trim())
    .filter((l) => l && l !== "# Steps");
  return {
    slug, trigger: head.trigger,
    keywords: (head.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
    created: head.created ?? "", last_used: head.last_used ?? "", uses: Number(head.uses ?? "0"),
    stakes: head.stakes === "consequential" ? "consequential" : "routine", steps,
  };
}

const pbDir = (memoryDir: string) => join(memoryDir, "playbooks");
const pbFile = (memoryDir: string, slug: string) => join(pbDir(memoryDir), `${slug}.md`);

export function writePlaybook(memoryDir: string, pb: Playbook): void {
  mkdirSync(pbDir(memoryDir), { recursive: true });
  writeFile(pbFile(memoryDir, pb.slug), serializePlaybook(pb));
}
export function readPlaybook(memoryDir: string, slug: string): Playbook | null {
  const c = readFile(pbFile(memoryDir, slug));
  return c ? parsePlaybook(slug, c) : null;
}
export function listPlaybooks(memoryDir: string): Playbook[] {
  const d = pbDir(memoryDir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith(".md"))
    .map((f) => readPlaybook(memoryDir, f.replace(/\.md$/, "")))
    .filter((p): p is Playbook => p !== null);
}
export function loadPlaybookIndex(memoryDir: string): { slug: string; trigger: string }[] {
  return listPlaybooks(memoryDir).map((p) => ({ slug: p.slug, trigger: p.trigger }));
}
```

- [ ] **Step 4: Run — expect PASS** (4 tests): `npm -w server run test -- playbooks/store.test`
- [ ] **Step 5: Commit**

```bash
git add server/src/playbooks/store.ts server/src/playbooks/store.test.ts
git commit -m "feat(playbooks): store — serialize/parse/read/write/list + slug"
```

---

## Task 2: Store mutations — bumpUse + prune

**Files:**
- Create: `server/src/playbooks/mutate.ts`
- Test: `server/src/playbooks/mutate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePlaybook, readPlaybook, listPlaybooks, type Playbook } from "./store.js";
import { bumpUse, prunePlaybooks } from "./mutate.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-pbm-")); }
const pb = (slug: string, over: Partial<Playbook> = {}): Playbook => ({
  slug, trigger: slug, keywords: [], created: "2026-01-01", last_used: "2026-01-01",
  uses: 1, stakes: "routine", steps: ["a", "b"], ...over,
});

describe("bumpUse", () => {
  it("increments uses and updates last_used", () => {
    const d = dir(); writePlaybook(d, pb("x", { uses: 2 }));
    bumpUse(d, "x", "2026-06-02");
    const r = readPlaybook(d, "x")!;
    expect(r.uses).toBe(3);
    expect(r.last_used).toBe("2026-06-02");
  });
  it("is a no-op for an unknown slug", () => {
    const d = dir(); expect(() => bumpUse(d, "nope", "2026-06-02")).not.toThrow();
  });
});

describe("prunePlaybooks", () => {
  it("drops stale one-off playbooks past the age cutoff", () => {
    const d = dir();
    writePlaybook(d, pb("old-oneoff", { uses: 1, last_used: "2026-01-01" }));
    writePlaybook(d, pb("kept-used", { uses: 9, last_used: "2026-01-01" }));
    prunePlaybooks(d, { today: "2026-06-02", maxAgeDays: 30, softCap: 50 });
    expect(listPlaybooks(d).map((p) => p.slug).sort()).toEqual(["kept-used"]);
  });
  it("caps total count, keeping the most-used", () => {
    const d = dir();
    for (let i = 0; i < 5; i++) writePlaybook(d, pb(`p${i}`, { uses: i, last_used: "2026-06-02" }));
    prunePlaybooks(d, { today: "2026-06-02", maxAgeDays: 365, softCap: 3 });
    const kept = listPlaybooks(d).map((p) => p.slug).sort();
    expect(kept).toEqual(["p2", "p3", "p4"]); // lowest-use dropped
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm -w server run test -- playbooks/mutate.test`

- [ ] **Step 3: Implement `server/src/playbooks/mutate.ts`**

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { listPlaybooks, readPlaybook, writePlaybook } from "./store.js";

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function bumpUse(memoryDir: string, slug: string, today: string): void {
  const pb = readPlaybook(memoryDir, slug);
  if (!pb) return;
  writePlaybook(memoryDir, { ...pb, uses: pb.uses + 1, last_used: today });
}

export function prunePlaybooks(
  memoryDir: string,
  opts: { today: string; maxAgeDays: number; softCap: number },
): void {
  let all = listPlaybooks(memoryDir);
  // 1. drop stale one-offs (uses <= 1 AND older than maxAgeDays)
  const drop = (slug: string) => rmSync(join(memoryDir, "playbooks", `${slug}.md`), { force: true });
  for (const p of all) {
    if (p.uses <= 1 && daysBetween(p.last_used || p.created, opts.today) > opts.maxAgeDays) drop(p.slug);
  }
  // 2. enforce soft cap, keeping most-used (tie-break newest last_used)
  all = listPlaybooks(memoryDir);
  if (all.length > opts.softCap) {
    const ranked = [...all].sort((a, b) => b.uses - a.uses || b.last_used.localeCompare(a.last_used));
    for (const p of ranked.slice(opts.softCap)) drop(p.slug);
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `npm -w server run test -- playbooks/mutate.test`
- [ ] **Step 5: Commit**

```bash
git add server/src/playbooks/mutate.ts server/src/playbooks/mutate.test.ts
git commit -m "feat(playbooks): bumpUse + prune by use/age/cap"
```

---

## Task 3: Distill a run into a playbook

**Files:**
- Create: `server/src/playbooks/distill.ts`
- Test: `server/src/playbooks/distill.test.ts`

Distill calls the LLM for the human parts (trigger/keywords/steps) and computes `stakes` deterministically from `classifyRisk` over the run's tool calls. The LLM returns a small JSON object.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { distillPlaybook, type RunStep } from "./distill.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

const llmJson = (obj: unknown) => new MockLLMProvider({
  scripts: [[{ kind: "delta", text: JSON.stringify(obj) }, { kind: "done", stop_reason: "end_turn" }]],
});

describe("distillPlaybook", () => {
  it("builds a playbook and marks stakes consequential when a write tool was used", async () => {
    const provider = llmJson({ trigger: "download the electricity bill", keywords: ["electricity", "bill"], steps: ["open billing page", "download the PDF"] });
    const steps: RunStep[] = [
      { tool: "chrome_navigate", args: { url: "https://x" }, ok: true },
      { tool: "fs_write", args: { path: "C:/Users/x/Downloads/bill.pdf" }, ok: true },
    ];
    const pb = (await distillPlaybook({ provider, goal: "get my bill", steps, outcome: "done", today: "2026-06-02" }))!;
    expect(pb.trigger).toBe("download the electricity bill");
    expect(pb.slug).toBe("download-the-electricity-bill");
    expect(pb.stakes).toBe("consequential"); // fs_write => medium/high tier
    expect(pb.uses).toBe(1);
    expect(pb.steps.length).toBe(2);
  });

  it("marks stakes routine when only read-only tools were used", async () => {
    const provider = llmJson({ trigger: "check the build status", keywords: ["build"], steps: ["read the page"] });
    const steps: RunStep[] = [
      { tool: "chrome_navigate", args: { url: "https://ci" }, ok: true },
      { tool: "chrome_read_page", args: {}, ok: true },
    ];
    const pb = (await distillPlaybook({ provider, goal: "build ok?", steps, outcome: "green", today: "2026-06-02" }))!;
    expect(pb.stakes).toBe("routine"); // navigate=low, read_page=read-only
  });

  it("returns null if the model output isn't usable JSON", async () => {
    const provider = new MockLLMProvider({ scripts: [[{ kind: "delta", text: "not json" }, { kind: "done", stop_reason: "end_turn" }]] });
    const pb = await distillPlaybook({ provider, goal: "x", steps: [{ tool: "shell", args: {}, ok: true }], outcome: "", today: "2026-06-02" });
    expect(pb).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm -w server run test -- playbooks/distill.test`

- [ ] **Step 3: Implement `server/src/playbooks/distill.ts`**

```ts
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { classifyRisk } from "../policy/classify.js";
import { slugify, type Playbook, type Stakes } from "./store.js";

export type RunStep = { tool: string; args: unknown; ok: boolean };

function stakesOf(steps: RunStep[]): Stakes {
  const consequential = steps.some((s) => {
    const tier = classifyRisk(s.tool, s.args).tier;
    return tier === "medium" || tier === "high" || tier === "blocked";
  });
  return consequential ? "consequential" : "routine";
}

export async function distillPlaybook(o: {
  provider: LLMProvider; goal: string; steps: RunStep[]; outcome: string; today: string;
}): Promise<Playbook | null> {
  const system =
    "You distill a completed task into a reusable playbook. Reply with ONLY a JSON object: " +
    '{ "trigger": "<one short line describing the kind of request this handles>", ' +
    '"keywords": ["..."], "steps": ["<high-level step>", ...] }. ' +
    "Steps are the gist of the approach, NOT exact values. No prose outside the JSON.";
  const toolList = o.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)}) -> ${s.ok ? "ok" : "fail"}`).join("\n");
  const user = `Goal: ${o.goal}\n\nTool steps:\n${toolList}\n\nOutcome: ${o.outcome}`;
  let text = "";
  for await (const ev of o.provider.stream({
    model: o.provider.defaultSideModel, system, messages: [{ role: "user", content: user }],
    tools: [], abort: new AbortController().signal, reasoningEffort: "none",
  })) {
    if (ev.kind === "delta") text += ev.text;
  }
  let parsed: { trigger?: string; keywords?: string[]; steps?: string[] };
  try {
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    parsed = JSON.parse(json);
  } catch { return null; }
  if (!parsed.trigger || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
  return {
    slug: slugify(parsed.trigger), trigger: parsed.trigger,
    keywords: (parsed.keywords ?? []).map(String), created: o.today, last_used: o.today,
    uses: 1, stakes: stakesOf(o.steps), steps: parsed.steps.map(String),
  };
}
```

- [ ] **Step 4: Run — expect PASS.** `npm -w server run test -- playbooks/distill.test`
- [ ] **Step 5: Commit**

```bash
git add server/src/playbooks/distill.ts server/src/playbooks/distill.test.ts
git commit -m "feat(playbooks): distill run into a playbook (LLM + deterministic stakes)"
```

---

## Task 4: Match a request to a playbook

**Files:**
- Create: `server/src/playbooks/match.ts`
- Test: `server/src/playbooks/match.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { matchPlaybook } from "./match.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

const reply = (text: string) => new MockLLMProvider({ scripts: [[{ kind: "delta", text }, { kind: "done", stop_reason: "end_turn" }]] });
const index = [
  { slug: "download-electricity-bill", trigger: "download the electricity bill" },
  { slug: "post-tweet", trigger: "post a tweet" },
];

describe("matchPlaybook", () => {
  it("returns the slug the model picks", async () => {
    const slug = await matchPlaybook({ prompt: "grab my power bill", index, provider: reply("download-electricity-bill") });
    expect(slug).toBe("download-electricity-bill");
  });
  it("returns null when the model says none", async () => {
    const slug = await matchPlaybook({ prompt: "what's the weather", index, provider: reply("none") });
    expect(slug).toBeNull();
  });
  it("returns null when the model names a slug not in the index", async () => {
    const slug = await matchPlaybook({ prompt: "x", index, provider: reply("hallucinated-slug") });
    expect(slug).toBeNull();
  });
  it("returns null with an empty index without calling the model", async () => {
    let called = false;
    const provider = { ...reply("x"), stream: () => { called = true; return reply("x").stream({} as any); } } as any;
    const slug = await matchPlaybook({ prompt: "x", index: [], provider });
    expect(slug).toBeNull();
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm -w server run test -- playbooks/match.test`

- [ ] **Step 3: Implement `server/src/playbooks/match.ts`**

```ts
import type { LLMProvider } from "../orchestrator/llm/types.js";

export async function matchPlaybook(o: {
  prompt: string; index: { slug: string; trigger: string }[]; provider: LLMProvider;
}): Promise<string | null> {
  if (o.index.length === 0) return null;
  const system =
    "You match a user request to ONE saved playbook, or none. " +
    "Reply with ONLY the matching slug exactly, or the word none. No other text.";
  const list = o.index.map((e) => `${e.slug}: ${e.trigger}`).join("\n");
  const user = `Playbooks:\n${list}\n\nRequest: ${o.prompt}`;
  let text = "";
  for await (const ev of o.provider.stream({
    model: o.provider.defaultSideModel, system, messages: [{ role: "user", content: user }],
    tools: [], abort: new AbortController().signal, reasoningEffort: "none",
  })) {
    if (ev.kind === "delta") text += ev.text;
  }
  const slug = text.trim().split(/\s+/)[0] ?? "";
  return o.index.some((e) => e.slug === slug) ? slug : null;
}
```

- [ ] **Step 4: Run — expect PASS.** `npm -w server run test -- playbooks/match.test`
- [ ] **Step 5: Commit**

```bash
git add server/src/playbooks/match.ts server/src/playbooks/match.test.ts
git commit -m "feat(playbooks): LLM matcher (request -> slug or null)"
```

---

## Task 5: Capture gate + orchestration

**Files:**
- Create: `server/src/playbooks/capture.ts`
- Test: `server/src/playbooks/capture.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeCapture } from "./capture.js";
import { listPlaybooks } from "./store.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import type { RunStep } from "./distill.js";

function dir() { return mkdtempSync(join(tmpdir(), "ava-cap-")); }
const provider = () => new MockLLMProvider({
  scripts: [[{ kind: "delta", text: JSON.stringify({ trigger: "do the thing", keywords: ["thing"], steps: ["a", "b"] }) }, { kind: "done", stop_reason: "end_turn" }]],
});
const twoSteps: RunStep[] = [{ tool: "chrome_navigate", args: {}, ok: true }, { tool: "fs_write", args: { path: "C:/ai/x" }, ok: true }];

describe("maybeCapture", () => {
  it("captures a successful >=2-tool run", async () => {
    const d = dir();
    await maybeCapture({ memoryDir: d, provider: provider(), goal: "g", steps: twoSteps, outcome: "ok", succeeded: true, today: "2026-06-02" });
    expect(listPlaybooks(d).length).toBe(1);
  });
  it("skips a run that failed", async () => {
    const d = dir();
    await maybeCapture({ memoryDir: d, provider: provider(), goal: "g", steps: twoSteps, outcome: "", succeeded: false, today: "2026-06-02" });
    expect(listPlaybooks(d).length).toBe(0);
  });
  it("skips a run with fewer than 2 tools", async () => {
    const d = dir();
    await maybeCapture({ memoryDir: d, provider: provider(), goal: "g", steps: [twoSteps[0]!], outcome: "ok", succeeded: true, today: "2026-06-02" });
    expect(listPlaybooks(d).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm -w server run test -- playbooks/capture.test`

- [ ] **Step 3: Implement `server/src/playbooks/capture.ts`**

```ts
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { distillPlaybook, type RunStep } from "./distill.js";
import { writePlaybook } from "./store.js";
import { prunePlaybooks } from "./mutate.js";

const SOFT_CAP = 50;
const MAX_AGE_DAYS = 60;

export async function maybeCapture(o: {
  memoryDir: string; provider: LLMProvider; goal: string; steps: RunStep[];
  outcome: string; succeeded: boolean; today: string;
}): Promise<void> {
  const toolCalls = o.steps.length;
  if (!o.succeeded || toolCalls < 2) return;
  try {
    const pb = await distillPlaybook({ provider: o.provider, goal: o.goal, steps: o.steps, outcome: o.outcome, today: o.today });
    if (!pb) return;
    writePlaybook(o.memoryDir, pb);
    prunePlaybooks(o.memoryDir, { today: o.today, maxAgeDays: MAX_AGE_DAYS, softCap: SOFT_CAP });
  } catch { /* capture is best-effort; never surface */ }
}
```

- [ ] **Step 4: Run — expect PASS.** `npm -w server run test -- playbooks/capture.test`
- [ ] **Step 5: Commit**

```bash
git add server/src/playbooks/capture.ts server/src/playbooks/capture.test.ts
git commit -m "feat(playbooks): capture gate + orchestration"
```

---

## Task 6: Wire capture + recall into `chat.ts`

**Files:**
- Modify: `server/src/routes/chat.ts`
- Test: `server/src/routes/chat-playbooks.test.ts`

Collect tool steps during the run; on a successful action run, fire `maybeCapture`. Before the run, in action mode with a non-empty index, `matchPlaybook` and inject the playbook body + the stakes rubric into `promptForAgent`.

- [ ] **Step 1: Write the failing test** (drives the route end-to-end with a mock agent that emits two tool calls + a final)

```ts
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { chatRoutes } from "./chat.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { listPlaybooks } from "../playbooks/store.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-pbwire-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-pbwire-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare("INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)").run("d", "h", "t", Date.now());
  const provider = new MockLLMProvider({
    scripts: [[{ kind: "delta", text: JSON.stringify({ trigger: "do thing", keywords: ["thing"], steps: ["a", "b"] }) }, { kind: "done", stop_reason: "end_turn" }]],
  });
  // Fake agent loop: emit two tool calls + a final so the collector sees a >=2-tool success.
  const runAgentImpl = vi.fn(async (opts: any) => {
    opts.emit({ kind: "tool_call", payload: { tool: "chrome_navigate", args: {} } });
    opts.emit({ kind: "tool_result", payload: { tool: "chrome_navigate", ok: true, result: "" } });
    opts.emit({ kind: "tool_call", payload: { tool: "fs_write", args: { path: "C:/ai/x" } } });
    opts.emit({ kind: "tool_result", payload: { tool: "fs_write", ok: true, result: "" } });
    opts.emit({ kind: "final", payload: { text: "done" } });
  });
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "d"; next(); });
  app.use("/api/chat", chatRoutes(db, new ActiveRuns(), (_q, _s, n) => n(),
    { pidfiles: { register() {}, unregister() {} } as any, fsRoots: [], memoryDir, getChrome: async () => ({} as any), provider, runAgentImpl },
    { anthropic: null, openai: null }));
  return { app, memoryDir };
}

describe("chat playbook capture", () => {
  it("captures a playbook after a successful 2-tool run", async () => {
    const { app, memoryDir } = setup();
    await request(app).post("/api/chat").send({ text: "do the thing on my pc" }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(listPlaybooks(memoryDir).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no capture wired): `npm -w server run test -- chat-playbooks.test`

- [ ] **Step 3: Implement the wiring in `server/src/routes/chat.ts`**

Add imports:
```ts
import { maybeCapture } from "../playbooks/capture.js";
import { matchPlaybook } from "../playbooks/match.js";
import { loadPlaybookIndex, readPlaybook } from "../playbooks/store.js";
import { bumpUse } from "../playbooks/mutate.js";
import type { RunStep } from "../playbooks/distill.js";
```

Pre-run, where `promptForAgent` is built (after `latestUserText` is known, action mode only): match + inject.
```ts
let playbookPrefix = "";
if (mode === "action" && agentDeps.provider) {
  const index = loadPlaybookIndex(agentDeps.memoryDir);
  const slug = index.length ? await matchPlaybook({ prompt: parsed.data.text, index, provider: agentDeps.provider }) : null;
  if (slug) {
    const pb = readPlaybook(agentDeps.memoryDir, slug);
    if (pb) {
      bumpUse(agentDeps.memoryDir, slug, new Date().toISOString().slice(0, 10));
      const rubric = pb.stakes === "consequential"
        ? "This is a known consequential task — follow these steps efficiently, but verify the result before reporting done."
        : "This is a known routine task — follow these steps efficiently; no recheck needed.";
      playbookPrefix = `[PLAYBOOK — ${pb.slug}]\n${rubric}\n${pb.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`;
    }
  }
}
```
Prepend `playbookPrefix` into `promptForAgent` (alongside `greeting.prefix` + `summaryHeader`).

In the run's `emit` closure, collect steps and capture on final:
```ts
const runSteps: RunStep[] = [];
let lastTool: string | null = null;
const emit = (e: AgentEvent) => {
  if (e.kind === "tool_call") { lastTool = e.payload.tool; runSteps.push({ tool: e.payload.tool, args: e.payload.args, ok: true }); }
  else if (e.kind === "tool_result") { const s = runSteps[runSteps.length - 1]; if (s && s.tool === e.payload.tool) s.ok = e.payload.ok; }
  else if (e.kind === "final") {
    const prov = agentDeps.provider;
    if (prov) void maybeCapture({ memoryDir: agentDeps.memoryDir, provider: prov, goal: parsed.data.text, steps: runSteps, outcome: e.payload.text, succeeded: true, today: new Date().toISOString().slice(0, 10) });
  }
  const id = buffer.append({ kind: e.kind, payload: e.payload });
  if (e.kind === "final") appendMessage(db, { sessionId: sid, role: "assistant", content: e.payload.text });
  return id;
};
```
(Integrate with the existing `emit` — keep its buffer.append + final-persist behavior; add the collector + capture.)

- [ ] **Step 4: Run — expect PASS.** `npm -w server run test -- chat-playbooks.test`
- [ ] **Step 5: Full server suite green.** `npm -w server run test`
- [ ] **Step 6: Commit**

```bash
git add server/src/routes/chat.ts server/src/routes/chat-playbooks.test.ts
git commit -m "feat(playbooks): capture after action runs + recall injection in chat"
```

---

## Task 7: Integration — capture then recall

**Files:**
- Test: `server/src/playbooks/recall.integration.test.ts`

Proves the loop: distill+store a playbook, then a matcher hit injects it. Uses real `store` + `match` + `distill` with a mock provider.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeCapture } from "./capture.js";
import { loadPlaybookIndex, readPlaybook } from "./store.js";
import { matchPlaybook } from "./match.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import type { RunStep } from "./distill.js";

const distiller = () => new MockLLMProvider({ scripts: [[{ kind: "delta", text: JSON.stringify({ trigger: "download the electricity bill", keywords: ["electricity", "bill"], steps: ["open billing page", "download PDF"] }) }, { kind: "done", stop_reason: "end_turn" }]] });
const matcher = (slug: string) => new MockLLMProvider({ scripts: [[{ kind: "delta", text: slug }, { kind: "done", stop_reason: "end_turn" }]] });

describe("playbook capture -> recall", () => {
  it("captures from a run, then matches + reads it on a similar request", async () => {
    const d = mkdtempSync(join(tmpdir(), "ava-recall-"));
    const steps: RunStep[] = [{ tool: "chrome_navigate", args: { url: "https://x" }, ok: true }, { tool: "fs_write", args: { path: "C:/Users/x/Downloads/bill.pdf" }, ok: true }];
    await maybeCapture({ memoryDir: d, provider: distiller(), goal: "get my electricity bill", steps, outcome: "saved", succeeded: true, today: "2026-06-02" });

    const index = loadPlaybookIndex(d);
    expect(index.length).toBe(1);
    const slug = await matchPlaybook({ prompt: "grab this month's power bill", index, provider: matcher("download-the-electricity-bill") });
    expect(slug).toBe("download-the-electricity-bill");
    const pb = readPlaybook(d, slug!)!;
    expect(pb.stakes).toBe("consequential");
    expect(pb.steps.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect PASS.** `npm -w server run test -- recall.integration`
- [ ] **Step 3: Full suite + typecheck.** `npm test` then `npx tsc --noEmit -p server/tsconfig.json` (exit 0)
- [ ] **Step 4: Commit**

```bash
git add server/src/playbooks/recall.integration.test.ts
git commit -m "test(playbooks): capture -> recall integration"
```

---

## Self-Review

**Spec coverage:** §6 capture → Tasks 3,5,6; §7 storage → Task 1; §8 recall (matcher + injection) → Tasks 4,6; §9 stakes → Task 3 (deterministic, playbook-level per the refinement) + Task 6 rubric; §10 prune/promote → Task 2; §11 components → Tasks 1-6; §13 testing → every task + Task 7.

**Refinement noted:** stakes is playbook-level (not per-step) — see header. Matches the user's task-level choice; recorded in the plan + to be reflected when the spec and plan are reconciled (the spec's §7 example shows per-step tags; implementation uses one `stakes` field).

**Type consistency:** `Playbook`, `RunStep`, `Stakes`, `slugify`, `loadPlaybookIndex`, `readPlaybook`, `bumpUse`, `prunePlaybooks`, `distillPlaybook`, `matchPlaybook`, `maybeCapture` are used identically across tasks.

**Gating:** matcher only runs in `mode === "action"` with a non-empty index (Task 6) — chitchat never pays for it (spec §8).
