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
const evidence = { taskId: "task-test", method: "fixture_readback", observedAt: 123 };

describe("maybeCapture", () => {
  it("captures a verified >=2-tool run", async () => {
    const d = dir();
    await maybeCapture({ memoryDir: d, provider: provider(), goal: "g", steps: twoSteps, resultText: "ok", learningOutcome: "verified", evidence, today: "2026-06-02" });
    expect(listPlaybooks(d).length).toBe(1);
    expect(listPlaybooks(d)[0]!.learning?.verified).toBe(1);
  });
  it("skips a final response whose outcome was not verified", async () => {
    const d = dir();
    await maybeCapture({ memoryDir: d, provider: provider(), goal: "g", steps: twoSteps, resultText: "done", learningOutcome: "unverified", evidence, today: "2026-06-02" });
    expect(listPlaybooks(d).length).toBe(0);
  });
  it("skips a run with fewer than 2 tools", async () => {
    const d = dir();
    await maybeCapture({ memoryDir: d, provider: provider(), goal: "g", steps: [twoSteps[0]!], resultText: "ok", learningOutcome: "verified", evidence, today: "2026-06-02" });
    expect(listPlaybooks(d).length).toBe(0);
  });
  it("reports failures via onError instead of swallowing them silently", async () => {
    const d = dir();
    const errors: unknown[] = [];
    // A provider with no scripts throws inside distill's stream loop — the exact
    // shape of failure (e.g. a 400) that previously vanished without a trace.
    const bad = new MockLLMProvider({ scripts: [] });
    await maybeCapture({ memoryDir: d, provider: bad, goal: "g", steps: twoSteps, resultText: "ok", learningOutcome: "verified", evidence, today: "2026-06-02", onError: (e) => errors.push(e) });
    expect(errors.length).toBe(1);
    expect(listPlaybooks(d).length).toBe(0); // best-effort: no crash, nothing written
  });
});
