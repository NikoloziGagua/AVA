import { describe, it, expect, vi } from "vitest";
import { buildClaudeCodeTool } from "./claude-code-mcp.js";
import { TOOL_BUDGET_MS } from "../orchestrator/timeout.js";
import type { ClaudeCode, ClaudeCodeRunArgs } from "./claude-code.js";

function fakeCc(spy: (a: ClaudeCodeRunArgs) => void): ClaudeCode {
  return {
    run: async (a) => {
      spy(a);
      return { ok: true, output: "ok", exitCode: 0 };
    },
  };
}

describe("buildClaudeCodeTool", () => {
  it("passes a hard timeoutMs (under the budget) AND the abort signal into cc.run", async () => {
    const seen: ClaudeCodeRunArgs[] = [];
    const tool = buildClaudeCodeTool({ cc: fakeCc((a) => seen.push(a)), emit: () => {} });
    const ac = new AbortController();
    await tool.run({ prompt: "do X", cwd: "/p" }, { runId: "r1", signal: ac.signal });

    expect(seen).toHaveLength(1);
    const arg = seen[0]!;
    // The child must be hard-bounded so claude-code's own SIGTERM→SIGKILL ladder
    // arms (withTimeout alone can't kill the child → zombie workers).
    expect(typeof arg.timeoutMs).toBe("number");
    expect(arg.timeoutMs!).toBeGreaterThan(0);
    // Slightly under the orchestrator budget so the child dies before withTimeout.
    expect(arg.timeoutMs!).toBeLessThan(TOOL_BUDGET_MS.claude_code!);
    // The abort signal is still threaded through (Stop reaches the child).
    expect(arg.signal).toBe(ac.signal);
    expect(arg.runId).toBe("r1");
  });
});
