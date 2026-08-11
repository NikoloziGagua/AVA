import { beforeEach, describe, expect, it } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { listVisualExplanations } from "../state/visual-explanations.js";
import { requestPathFixture } from "../visual-explanations/fixtures.test-helper.js";
import { buildVisualExplanationTools } from "./visual-explanations-mcp.js";

let db: Db;
beforeEach(() => { db = openInMemoryDb(); });

function tool(name: string) {
  return buildVisualExplanationTools({ db, sessionId: "chat-visual", source: "ava_chat" })
    .find((entry) => entry.tool.name === name)!;
}

describe("visual explanation tools", () => {
  it("creates a traceable visual and returns the exact viewer ID", async () => {
    const result = await tool("visual_explanation_create").run(requestPathFixture as unknown as Record<string, unknown>, { runId: "run-visual" });
    expect(result.ok).toBe(true);
    const output = JSON.parse(result.text) as { visualExplanationId: string };
    const stored = listVisualExplanations(db)[0]!;
    expect(output.visualExplanationId).toBe(stored.id);
    expect(stored).toMatchObject({ source: "ava_chat", sourceSessionId: "chat-visual", sourceRunId: "run-visual" });
  });

  it("deduplicates retries in one run without stealing later-run lineage", async () => {
    const create = tool("visual_explanation_create");
    const first = await create.run(requestPathFixture as unknown as Record<string, unknown>, { runId: "run-first" });
    const retry = await create.run(requestPathFixture as unknown as Record<string, unknown>, { runId: "run-first" });
    const later = await create.run(requestPathFixture as unknown as Record<string, unknown>, { runId: "run-later" });
    expect(JSON.parse(retry.text).visualExplanationId).toBe(JSON.parse(first.text).visualExplanationId);
    expect(JSON.parse(later.text).visualExplanationId).not.toBe(JSON.parse(first.text).visualExplanationId);
    expect(listVisualExplanations(db).map((visual) => visual.sourceRunId).sort()).toEqual(["run-first", "run-later"]);
  });

  it("reports validation failures without persisting unsafe source", async () => {
    const invalid = structuredClone(requestPathFixture);
    invalid.mermaid += `\nclick request "https://evil.example"`;
    const result = await tool("visual_explanation_create").run(invalid as unknown as Record<string, unknown>, { runId: "run-bad" });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("invalid_visual_explanation");
    expect(listVisualExplanations(db)).toHaveLength(0);
  });

  it("lists existing explanations without exposing canonical payloads", async () => {
    await tool("visual_explanation_create").run(requestPathFixture as unknown as Record<string, unknown>, { runId: "run-visual" });
    const result = await tool("visual_explanation_list").run({ limit: 5 }, { runId: "run-list" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain(requestPathFixture.title);
    expect(result.text).not.toContain("flowchart TD");
  });
});
