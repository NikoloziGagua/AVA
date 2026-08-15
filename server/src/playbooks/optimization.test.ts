// Playbooks v2 — the workflow-optimization mechanics:
// metrics fields, lessons, merge-on-capture, outcome recording, demotion,
// and the recovered-failure capture gate.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePlaybook, readPlaybook, parsePlaybook, type Playbook } from "./store.js";
import { matchPlaybook, isDemoted } from "./match.js";
import { recordOutcome, mergePlaybook } from "./mutate.js";
import { shouldCapture, maybeCapture } from "./capture.js";
import type { LLMProvider } from "../orchestrator/llm/types.js";
import { EMPTY_PLAYBOOK_LEARNING } from "./store.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pb-v2-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const base: Playbook = {
  slug: "check-city-weather-and-save-summary",
  trigger: "Check city weather and save summary",
  keywords: ["weather", "forecast", "save to file", "wttr.in"],
  created: "2026-07-01", last_used: "2026-07-01", uses: 3, stakes: "consequential",
  steps: ["Go straight to wttr.in with a format string", "Write summary to the file", "Read back to confirm"],
  version: 1, succ: 2, fail: 0, avg_secs: 12,
  lessons: ["Google search bot-walls automation — skip it"],
  learning: { ...EMPTY_PLAYBOOK_LEARNING },
};

describe("store v2 fields", () => {
  it("round-trips metrics + lessons", () => {
    writePlaybook(dir, base);
    const back = readPlaybook(dir, base.slug)!;
    expect(back.version).toBe(1);
    expect(back.succ).toBe(2);
    expect(back.fail).toBe(0);
    expect(back.avg_secs).toBe(12);
    expect(back.lessons).toEqual(["Google search bot-walls automation — skip it"]);
    expect(back.steps).toHaveLength(3);
  });

  it("parses a pre-v2 file with defaults", () => {
    const legacy = "---\ntrigger: Do a thing\nkeywords: thing\ncreated: 2026-06-01\nlast_used: 2026-06-01\nuses: 4\nstakes: routine\n---\n# Steps\n1. step one\n2. step two\n";
    const pb = parsePlaybook("do-a-thing", legacy)!;
    expect(pb.version).toBe(1);
    expect(pb.succ).toBe(0);
    expect(pb.fail).toBe(0);
    expect(pb.avg_secs).toBe(0);
    expect(pb.lessons).toEqual([]);
    expect(pb.uses).toBe(4);
  });
});

describe("match v2", () => {
  const index = [{
    slug: base.slug, trigger: base.trigger, keywords: base.keywords,
    uses: 3, succ: 2, fail: 0,
  }];

  it("matches the Batumi paraphrase (regression: v1 missed it)", () => {
    const prompt = "Check the current weather in Batumi using the web and save a one-line summary to C:/Users/nika/ava-workspace/weather-batumi.txt, confirm what you wrote.";
    expect(matchPlaybook({ prompt, index })).toBe(base.slug);
  });

  it("keyword corroboration rescues mid-coverage triggers", () => {
    // Only 2/5 trigger tokens ("weather", "save") — hmm, need >=0.4 coverage:
    // "weather save summary" hits 3/5 = 0.6 already; craft a 0.4-0.6 case:
    const prompt = "what's the weather like, save it for me — use wttr.in and note the forecast";
    // trigger hits: weather, save (2/5 = 0.4); kw hits: wttr.in, forecast, weather >= 2
    expect(matchPlaybook({ prompt, index })).toBe(base.slug);
  });

  it("never matches on keywords alone", () => {
    const prompt = "wttr.in forecast por favor";
    // trigger hits: 0 -> rejected regardless of keyword hits
    expect(matchPlaybook({ prompt, index })).toBeNull();
  });

  it("demotes repeat losers out of recall", () => {
    expect(isDemoted({ succ: 0, fail: 3 })).toBe(true);
    expect(isDemoted({ succ: 5, fail: 3 })).toBe(false);
    const demoted = [{ ...index[0]!, succ: 0, fail: 3 }];
    const prompt = "Check the current weather in Batumi and save a summary to a file";
    expect(matchPlaybook({ prompt, index: demoted })).toBeNull();
  });
});

describe("verified capture gate (shouldCapture)", () => {
  const ok = (tool: string) => ({ tool, args: {}, ok: true });
  const bad = (tool: string) => ({ tool, args: {}, ok: false });

  it("accepts a recovered-failure run (the v1 gate rejected these)", () => {
    expect(shouldCapture({ outcome: "verified", steps: [bad("chrome_navigate"), ok("chrome_navigate"), ok("fs_write")] })).toBe(true);
  });
  it("rejects a trailing failure (the model gave up)", () => {
    expect(shouldCapture({ outcome: "verified", steps: [ok("chrome_navigate"), bad("fs_write")] })).toBe(false);
  });
  it("rejects mostly-failed runs", () => {
    expect(shouldCapture({ outcome: "verified", steps: [bad("a"), bad("b"), ok("c")] })).toBe(false);
  });
  it("rejects short and unverified runs", () => {
    expect(shouldCapture({ outcome: "verified", steps: [ok("a")] })).toBe(false);
    expect(shouldCapture({ outcome: "unverified", steps: [ok("a"), ok("b")] })).toBe(false);
  });
});

describe("recordOutcome", () => {
  const evidence = { taskId: "task-weather", method: "file_readback", observedAt: 123 };

  it("rolls avg_secs on verified evidence without mutating legacy wins", () => {
    writePlaybook(dir, base);
    recordOutcome(dir, base.slug, { outcome: "verified", secs: 24, evidence });
    const pb = readPlaybook(dir, base.slug)!;
    expect(pb.succ).toBe(2);
    expect(pb.learning?.verified).toBe(1);
    expect(pb.learning?.last_method).toBe("file_readback");
    expect(pb.avg_secs).toBe(24);
    expect(pb.fail).toBe(0);
  });
  it("records contradiction separately without touching legacy counters or average", () => {
    writePlaybook(dir, base);
    recordOutcome(dir, base.slug, { outcome: "contradicted", evidence });
    const pb = readPlaybook(dir, base.slug)!;
    expect(pb.fail).toBe(0);
    expect(pb.learning?.contradicted).toBe(1);
    expect(pb.avg_secs).toBe(12);
  });

  it("is idempotent when a terminal task is replayed", () => {
    writePlaybook(dir, base);
    recordOutcome(dir, base.slug, { outcome: "verified", secs: 24, evidence });
    recordOutcome(dir, base.slug, { outcome: "verified", secs: 24, evidence });
    const pb = readPlaybook(dir, base.slug)!;
    expect(pb.learning?.verified).toBe(1);
    expect(pb.learning?.recent_task_ids).toEqual(["task-weather"]);
  });
});

describe("mergePlaybook", () => {
  it("keeps identity + record, takes fresh steps, bumps version", () => {
    writePlaybook(dir, base);
    const fresh: Playbook = {
      ...base,
      slug: "fetch-weather-for-city",
      trigger: "Fetch weather for a city and record it somewhere safe",
      keywords: ["weather", "timeanddate"],
      created: "2026-07-03", last_used: "2026-07-03", uses: 1,
      steps: ["Use timeanddate.com directly", "Write file", "Verify"],
      version: 1, succ: 0, fail: 0, avg_secs: 20,
      lessons: ["timeanddate.com is a reliable fallback"],
      learning: {
        ...EMPTY_PLAYBOOK_LEARNING,
        verified: 1,
        last_task_id: "task-fresh",
        last_method: "fixture",
        last_evidence_at: 123,
        recent_task_ids: ["task-fresh"],
      },
    };
    mergePlaybook(dir, base.slug, fresh, "2026-07-03");
    const merged = readPlaybook(dir, base.slug)!;
    expect(merged.version).toBe(2);
    expect(merged.uses).toBe(3);           // track record kept
    expect(merged.succ).toBe(2);
    expect(merged.created).toBe("2026-07-01");
    expect(merged.steps).toEqual(fresh.steps); // newest procedure wins
    expect(merged.trigger).toBe(base.trigger); // shorter trigger wins
    expect(merged.keywords).toContain("timeanddate");
    expect(merged.lessons).toHaveLength(2);
    expect(merged.avg_secs).toBe(20);      // only the fresh run has verified evidence
    expect(merged.learning?.verified).toBe(1);
    // no duplicate file under the fresh slug
    expect(readPlaybook(dir, fresh.slug)).toBeNull();
  });
});

describe("maybeCapture merge-on-capture", () => {
  function fakeProvider(json: unknown): LLMProvider {
    return {
      name: "openai", defaultOrchestratorModel: "m", defaultSideModel: "m",
      // eslint-disable-next-line require-yield
      stream: async function* () {
        yield { kind: "delta", text: JSON.stringify(json) } as never;
      },
      complete: async () => JSON.stringify(json),
    } as unknown as LLMProvider;
  }
  const steps = [
    { tool: "chrome_navigate", args: {}, ok: true },
    { tool: "fs_write", args: {}, ok: true },
  ];
  const evidence = { taskId: "task-capture", method: "file_readback", observedAt: 123 };

  it("second capture of the same task class merges instead of duplicating", async () => {
    await maybeCapture({
      memoryDir: dir, provider: fakeProvider({
        trigger: "Check city weather and save summary",
        keywords: ["weather", "save"], steps: ["A", "B"], lessons: [],
      }),
      goal: "weather please", steps, resultText: "done", learningOutcome: "verified", evidence,
      today: "2026-07-03", durationSecs: 10,
    });
    await maybeCapture({
      memoryDir: dir, provider: fakeProvider({
        trigger: "Check weather for a city and save the summary",
        keywords: ["weather", "summary"], steps: ["A2", "B2"], lessons: ["lesson"],
      }),
      goal: "weather please again", steps, resultText: "done", learningOutcome: "verified",
      evidence: { ...evidence, taskId: "task-capture-2", observedAt: 124 },
      today: "2026-07-04", durationSecs: 8,
    });
    const files = readdirSync(join(dir, "playbooks")).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
    const pb = readPlaybook(dir, files[0]!.replace(/\.md$/, ""))!;
    expect(pb.version).toBe(2);
    expect(pb.steps).toEqual(["A2", "B2"]);
    expect(pb.lessons).toEqual(["lesson"]);
  });
});
