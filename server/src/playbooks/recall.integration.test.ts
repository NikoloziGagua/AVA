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

describe("playbook capture -> recall", () => {
  it("captures from a run, then matches + reads it locally on a similar request", async () => {
    const d = mkdtempSync(join(tmpdir(), "ava-recall-"));
    const steps: RunStep[] = [{ tool: "chrome_navigate", args: { url: "https://x" }, ok: true }, { tool: "fs_write", args: { path: "C:/Users/x/Downloads/bill.pdf" }, ok: true }];
    await maybeCapture({ memoryDir: d, provider: distiller(), goal: "get my electricity bill", steps, outcome: "saved", succeeded: true, today: "2026-06-02" });

    const index = loadPlaybookIndex(d);
    expect(index.length).toBe(1);
    // The index now carries keywords + uses for the local scorer.
    expect(index[0]!.keywords).toEqual(["electricity", "bill"]);
    // Recall is local + instant (no side-model call): lexical overlap with the
    // trigger ("download … electricity bill") matches.
    const slug = matchPlaybook({ prompt: "download this month's electricity bill", index });
    expect(slug).toBe("download-the-electricity-bill");
    const pb = readPlaybook(d, slug!)!;
    expect(pb.stakes).toBe("consequential");
    expect(pb.steps.length).toBe(2);
  });
});
