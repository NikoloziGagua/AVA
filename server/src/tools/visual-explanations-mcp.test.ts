import { beforeEach, describe, expect, it } from "vitest";
import { openInMemoryDb, type Db } from "../state/db.js";
import { listVisualExplanations } from "../state/visual-explanations.js";
import { requestPathFixture } from "../visual-explanations/fixtures.test-helper.js";
import { timelineFixture, vikingMapFixture } from "../visual-explanations/research-fixtures.test-helper.js";
import { ObservabilityService } from "../observability/store.js";
import { buildVisualExplanationTools } from "./visual-explanations-mcp.js";

let db: Db;
beforeEach(() => { db = openInMemoryDb(); });

function tool(name: string) {
  return buildVisualExplanationTools({ db, sessionId: "chat-visual", source: "ava_chat" })
    .find((entry) => entry.tool.name === name)!;
}

describe("visual explanation tools", () => {
  it.each([
    ["Research development of AI and create a visual timeline", ["research_visual_create", "visual_explanation_list"]],
    ["draw me a chart here of the comparisons in chat", ["research_visual_create", "visual_explanation_list"]],
    ["show me with a map Viking migrations", ["research_visual_create", "visual_explanation_list"]],
    ["visually explain AVA's Instagram architecture", ["visual_explanation_create", "visual_explanation_list"]],
    ["show this visually", ["research_visual_create", "visual_explanation_create", "visual_explanation_list"]],
  ] as const)("exposes the correct visual contract for %s", (request, names) => {
    expect(buildVisualExplanationTools({ db, sessionId: "chat-visual", source: "ava_chat", request })
      .map((entry) => entry.tool.name)).toEqual(names);
  });

  it("enforces the explicit form even when the model omits userSelectedForm", async () => {
    const research = buildVisualExplanationTools({
      db, sessionId: "chat-visual", source: "ava_chat",
      request: "Research development of AI and create a visual timeline",
    })[0]!;
    const result = await research.run(timelineFixture as unknown as Record<string, unknown>, { runId: "run-timeline" });
    expect(result.ok).toBe(true);
    expect(listVisualExplanations(db)[0]).toMatchObject({
      diagramKind: "timeline",
      selection: { selectedForm: "timeline", userSelected: true },
    });
  });

  it("rejects a model attempt to override the user's explicit visual form", async () => {
    const research = buildVisualExplanationTools({
      db, sessionId: "chat-visual", source: "ava_chat",
      request: "show me with a map Viking migrations",
    })[0]!;
    const result = await research.run({ ...vikingMapFixture, userSelectedForm: "chart" } as unknown as Record<string, unknown>, { runId: "run-wrong-form" });
    expect(result.ok).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({
      error: "requested_visual_form_mismatch",
      requestedForm: "geographic_map",
      receivedForm: "chart",
    });
    expect(listVisualExplanations(db)).toHaveLength(0);
  });

  it("creates a traceable visual and returns the exact viewer ID", async () => {
    const result = await tool("visual_explanation_create").run(requestPathFixture as unknown as Record<string, unknown>, { runId: "run-visual" });
    expect(result.ok).toBe(true);
    const output = JSON.parse(result.text) as { visualExplanationId: string };
    const stored = listVisualExplanations(db)[0]!;
    expect(output.visualExplanationId).toBe(stored.visualMessageId);
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

  it("creates an evidence-linked research visual and exposes bounded progress in Mission Control", async () => {
    const observability = new ObservabilityService(db);
    observability.startRun({ id: "run-research", runKind: "chat_agent", runtimeType: "ava", ownerType: "ava", title: "Research" });
    const research = buildVisualExplanationTools({ db, sessionId: "chat-visual", source: "ava_chat", observability })
      .find((entry) => entry.tool.name === "research_visual_create")!;
    const result = await research.run(vikingMapFixture as unknown as Record<string, unknown>, { runId: "run-research" });
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.text)).toMatchObject({ visualForm: "geographic_map", recommendedForm: "geographic_map" });
    const events = observability.getEvents("run-research").filter((event) => event.type.startsWith("research.visual."));
    expect(events.map((event) => event.type)).toEqual([
      "research.visual.planning", "research.visual.validated", "research.visual.persisted",
    ]);
    expect(JSON.stringify(events)).not.toContain("Primary research source");
    expect(events[0]).toMatchObject({ visibility: "sensitive_collapsed", privacyLevel: "source_sensitive" });
  });

  it("records a safe failure boundary without persisting invalid research evidence", async () => {
    const observability = new ObservabilityService(db);
    observability.startRun({ id: "run-research-fail", runKind: "chat_agent", runtimeType: "ava", ownerType: "ava", title: "Research" });
    const research = buildVisualExplanationTools({ db, sessionId: "chat-visual", source: "ava_chat", observability })
      .find((entry) => entry.tool.name === "research_visual_create")!;
    const invalid = structuredClone(vikingMapFixture);
    invalid.sources[0]!.url = "javascript:secret-token";
    const result = await research.run(invalid as unknown as Record<string, unknown>, { runId: "run-research-fail" });
    expect(result.ok).toBe(false);
    expect(listVisualExplanations(db)).toHaveLength(0);
    const failure = observability.getEvents("run-research-fail").find((event) => event.type === "research.visual.failed");
    expect(failure).toMatchObject({ status: "error", title: "Research visual generation failed safely" });
    expect(JSON.stringify(failure)).not.toContain("secret-token");
  });
});
