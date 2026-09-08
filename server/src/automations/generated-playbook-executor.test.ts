import { describe, expect, it, vi } from "vitest";
import type { ToolDef } from "../tools/ava-mcp.js";
import { buildGeneratedPlaybookExecutor } from "./generated-playbook-executor.js";
import type { GeneratedSequenceDefinition } from "./generated-playbooks.js";

const verification = (method: string) => ({ state: "verified" as const, scope: "task_outcome" as const,
  method, summary: "Verified fixture outcome." });

function tool(name: string, run: ToolDef["run"]): ToolDef {
  return { tool: { name, inputSchema: { type: "object", properties: {} } }, run };
}

const sequence: GeneratedSequenceDefinition = { schemaVersion: 2, kind: "tool_sequence", steps: [
  { id: "step-1", tool: "chrome_google_search", query: "AVA proof" },
  { id: "step-2", tool: "instagram_open_chat", personId: "person-lasha", displayName: "Lasha",
    expectedUsername: "_princi150" },
] };

describe("generated playbook ordered executor", () => {
  it("runs supported steps in order and aggregates their verification", async () => {
    const order: string[] = [];
    const owners: string[] = [];
    const execute = buildGeneratedPlaybookExecutor([
      tool("chrome_google_search", async (args, context) => { order.push(`google:${args.query}`); owners.push(context.runId);
        return { ok: true, text: "searched", verification: verification("chrome_google_search_url") }; }),
      tool("instagram_open_chat", async (args, context) => { order.push(`instagram:${args.person}`); owners.push(context.runId);
        return { ok: true, text: "opened", verification: verification("instagram_thread_identity") }; }),
    ]);
    await expect(execute(sequence, undefined, "plan-run-42")).resolves.toMatchObject({ ok: true,
      verification: { method: "approved_playbook_sequence" }, steps: [
        { id: "step-1", ok: true }, { id: "step-2", ok: true },
      ] });
    expect(order).toEqual(["google:AVA proof", "instagram:Lasha"]);
    expect(owners).toEqual(["generated-plan-run-42:step-1", "generated-plan-run-42:step-2"]);
  });

  it("stops on failure or missing verification and never starts a later step", async () => {
    const second = vi.fn(async () => ({ ok: true, text: "opened", verification: verification("instagram_thread_identity") }));
    const failed = buildGeneratedPlaybookExecutor([
      tool("chrome_google_search", async () => ({ ok: false, text: "network error" })),
      tool("instagram_open_chat", second),
    ]);
    await expect(failed(sequence)).resolves.toMatchObject({ ok: false, text: expect.stringContaining("step-1 failed") });
    expect(second).not.toHaveBeenCalled();

    const unverified = buildGeneratedPlaybookExecutor([
      tool("chrome_google_search", async () => ({ ok: true, text: "reported only" })),
      tool("instagram_open_chat", second),
    ]);
    await expect(unverified(sequence)).resolves.toMatchObject({ ok: false,
      text: expect.stringContaining("did not produce independent verification") });
    expect(second).not.toHaveBeenCalled();
  });

  it("honors cancellation and never dispatches an unavailable or unregistered step", async () => {
    const run = vi.fn(async () => ({ ok: true, text: "searched", verification: verification("chrome_google_search_url") }));
    const execute = buildGeneratedPlaybookExecutor([tool("chrome_google_search", run)]);
    const controller = new AbortController(); controller.abort();
    await expect(execute(sequence, controller.signal)).resolves.toMatchObject({ ok: false,
      text: expect.stringContaining("cancelled") });
    expect(run).not.toHaveBeenCalled();

    await expect(execute(sequence)).resolves.toMatchObject({ ok: false,
      text: expect.stringContaining("step-2 is unavailable") });
  });

  it("rejects duplicate authoritative registrations", () => {
    const run = async () => ({ ok: true, text: "searched", verification: verification("url") });
    expect(() => buildGeneratedPlaybookExecutor([
      tool("chrome_google_search", run), tool("chrome_google_search", run),
    ])).toThrow("duplicate generated-playbook executor");
  });
});
