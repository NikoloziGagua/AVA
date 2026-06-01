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
