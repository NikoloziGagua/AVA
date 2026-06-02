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
    expect(pb.stakes).toBe("consequential"); // fs_write is state-changing
    expect(pb.uses).toBe(1);
    expect(pb.steps.length).toBe(2);
  });

  it("marks stakes routine when only read/navigation tools were used", async () => {
    const provider = llmJson({ trigger: "check the build status", keywords: ["build"], steps: ["read the page"] });
    const steps: RunStep[] = [
      { tool: "chrome_navigate", args: { url: "https://ci" }, ok: true },
      { tool: "chrome_read_page", args: {}, ok: true },
    ];
    const pb = (await distillPlaybook({ provider, goal: "build ok?", steps, outcome: "green", today: "2026-06-02" }))!;
    expect(pb.stakes).toBe("routine");
  });

  it("returns null if the model output isn't usable JSON", async () => {
    const provider = new MockLLMProvider({ scripts: [[{ kind: "delta", text: "not json" }, { kind: "done", stop_reason: "end_turn" }]] });
    const pb = await distillPlaybook({ provider, goal: "x", steps: [{ tool: "shell", args: {}, ok: true }], outcome: "", today: "2026-06-02" });
    expect(pb).toBeNull();
  });
});
